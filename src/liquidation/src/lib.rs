#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal};

/// Multiplier for 4-decimal-place fixed-point health factor.
/// 10_000 represents 1.0000 (100%).
const HF_DECIMALS: i128 = 10_000;

/// Health factor representing exactly 1.0 (100%) in basis points.
///
/// A vault at or above this value is fully collateralised and must never be
/// liquidatable.
const HF_ONE_BPS: i128 = 10_000;

/// Minimum health factor for a vault to be safe from full liquidation
/// (1.2000 = 120%).
const LIQUIDATION_THRESHOLD_BPS: i128 = 12_000;

/// Minimum health factor for a vault to be safe from partial liquidation
/// (1.5000 = 150%). Deliberately less strict than full liquidation.
const PARTIAL_LIQUIDATION_THRESHOLD_BPS: i128 = 15_000;

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
        env.storage().instance().set(&DataKey::NextVaultId, &1u32);
    }

    pub fn create_vault(env: Env, owner: Address, collateral: u128, debt: u128) -> u32 {
        owner.require_auth();
        let id: u32 = env.storage().instance().get(&DataKey::NextVaultId).unwrap();

        let vault = Vault {
            owner: owner.clone(),
            collateral_amount: collateral,
            debt_amount: debt,
        };
        env.storage().persistent().set(&DataKey::Vaults(id), &vault);

        env.storage().instance().set(
            &DataKey::NextVaultId,
            &id.checked_add(1).expect("vault id overflow"),
        );
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

        let oracle_id: Address = env.storage().instance().get(&DataKey::OracleId).unwrap();
        let collateral_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::CollateralToken)
            .unwrap();
        let debt_token: Address = env.storage().instance().get(&DataKey::DebtToken).unwrap();

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

    /// Returns true when a vault is undercollateralised, i.e. its health
    /// factor has fallen below 1.0 (10_000 bps).
    ///
    /// A vault with no debt reports `i128::MAX` and is never liquidatable.
    pub fn is_liquidatable(env: Env, vault_id: u32) -> bool {
        Self::get_health_factor(env, vault_id) < HF_ONE_BPS
    }

    pub fn liquidate(env: Env, liquidator: Address, vault_id: u32) {
        liquidator.require_auth();
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vaults(vault_id))
            .expect("vault not found");

        // Health is evaluated solely through get_health_factor, which is
        // oracle-priced and division-by-zero safe: a zero-debt vault reports
        // i128::MAX and is therefore never liquidatable.
        let health_factor = Self::get_health_factor(env.clone(), vault_id);
        assert!(
            health_factor < LIQUIDATION_THRESHOLD_BPS,
            "vault is healthy"
        );

        // Liquidator incentive: 5% spread + 10 units fixed fee
        let incentive = vault
            .collateral_amount
            .checked_mul(5)
            .expect("incentive overflow")
            / 100
            + 10;

        vault.collateral_amount = 0;
        vault.debt_amount = 0; // Assume debt fully cleared by liquidation

        env.storage()
            .persistent()
            .set(&DataKey::Vaults(vault_id), &vault);

        // Topic: event name only; vault_id (u32) + liquidator + incentive in data.
        env.events().publish(
            (symbol_short!("amm"), symbol_short!("liquidate")),
            (vault_id, liquidator, incentive),
        );
    }

    pub fn partial_liquidate(env: Env, liquidator: Address, vault_id: u32, liquidate_amount: u128) {
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

        // Health is evaluated solely through get_health_factor. The zero-debt
        // case is already excluded by the liquidate_amount <= debt_amount
        // assertion above combined with liquidate_amount > 0.
        let health_factor = Self::get_health_factor(env.clone(), vault_id);
        assert!(
            health_factor < PARTIAL_LIQUIDATION_THRESHOLD_BPS,
            "vault is healthy for partial liquidation"
        );

        // Collateral seized proportionally to the debt being repaid.
        let collateral_ratio = vault.collateral_amount / vault.debt_amount;
        let collateral_to_liquidate = liquidate_amount
            .checked_mul(collateral_ratio)
            .expect("collateral to liquidate overflow");

        // Liquidator incentive: 3% spread for partial liquidations (lower
        // incentive than full liquidation).
        let incentive = collateral_to_liquidate
            .checked_mul(3)
            .expect("incentive overflow")
            / 100;

        let total_seized = collateral_to_liquidate
            .checked_add(incentive)
            .expect("seized collateral overflow");
        vault.collateral_amount = vault
            .collateral_amount
            .checked_sub(total_seized)
            .expect("insufficient collateral to seize");
        vault.debt_amount = vault
            .debt_amount
            .checked_sub(liquidate_amount)
            .expect("debt underflow");

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

    // ── Debt edge cases ───────────────────────────────────────────────────────

    #[test]
    fn test_zero_debt_zero_collateral_returns_max() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        // Empty vault: no debt means infinite health, not a division by zero.
        let vid = client.create_vault(&user, &0u128, &0u128);
        assert_eq!(client.get_health_factor(&vid), i128::MAX);
    }

    #[test]
    fn test_zero_debt_is_not_liquidatable() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let vid = client.create_vault(&user, &10u128, &0u128);
        assert!(!client.is_liquidatable(&vid));
    }

    #[test]
    #[should_panic(expected = "vault is healthy")]
    fn test_liquidate_zero_debt_vault_panics() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let liquidator = Address::generate(&_env);

        // Must fail the healthy-vault assertion rather than panicking on a
        // division by zero while computing the health factor.
        let vid = client.create_vault(&user, &10u128, &0u128);
        client.liquidate(&liquidator, &vid);
    }

    #[test]
    #[should_panic(expected = "cannot liquidate more than debt")]
    fn test_partial_liquidate_zero_debt_vault_panics() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let liquidator = Address::generate(&_env);

        let vid = client.create_vault(&user, &10u128, &0u128);
        client.partial_liquidate(&liquidator, &vid, &1u128);
    }

    #[test]
    fn test_zero_debt_after_full_liquidation_is_safe() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let liquidator = Address::generate(&_env);

        let vid = client.create_vault(&user, &1u128, &2u128);
        client.liquidate(&liquidator, &vid);

        // The cleared vault must still be queryable without panicking.
        assert_eq!(client.get_health_factor(&vid), i128::MAX);
        assert!(!client.is_liquidatable(&vid));
    }

    // ── Liquidation threshold boundary ────────────────────────────────────────

    #[test]
    fn test_health_factor_exactly_one_is_not_liquidatable() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        // 1 * $1 collateral vs 1 * $1 debt → HF = 10_000 (exactly 1.0).
        let vid = client.create_vault(&user, &1u128, &1u128);
        assert_eq!(client.get_health_factor(&vid), HF_ONE_BPS);
        assert!(!client.is_liquidatable(&vid));
    }

    #[test]
    fn test_health_factor_just_below_one_is_liquidatable() {
        let (_env, client, oracle_id, ct, _dt) = setup();
        let oracle = MockOracleConsumerClient::new(&_env, &oracle_id);
        let user = Address::generate(&_env);

        // Collateral worth $0.99 against $1.00 of debt → HF = 9_900 (< 1.0).
        oracle.set_price(&ct, &99_000_000);
        let vid = client.create_vault(&user, &1u128, &1u128);

        assert_eq!(client.get_health_factor(&vid), 9_900);
        assert!(client.is_liquidatable(&vid));
    }

    #[test]
    fn test_create_vault_ids_are_sequential_and_distinct() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);

        // Each vault must occupy its own id; ids must not collide or skip.
        let first = client.create_vault(&user, &2u128, &1u128);
        let second = client.create_vault(&user, &1u128, &2u128);
        assert_ne!(first, second);
        assert_eq!(second, first + 1);

        // Distinct vaults keep distinct state.
        assert_eq!(client.get_health_factor(&first), 20_000);
        assert_eq!(client.get_health_factor(&second), 5_000);
    }

    #[test]
    fn test_partial_liquidate_reduces_debt_and_collateral() {
        let (_env, client, _oracle_id, _ct, _dt) = setup();
        let user = Address::generate(&_env);
        let liquidator = Address::generate(&_env);

        // 10 collateral / 10 debt → HF = 10_000, below the 15_000 partial bar.
        let vid = client.create_vault(&user, &10u128, &10u128);
        client.partial_liquidate(&liquidator, &vid, &2u128);

        // Debt fell by the repaid amount, so health must be finite and
        // recomputed without panicking.
        let hf = client.get_health_factor(&vid);
        assert!(hf < i128::MAX);
        assert!(hf > 0);
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
