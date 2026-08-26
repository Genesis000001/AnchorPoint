#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal};

/// Multiplier for 4-decimal-place fixed-point health factor.
/// 10_000 represents 1.0000 (100%).
const HF_DECIMALS: i128 = 10_000;

#[contracttype]
pub struct Vault {
    pub owner: Address,
    pub collateral_amount: u128,
    pub debt_amount: u128,
}

#[contracttype]
pub enum DataKey {
    Vaults(u32),
    OracleId,
    CollateralToken,
    DebtToken,
    NextVaultId,
}

#[contract]
pub struct LiquidationEngine;

#[allow(deprecated)]
#[contractimpl]
impl LiquidationEngine {
    pub fn initialize(
        env: Env,
        oracle_id: Address,
        collateral_token: Address,
        debt_token: Address,
    ) {
        if env.storage().instance().has(&DataKey::OracleId) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::OracleId, &oracle_id);
        env.storage()
            .instance()
            .set(&DataKey::CollateralToken, &collateral_token);
        env.storage()
            .instance()
            .set(&DataKey::DebtToken, &debt_token);
        env.storage()
            .instance()
            .set(&DataKey::NextVaultId, &1u32);
    }

    pub fn create_vault(env: Env, owner: Address, collateral: u128, debt: u128) -> u32 {
        owner.require_auth();
        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextVaultId)
            .unwrap();

        let vault = Vault {
            owner: owner.clone(),
            collateral_amount: collateral,
            debt_amount: debt,
        };
        env.storage().persistent().set(&DataKey::Vaults(id), &vault);

        env.storage()
            .instance()
            .set(&DataKey::NextVaultId, &id.checked_add(1).expect("vault id overflow"));
        id
    }

    /// Returns the health factor for a vault, formatted to 4 decimal places.
    ///
    /// formula: `health_factor = (collateral_amount * collateral_price * HF_DECIMALS) / (debt_amount * debt_price)`
    ///
    /// A value >= 10_000 means the vault is fully collateralised (≥100%).
    /// Returns `i128::MAX` when `debt_amount` is 0 (no debt → infinite health).
    pub fn get_health_factor(env: Env, vault_id: u32) -> i128 {
        let vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vaults(vault_id))
            .expect("vault not found");

        if vault.debt_amount == 0 {
            return i128::MAX;
        }

        let oracle_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleId)
            .unwrap();
        let collateral_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::CollateralToken)
            .unwrap();
        let debt_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::DebtToken)
            .unwrap();

        let collateral_price: i128 = env.invoke_contract(
            &oracle_id,
            &symbol_short!("get_price"),
            soroban_sdk::vec![&env, collateral_token.into_val(&env)],
        );
        let debt_price: i128 = env.invoke_contract(
            &oracle_id,
            &symbol_short!("get_price"),
            soroban_sdk::vec![&env, debt_token.into_val(&env)],
        );

        let collateral_value_usd: i128 = (vault.collateral_amount as i128)
            .checked_mul(collateral_price)
            .expect("collateral value overflow");
        let debt_value_usd: i128 = (vault.debt_amount as i128)
            .checked_mul(debt_price)
            .expect("debt value overflow");

        if debt_value_usd == 0 {
            return i128::MAX;
        }

        collateral_value_usd
            .checked_mul(HF_DECIMALS)
            .expect("health factor overflow")
            / debt_value_usd
    }

    pub fn liquidate(env: Env, liquidator: Address, vault_id: u32) {
        liquidator.require_auth();
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vaults(vault_id))
            .expect("vault not found");

        let oracle_id: Address = env.storage().instance().get(&DataKey::OracleId).unwrap();

        let collateral_price: u128 = env.invoke_contract(
            &oracle_id,
            &symbol_short!("get_price"),
            soroban_sdk::vec![&env],
        );

        let collateral_value = vault
            .collateral_amount
            .checked_mul(collateral_price)
            .expect("value overflow");
        // Assume debt is represented in same base units. Health factor * 100
        let health_factor = collateral_value
            .checked_mul(100)
            .expect("health factor overflow")
            / vault.debt_amount;

        assert!(health_factor < 120, "vault is healthy"); // 120% min health factor
        let health_factor = Self::get_health_factor(env.clone(), vault_id);
        assert!(health_factor < 12_000, "vault is healthy"); // 120% min

        // Liquidator incentive: 5% spread + 10 units fixed fee
        let incentive = vault
            .collateral_amount
            .checked_mul(5)
            .expect("incentive overflow")
            / 100
            + 10;
        let _liquidated_collateral = vault.collateral_amount;

        vault.collateral_amount = 0;
        vault.debt_amount = 0; // Assume debt fully cleared by liquidation
        vault.debt_amount = 0;

        env.storage()
            .persistent()
            .set(&DataKey::Vaults(vault_id), &vault);

        // Topic: event name only; vault_id (u32) + liquidator + incentive in data.
        env.events().publish(
            (symbol_short!("amm"), symbol_short!("liquidate")),
            (vault_id, liquidator, incentive),
        );
    }

    pub fn partial_liquidate(
        env: Env,
        liquidator: Address,
        vault_id: u32,
        liquidate_amount: u128,
    ) {
        liquidator.require_auth();
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vaults(vault_id))
            .expect("vault not found");

        assert!(liquidate_amount > 0, "liquidate amount must be positive");
        assert!(
            liquidate_amount <= vault.debt_amount,
            "cannot liquidate more than debt"
        );

        let oracle_id: Address = env.storage().instance().get(&DataKey::OracleId).unwrap();

        // Fetch collateral price from oracle
        let collateral_price: u128 = env.invoke_contract(
            &oracle_id,
            &symbol_short!("get_price"),
            soroban_sdk::vec![&env],
        );

        let collateral_value = vault.collateral_amount * collateral_price;
        let health_factor = (collateral_value * 100) / vault.debt_amount;

        // Allow partial liquidation for vaults below 150% health factor (less strict than full liquidation)
        assert!(
            health_factor < 150,
            "vault is healthy for partial liquidation"
        );

        // Calculate collateral to liquidate proportional to debt being repaid
        let collateral_ratio = vault.collateral_amount / vault.debt_amount;
        let collateral_to_liquidate = liquidate_amount * collateral_ratio;

        // Liquidator incentive: 3% spread for partial liquidations (lower incentive than full)
        let incentive = (collateral_to_liquidate * 3) / 100;

        // Update vault
        let health_factor = Self::get_health_factor(env.clone(), vault_id);
        assert!(
            health_factor < 15_000,
            "vault is healthy for partial liquidation"
        );

        let collateral_ratio = vault.collateral_amount / vault.debt_amount;
        let collateral_to_liquidate = liquidate_amount * collateral_ratio;

        let incentive = (collateral_to_liquidate * 3) / 100;

        vault.collateral_amount -= collateral_to_liquidate + incentive;
        vault.debt_amount -= liquidate_amount;

        env.storage()
            .persistent()
            .set(&DataKey::Vaults(vault_id), &vault);

        // Emit partial liquidation event
        env.events().publish(
            (symbol_short!("p_liquid"), vault_id, liquidator),
            (liquidate_amount, collateral_to_liquidate, incentive),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[contracttype]
    enum MockDataKey {
        Price(Address),
    }

    #[contract]
    struct MockOracleConsumer;

    #[contractimpl]
    impl MockOracleConsumer {
        pub fn set_price(env: Env, asset: Address, price: i128) {
            env.storage()
                .instance()
                .set(&MockDataKey::Price(asset), &price);
        }

        pub fn get_price(env: Env, asset: Address) -> i128 {
            env.storage()
                .instance()
                .get(&MockDataKey::Price(asset))
                .expect("mock price not set")
        }
    }

    fn setup() -> (
        Env,
        LiquidationEngineClient<'static>,
        Address,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let collateral_token = Address::generate(&env);
        let debt_token = Address::generate(&env);

        let oracle_id = env.register(MockOracleConsumer, ());
        let oracle = MockOracleConsumerClient::new(&env, &oracle_id);
        // Both tokens at $1.00 in 1e8 base units
        oracle.set_price(&collateral_token, &100_000_000);
        oracle.set_price(&debt_token, &100_000_000);

        let contract_id = env.register(LiquidationEngine, ());
        let client = LiquidationEngineClient::new(&env, &contract_id);
        client.initialize(&oracle_id, &collateral_token, &debt_token);

        (env, client, oracle_id, collateral_token, debt_token)
    }

    #[test]
    fn test_mock_oracle_works() {
        let env = Env::default();
        env.mock_all_auths();
        let oracle_id = env.register(MockOracleConsumer, ());
        let oracle = MockOracleConsumerClient::new(&env, &oracle_id);
        let asset = Address::generate(&env);
        oracle.set_price(&asset, &42);
        let price = oracle.get_price(&asset);
        assert_eq!(price, 42);
    }

    #[test]
    fn test_healthy_vault() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        // 2 * $1 = $2 collateral, 1 * $1 = $1 debt → HF = 20000 (2.0000)
        let vid = client.create_vault(&user, &2u128, &1u128);
        let hf = client.get_health_factor(&vid);
        assert_eq!(hf, 20_000);
    }

    #[test]
    fn test_underwater_vault() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        // 1 * $1 = $1 collateral, 2 * $1 = $2 debt → HF = 5000 (0.5000)
        let vid = client.create_vault(&user, &1u128, &2u128);
        let hf = client.get_health_factor(&vid);
        assert_eq!(hf, 5_000);
    }

    #[test]
    fn test_zero_debt_returns_max() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let vid = client.create_vault(&user, &10u128, &0u128);
        assert_eq!(client.get_health_factor(&vid), i128::MAX);
    }

    #[test]
    fn test_price_change_affects_health() {
        let (_env, client, oracle_id, ct, dt) = setup();
        let oracle = MockOracleConsumerClient::new(&_env, &oracle_id);
        let user = Address::generate(&_env);
        // Collateral drops to $0.50, debt stays at $1.00
        oracle.set_price(&ct, &50_000_000);
        oracle.set_price(&dt, &100_000_000);

        let vid = client.create_vault(&user, &2u128, &1u128);
        // 2 * $0.50 = $1 collateral, 1 * $1 = $1 debt → HF = 10000 (1.0000)
        let hf = client.get_health_factor(&vid);
        assert_eq!(hf, 10_000);
    }

    #[test]
    fn test_liquidate_unhealthy_vault() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let liquidator = Address::generate(&_env);

        // 1 * $1 = $1 collateral, 2 * $1 = $2 debt → HF = 5000 (< 12000) → eligible
        let vid = client.create_vault(&user, &1u128, &2u128);
        client.liquidate(&liquidator, &vid);

        // After liquidation the vault is cleared (debt = 0), so health is infinite
        assert_eq!(client.get_health_factor(&vid), i128::MAX);
    }

    #[test]
    #[should_panic(expected = "vault is healthy")]
    fn test_liquidate_healthy_vault_panics() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let liquidator = Address::generate(&_env);

        // 2 * $1 = $2 collateral, 1 * $1 = $1 debt → HF = 20000 (> 12000) → not eligible
        let vid = client.create_vault(&user, &2u128, &1u128);
        client.liquidate(&liquidator, &vid);
    }

    #[test]
    fn test_partial_liquidate_unhealthy_vault() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let liquidator = Address::generate(&_env);

        // 1 * $1 = $1 collateral, 1 * $1 = $1 debt → HF = 10000 (< 15000) → eligible for partial
        let vid = client.create_vault(&user, &1u128, &1u128);
        client.partial_liquidate(&liquidator, &vid, &1u128);
    }

    #[test]
    #[should_panic(expected = "vault is healthy for partial liquidation")]
    fn test_partial_liquidate_healthy_vault_panics() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let liquidator = Address::generate(&_env);

        // 2 * $1 = $2 collateral, 1 * $1 = $1 debt → HF = 20000 (> 15000) → not eligible
        let vid = client.create_vault(&user, &2u128, &1u128);
        client.partial_liquidate(&liquidator, &vid, &1u128);
    }
}
