#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Signers,
    Threshold,
    Recipient,
    Initialized,
}

#[contract]
pub struct EscrowMultisig;

#[contractimpl]
impl EscrowMultisig {
    /// Initialize the escrow contract with signers, threshold, and recipient.
    pub fn initialize(e: Env, signers: Vec<Address>, threshold: u32, recipient: Address) {
        if e.storage().instance().has(&DataKey::Initialized) {
            panic!("already initialized");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("invalid threshold");
        }

        e.storage().instance().set(&DataKey::Signers, &signers);
        e.storage().instance().set(&DataKey::Threshold, &threshold);
        e.storage().instance().set(&DataKey::Recipient, &recipient);
        e.storage().instance().set(&DataKey::Initialized, &true);
    }

    /// Release funds to the recipient.
    /// Requires authorization from M-of-N signers.
    /// The `signers` parameter specifies which M signers are authorizing the release.
    pub fn release(e: Env, signers: Vec<Address>, token: Address) {
        let stored_signers: Vec<Address> = e
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .expect("not initialized");
        let threshold: u32 = e
            .storage()
            .instance()
            .get(&DataKey::Threshold)
            .expect("not initialized");
        let recipient: Address = e
            .storage()
            .instance()
            .get(&DataKey::Recipient)
            .expect("not initialized");

        if signers.len() < threshold {
            panic!("not enough signers provided");
        }

        // Ensure the provided signers are strictly sorted and contain no duplicates.
        // Without this check a single signer could supply the same signature multiple
        // times to reach the configured threshold. We require signers[0] < signers[1] <
        // ... < signers[n-1] which, by construction, also forbids duplicates.
        let mut prev_signer: Option<String> = None;
        for signer in signers.iter() {
            let signer_key = signer.to_string();
            if let Some(ref prev) = prev_signer {
                if *prev >= signer_key {
                    panic!("duplicate or out-of-order signer");
                }
            }
            prev_signer = Some(signer_key);

            // Verify the signer is one of the configured signers.
            let mut is_valid = false;
            for stored_signer in stored_signers.iter() {
                if signer == stored_signer {
                    is_valid = true;
                    break;
                }
            }
            if !is_valid {
                panic!("invalid signer provided");
            }

            // This will fail the entire transaction if the signer hasn't authorized this call.
            signer.require_auth();
        }

        // Get the current balance of the contract for the specified token.
        let token_client = token::Client::new(&e, &token);
        let balance = token_client.balance(&e.current_contract_address());

        if balance > 0 {
            token_client.transfer(&e.current_contract_address(), &recipient, &balance);
        }
    }

    /// Get the list of signers.
    pub fn get_signers(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or(Vec::new(&e))
    }

    /// Get the threshold.
    pub fn get_threshold(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Threshold).unwrap_or(0)
    }

    /// Get the recipient.
    pub fn get_recipient(e: Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Recipient)
            .expect("recipient not set")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, Vec,
    };
    use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Vec};

    #[test]
    fn test_multisig_escrow_release() {
        let e = Env::default();
        e.mock_all_auths();

        let signers = Vec::from_array(
            &e,
            [
                Address::generate(&e),
                Address::generate(&e),
                Address::generate(&e),
                Address::generate(&e),
                Address::generate(&e),
            ],
        );
        let threshold = 3;
        let recipient = Address::generate(&e);

        let contract_id = e.register(EscrowMultisig, ());
        let client = EscrowMultisigClient::new(&e, &contract_id);

        // Initialize the contract
        client.initialize(&signers, &threshold, &recipient);

        assert_eq!(client.get_signers(), signers);
        assert_eq!(client.get_threshold(), threshold);
        assert_eq!(client.get_recipient(), recipient);

        // Setup a mock token
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());
        let sac = StellarAssetClient::new(&e, &token_id);
        let token_client = TokenClient::new(&e, &token_id);

        // Mint tokens to the contract
        let deposit_amount = 1000;
        sac.mint(&contract_id, &deposit_amount);
        let token_id = e.register_stellar_asset_contract_v2(admin.clone());
        let token_client = StellarAssetClient::new(&e, &token_id.address());

        // Mint tokens to the contract
        let deposit_amount = 1000;
        token_client.mint(&contract_id, &deposit_amount);
        let token_client = token::Client::new(&e, &token_id.address());
        assert_eq!(token_client.balance(&contract_id), deposit_amount);

        // Prepare signers list (M-of-N)
        let m_signers = Vec::from_array(
            &e,
            [
                signers.get(0).unwrap(),
                signers.get(2).unwrap(),
                signers.get(4).unwrap(),
            ],
        );

        // Release tokens
        client.release(&m_signers, &token_id.address());

        // Check balance of recipient
        assert_eq!(token_client.balance(&recipient), deposit_amount);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    #[test]
    #[should_panic(expected = "not enough signers provided")]
    fn test_not_enough_signers() {
        let e = Env::default();
        e.mock_all_auths();

        let signers = Vec::from_array(
            &e,
            [
                Address::generate(&e),
                Address::generate(&e),
                Address::generate(&e),
            ],
        );
        let threshold = 2;
        let recipient = Address::generate(&e);

        let contract_id = e.register(EscrowMultisig, ());
        let client = EscrowMultisigClient::new(&e, &contract_id);

        client.initialize(&signers, &threshold, &recipient);

        let m_signers = Vec::from_array(&e, [signers.get(0).unwrap()]); // only 1 signer
        let token_id = Address::generate(&e); // dummy
        client.release(&m_signers, &token_id);
    }

    #[test]
    #[should_panic(expected = "invalid signer provided")]
    fn test_invalid_signer() {
        let e = Env::default();
        e.mock_all_auths();

        let signers = Vec::from_array(&e, [Address::generate(&e), Address::generate(&e)]);
        let threshold = 1;
        let recipient = Address::generate(&e);

        let contract_id = e.register(EscrowMultisig, ());
        let client = EscrowMultisigClient::new(&e, &contract_id);

        client.initialize(&signers, &threshold, &recipient);

        let m_signers = Vec::from_array(&e, [Address::generate(&e)]); // Random address not in signers
        let token_id = Address::generate(&e); // dummy
        client.release(&m_signers, &token_id);
    }

    #[test]
    #[should_panic(expected = "duplicate or out-of-order signer")]
    fn test_duplicate_signer_rejected() {
        let e = Env::default();
        e.mock_all_auths();

        let signers = Vec::from_array(
            &e,
            [
                Address::generate(&e),
                Address::generate(&e),
                Address::generate(&e),
            ],
        );
        let threshold = 2;
        let recipient = Address::generate(&e);

        let contract_id = e.register_contract(None, EscrowMultisig);
        let client = EscrowMultisigClient::new(&e, &contract_id);

        client.initialize(&signers, &threshold, &recipient);

        // The same signer is supplied twice and would otherwise satisfy the threshold.
        let dup = Vec::from_array(
            &e,
            [signers.get(0).unwrap(), signers.get(0).unwrap()],
        );
        let token_id = Address::generate(&e); // dummy
        client.release(&dup, &token_id);
    }

    #[test]
    fn test_sorted_unique_signers_accepted() {
        let e = Env::default();
        e.mock_all_auths();

        let a = Address::generate(&e);
        let b = Address::generate(&e);
        let c = Address::generate(&e);

        // Build the stored signer list in a deterministic order.
        let mut addrs = [a.clone(), b.clone(), c.clone()];
        addrs.sort_by(|x, y| x.to_string().cmp(&y.to_string()));
        let signers = Vec::from_array(&e, addrs.clone());

        let threshold = 2;
        let recipient = Address::generate(&e);

        let contract_id = e.register_contract(None, EscrowMultisig);
        let client = EscrowMultisigClient::new(&e, &contract_id);

        client.initialize(&signers, &threshold, &recipient);

        // Provide two distinct, strictly ordered signers.
        let mut chosen = [addrs[0].clone(), addrs[2].clone()];
        chosen.sort_by(|x, y| x.to_string().cmp(&y.to_string()));
        let m_signers = Vec::from_array(&e, chosen);

        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());
        let sac = StellarAssetClient::new(&e, &token_id);
        let token_client = TokenClient::new(&e, &token_id);
        sac.mint(&contract_id, &1000);

        client.release(&m_signers, &token_id);
        assert_eq!(token_client.balance(&recipient), 1000);
    }
}
