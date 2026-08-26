#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    SuperAdmin,
    IsPaused,
    /// Pause status per individual registered contract
    ContractPaused(Address),
}

#[contract]
pub struct SecurityRegistry;

#[contractimpl]
impl SecurityRegistry {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::SuperAdmin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::SuperAdmin, &admin);
        env.storage().instance().set(&DataKey::IsPaused, &false);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage().instance().set(&DataKey::IsPaused, &true);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage().instance().set(&DataKey::IsPaused, &false);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    // -------------------------------------------------------------------------
    // Per-contract pause registry
    // -------------------------------------------------------------------------

    /// Pause a specific registered contract.
    pub fn pause_contract(env: Env, admin: Address, contract_id: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage()
            .persistent()
            .set(&DataKey::ContractPaused(contract_id), &true);
    }

    /// Unpause a specific registered contract.
    pub fn unpause_contract(env: Env, admin: Address, contract_id: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage()
            .persistent()
            .set(&DataKey::ContractPaused(contract_id), &false);
    }

    /// Read-only query returning whether a specific contract is paused.
    pub fn is_contract_paused(env: Env, contract_id: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::ContractPaused(contract_id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{storage::Instance as _, Address as _};

    #[test]
    fn test_pause_unpause() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(SecurityRegistry, ());
        let client = SecurityRegistryClient::new(&env, &contract_id);

        client.initialize(&admin);
        assert!(!client.is_paused());

        let initial_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(initial_ttl >= anchorpoint_utils::storage::INSTANCE_EXTEND_TO);

        env.mock_all_auths();
        client.pause(&admin);
        assert!(client.is_paused());

        client.unpause(&admin);
        assert!(!client.is_paused());

        let pause_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(pause_ttl >= anchorpoint_utils::storage::INSTANCE_EXTEND_TO);

        client.unpause(&admin);
        assert!(!client.is_paused());

        let unpause_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(unpause_ttl >= anchorpoint_utils::storage::INSTANCE_EXTEND_TO);
    }

    #[test]
    fn test_is_contract_paused_default_false() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let registry_id = env.register(SecurityRegistry, ());
        let client = SecurityRegistryClient::new(&env, &registry_id);
        client.initialize(&admin);

        let some_contract = Address::generate(&env);
        assert!(!client.is_contract_paused(&some_contract));
    }

    #[test]
    fn test_pause_and_query_specific_contract() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let registry_id = env.register(SecurityRegistry, ());
        let client = SecurityRegistryClient::new(&env, &registry_id);
        client.initialize(&admin);

        let target = Address::generate(&env);
        let other = Address::generate(&env);

        assert!(!client.is_contract_paused(&target));

        client.pause_contract(&admin, &target);
        assert!(client.is_contract_paused(&target));
        // Other contract must remain unaffected
        assert!(!client.is_contract_paused(&other));

        client.unpause_contract(&admin, &target);
        assert!(!client.is_contract_paused(&target));
    }
}
