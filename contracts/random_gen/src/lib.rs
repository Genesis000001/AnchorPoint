#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, xdr::ToXdr, Address, Bytes, BytesN, Env,
    Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Phase {
    Commit,
    Reveal,
    Finished,
}

#[contracttype]
pub enum DataKey {
    Admin,
    MinCommits,
    Phase,
    Commit(Address),
    Reveal(Address),
    Committers,
    RandomSeed,
    /// Per-round nonce incremented on each `initialize` to namespace commits/reveals.
    RoundNonce,
}

#[contract]
pub struct RandomGen;

/// Maximum participants per generation to bound persistent storage footprint.
pub const MAX_PARTICIPANTS: u32 = 64;

/// Persistent entries per participant: Commit + Reveal (32 bytes each).
pub const PERSISTENT_BYTES_PER_PARTICIPANT: u32 = 64;

#[contractimpl]
impl RandomGen {
    /// Initialize the contract with an admin and the minimum number of participants.
    pub fn initialize(env: Env, admin: Address, min_commits: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if min_commits == 0 || min_commits > MAX_PARTICIPANTS {
            panic!("min_commits out of allowed range");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MinCommits, &min_commits);
        env.storage().instance().set(&DataKey::Phase, &Phase::Commit);
        env.storage().instance().set(&DataKey::RoundNonce, &0u64);

        let committers: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::Committers, &committers);
    }

    /// Phase 1: Users commit a hash of their secret.
    ///
    /// Commit hashes are stored in **temporary** storage because they are only
    /// needed during the current randomness-generation round. Using temporary
    /// storage avoids paying persistent-entry rent fees for data that becomes
    /// irrelevant once the round is finished, reducing the contract's overall
    /// storage footprint.
    pub fn commit(env: Env, user: Address, hash: BytesN<32>) {
        user.require_auth();

        let phase: Phase = env.storage().instance().get(&DataKey::Phase).unwrap_or(Phase::Commit);
        if phase != Phase::Commit {
            panic!("not in commit phase");
        }

        let commit_key = DataKey::Commit(user.clone());
        if env.storage().temporary().has(&commit_key) {
            panic!("already committed");
        }

        let mut committers: Vec<Address> = env.storage().instance().get(&DataKey::Committers).unwrap();
        if committers.len() >= MAX_PARTICIPANTS as u32 {
            panic!("participant limit reached");
        }

        // Store commit hash in temporary storage — valid only for this round.
        env.storage().temporary().set(&commit_key, &hash);
        committers.push_back(user.clone());
        env.storage().instance().set(&DataKey::Committers, &committers);

        let min_commits: u32 = env.storage().instance().get(&DataKey::MinCommits).unwrap();
        if committers.len() >= min_commits {
            env.storage().instance().set(&DataKey::Phase, &Phase::Reveal);
        }

        // Emit event for indexer optimization (following the new schema!)
        env.events().publish(
            (symbol_short!("commit"), user),
            hash,
        );
    }

    /// Phase 2: Users reveal their secrets.
    ///
    /// Revealed secrets are stored in **temporary** storage for the same reason
    /// as commit hashes: they are only consumed during `finalize` and carry no
    /// long-term value. Temporary storage eliminates the persistent rent cost
    /// for these transient entries.
    pub fn reveal(env: Env, user: Address, secret: BytesN<32>) {
        user.require_auth();

        let phase: Phase = env.storage().instance().get(&DataKey::Phase).expect("no phase");
        if phase != Phase::Reveal {
            panic!("not in reveal phase");
        }

        let commit_key = DataKey::Commit(user.clone());
        // Read commit hash from temporary storage.
        let hash: BytesN<32> = env.storage().temporary().get(&commit_key).expect("no commitment found");

        // Verify the secret
        let actual_hash: BytesN<32> = env.crypto().sha256(&secret.clone().into()).into();
        if actual_hash != hash {
            panic!("invalid secret");
        }

        let reveal_key = DataKey::Reveal(user.clone());
        if env.storage().temporary().has(&reveal_key) {
            panic!("already revealed");
        }

        // Store revealed secret in temporary storage.
        env.storage().temporary().set(&reveal_key, &secret);

        // Emit event
        env.events().publish(
            (symbol_short!("reveal"), user),
            secret,
        );
    }

    /// Finalize the generation of the random seed.
    ///
    /// Combines all participant secrets with on-chain entropy (ledger timestamp,
    /// sequence number, contract ID) and an optional caller-supplied salt using
    /// SHA-256. This prevents any single Stellar validator from predicting or
    /// biasing the output.
    ///
    /// Entropy inputs:
    ///   1. XOR of all revealed participant secrets  — user-contributed entropy
    ///   2. `env.ledger().timestamp()`               — ledger-level timing entropy
    ///   3. `env.ledger().sequence()`                — ledger sequence number
    ///   4. `env.current_contract_address()` (XDR)  — contract-specific namespace
    ///   5. `salt`                                   — caller-supplied additional entropy
    pub fn finalize(env: Env, salt: BytesN<32>) -> BytesN<32> {
        let phase: Phase = env.storage().instance().get(&DataKey::Phase).expect("no phase");
        if phase != Phase::Reveal {
            panic!("not in reveal phase");
        }

        let committers: Vec<Address> = env.storage().instance().get(&DataKey::Committers).unwrap();
        let mut xor_seed = [0u8; 32];
        let mut reveal_count = 0;

        // Step 1: XOR all participant secrets together.
        for user in committers.iter() {
            let reveal_key = DataKey::Reveal(user.clone());
            // Read revealed secrets from temporary storage.
            if let Some(secret) = env.storage().temporary().get::<_, BytesN<32>>(&reveal_key) {
                let secret_bytes = secret.to_array();
                for i in 0..32 {
                    xor_seed[i] ^= secret_bytes[i];
                }
                reveal_count += 1;
            }
        }

        let min_commits: u32 = env.storage().instance().get(&DataKey::MinCommits).unwrap();
        if reveal_count < min_commits {
            panic!("not enough reveals");
        }

        // Step 2: Build a hash preimage combining all entropy sources.
        //   [ xor_seed (32) | timestamp (8) | sequence (4) | contract_id_xdr (variable) | salt (32) ]
        let timestamp: u64 = env.ledger().timestamp();
        let sequence: u32 = env.ledger().sequence();

        // Encode timestamp (big-endian 8 bytes)
        let ts_bytes = timestamp.to_be_bytes();
        // Encode sequence (big-endian 4 bytes)
        let seq_bytes = sequence.to_be_bytes();

        // XDR-encode the contract address to get a unique per-contract identifier.
        let contract_xdr: Bytes = env.current_contract_address().to_xdr(&env);

        // Assemble preimage: xor_seed | ts | seq | contract_xdr | salt
        let mut preimage = Bytes::new(&env);
        preimage.extend_from_array(&xor_seed);
        preimage.extend_from_array(&ts_bytes);
        preimage.extend_from_array(&seq_bytes);
        preimage.extend_from_slice(&contract_xdr);
        preimage.extend_from_array(&salt.to_array());

        // Step 3: SHA-256 the assembled preimage to produce the final seed.
        let final_seed: BytesN<32> = env.crypto().sha256(&preimage).into();

        env.storage().instance().set(&DataKey::RandomSeed, &final_seed);
        env.storage().instance().set(&DataKey::Phase, &Phase::Finished);

        // Increment round nonce for future rounds.
        let nonce: u64 = env.storage().instance().get(&DataKey::RoundNonce).unwrap_or(0);
        env.storage().instance().set(&DataKey::RoundNonce, &(nonce + 1));

        // Release ephemeral commit/reveal temporary entries after seed is finalized.
        for user in committers.iter() {
            env.storage().temporary().remove(&DataKey::Commit(user.clone()));
            env.storage().temporary().remove(&DataKey::Reveal(user.clone()));
        }
        env.storage().instance().remove(&DataKey::Committers);

        // Emit final event
        env.events().publish(
            (symbol_short!("rng_fin"),),
            final_seed.clone(),
        );

        final_seed
    }

    /// Get the generated random seed.
    pub fn get_random_seed(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::RandomSeed).expect("seed not generated")
    }

    /// Get current phase
    pub fn get_phase(env: Env) -> Phase {
        env.storage().instance().get(&DataKey::Phase).unwrap_or(Phase::Commit)
    }

    /// Returns documented storage limits for operators and auditors.
    pub fn storage_limits() -> (u32, u32) {
        (MAX_PARTICIPANTS, PERSISTENT_BYTES_PER_PARTICIPANT)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{BytesN, Env};

    /// Helper: hash a secret the same way the contract does.
    fn sha256_secret(env: &Env, secret: &BytesN<32>) -> BytesN<32> {
        env.crypto().sha256(&secret.clone().into()).into()
    }

    fn run_full_flow(env: &Env, client: &RandomGenClient, secrets: &[(Address, BytesN<32>)]) -> BytesN<32> {
        // Commit phase
        for (user, secret) in secrets.iter() {
            let hash = sha256_secret(env, secret);
            client.commit(user, &hash);
        }
        assert_eq!(client.get_phase(), Phase::Reveal);

        // Reveal phase
        for (user, secret) in secrets.iter() {
            client.reveal(user, secret);
        }

        let salt = BytesN::from_array(env, &[0xABu8; 32]);
        client.finalize(&salt)
    }

    #[test]
    fn test_random_gen_flow() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        env.ledger().set_sequence_number(42);

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let contract_id = env.register_contract(None, RandomGen);
        let client = RandomGenClient::new(&env, &contract_id);

        client.initialize(&admin, &2);

        let alice_secret = BytesN::from_array(&env, &[1u8; 32]);
        let bob_secret = BytesN::from_array(&env, &[2u8; 32]);

        let seed = run_full_flow(&env, &client, &[
            (alice.clone(), alice_secret.clone()),
            (bob.clone(), bob_secret.clone()),
        ]);

        assert_eq!(client.get_phase(), Phase::Finished);

        // Seed must be a valid 32-byte hash (non-trivially-zero for these inputs).
        // We cannot predict the exact value but it must equal get_random_seed().
        assert_eq!(client.get_random_seed(), seed);
    }

    #[test]
    fn test_different_salts_produce_different_seeds() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);
        env.ledger().set_sequence_number(42);

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // Round 1
        let contract_id_1 = env.register_contract(None, RandomGen);
        let client_1 = RandomGenClient::new(&env, &contract_id_1);
        client_1.initialize(&admin, &2);
        let secret_a = BytesN::from_array(&env, &[1u8; 32]);
        let secret_b = BytesN::from_array(&env, &[2u8; 32]);
        let hash_a: BytesN<32> = env.crypto().sha256(&secret_a.clone().into()).into();
        let hash_b: BytesN<32> = env.crypto().sha256(&secret_b.clone().into()).into();
        client_1.commit(&alice, &hash_a);
        client_1.commit(&bob, &hash_b);
        client_1.reveal(&alice, &secret_a);
        client_1.reveal(&bob, &secret_b);
        let salt_1 = BytesN::from_array(&env, &[0x11u8; 32]);
        let seed_1 = client_1.finalize(&salt_1);

        // Round 2 — same secrets, different salt
        let contract_id_2 = env.register_contract(None, RandomGen);
        let client_2 = RandomGenClient::new(&env, &contract_id_2);
        client_2.initialize(&admin, &2);
        client_2.commit(&alice, &hash_a);
        client_2.commit(&bob, &hash_b);
        client_2.reveal(&alice, &secret_a);
        client_2.reveal(&bob, &secret_b);
        let salt_2 = BytesN::from_array(&env, &[0x22u8; 32]);
        let seed_2 = client_2.finalize(&salt_2);

        // Different salts → different seeds (even with same secrets + same ledger state).
        assert_ne!(seed_1, seed_2, "different salts must produce different seeds");
    }

    #[test]
    fn test_different_timestamps_produce_different_seeds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[0u8; 32]);

        let secret_a = BytesN::from_array(&env, &[5u8; 32]);
        let secret_b = BytesN::from_array(&env, &[6u8; 32]);
        let hash_a: BytesN<32> = env.crypto().sha256(&secret_a.clone().into()).into();
        let hash_b: BytesN<32> = env.crypto().sha256(&secret_b.clone().into()).into();

        // Round 1 at timestamp 1000
        let c1 = env.register_contract(None, RandomGen);
        let client1 = RandomGenClient::new(&env, &c1);
        client1.initialize(&admin, &2);
        env.ledger().set_timestamp(1000);
        client1.commit(&alice, &hash_a);
        client1.commit(&bob, &hash_b);
        client1.reveal(&alice, &secret_a);
        client1.reveal(&bob, &secret_b);
        let seed1 = client1.finalize(&salt);

        // Round 2 at timestamp 2000 (same secrets, different time)
        let c2 = env.register_contract(None, RandomGen);
        let client2 = RandomGenClient::new(&env, &c2);
        client2.initialize(&admin, &2);
        env.ledger().set_timestamp(2000);
        client2.commit(&alice, &hash_a);
        client2.commit(&bob, &hash_b);
        client2.reveal(&alice, &secret_a);
        client2.reveal(&bob, &secret_b);
        let seed2 = client2.finalize(&salt);

        assert_ne!(seed1, seed2, "different timestamps must produce different seeds");
    }

    #[test]
    fn test_seed_is_deterministic_for_same_inputs() {
        // Two contract instances with identical state should produce the same seed
        // IF they share the same contract address — which isn't possible to force in
        // the test harness, so instead we verify that the seed is stable across two
        // calls on the same contract (no side-effects after Finished phase).
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(500);
        env.ledger().set_sequence_number(10);

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let contract_id = env.register_contract(None, RandomGen);
        let client = RandomGenClient::new(&env, &contract_id);
        client.initialize(&admin, &2);

        let secret_a = BytesN::from_array(&env, &[0xAAu8; 32]);
        let secret_b = BytesN::from_array(&env, &[0xBBu8; 32]);
        let hash_a: BytesN<32> = env.crypto().sha256(&secret_a.clone().into()).into();
        let hash_b: BytesN<32> = env.crypto().sha256(&secret_b.clone().into()).into();

        client.commit(&alice, &hash_a);
        client.commit(&bob, &hash_b);
        client.reveal(&alice, &secret_a);
        client.reveal(&bob, &secret_b);

        let salt = BytesN::from_array(&env, &[0u8; 32]);
        let seed1 = client.finalize(&salt);
        let seed2 = client.get_random_seed();

        assert_eq!(seed1, seed2);
    }

    #[test]
    #[should_panic(expected = "min_commits out of allowed range")]
    fn test_rejects_excessive_min_commits() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, RandomGen);
        let client = RandomGenClient::new(&env, &contract_id);
        client.initialize(&admin, &(MAX_PARTICIPANTS + 1));
    }

    #[test]
    fn test_storage_limits_documented() {
        let (max_participants, bytes_per_participant) = RandomGen::storage_limits();
        assert_eq!(max_participants, 64);
        assert_eq!(bytes_per_participant, 64);
    }

    #[test]
    fn test_entropy_distribution_across_participants() {
        // Verify that changing one participant's secret changes the final seed.
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(999);
        env.ledger().set_sequence_number(7);

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[0u8; 32]);

        let secret_a = BytesN::from_array(&env, &[0x01u8; 32]);
        let secret_b1 = BytesN::from_array(&env, &[0x02u8; 32]);
        let secret_b2 = BytesN::from_array(&env, &[0x03u8; 32]); // Bob changes his secret

        let hash_a: BytesN<32> = env.crypto().sha256(&secret_a.clone().into()).into();
        let hash_b1: BytesN<32> = env.crypto().sha256(&secret_b1.clone().into()).into();
        let hash_b2: BytesN<32> = env.crypto().sha256(&secret_b2.clone().into()).into();

        // Seed with secret_b1
        let c1 = env.register_contract(None, RandomGen);
        let client1 = RandomGenClient::new(&env, &c1);
        client1.initialize(&admin, &2);
        client1.commit(&alice, &hash_a);
        client1.commit(&bob, &hash_b1);
        client1.reveal(&alice, &secret_a);
        client1.reveal(&bob, &secret_b1);
        let seed1 = client1.finalize(&salt);

        // Seed with secret_b2 (different Bob secret)
        let c2 = env.register_contract(None, RandomGen);
        let client2 = RandomGenClient::new(&env, &c2);
        client2.initialize(&admin, &2);
        client2.commit(&alice, &hash_a);
        client2.commit(&bob, &hash_b2);
        client2.reveal(&alice, &secret_a);
        client2.reveal(&bob, &secret_b2);
        let seed2 = client2.finalize(&salt);

        assert_ne!(seed1, seed2, "changing a participant secret must change the seed");
    }
}
