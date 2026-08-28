#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String, Vec, IntoVal, Map, Symbol
};

use reentrancy_guard::ReentrancyGuard;
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, Env, String, Vec, IntoVal, Map, Symbol
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    AmountNotPositive = 2,
    RptOverflow = 3,
    ContractPaused = 4,
    LockTimeOverflow = 5,
    NotTokenOwner = 6,
    StakeLocked = 7,
    NoStakeFound = 8,
    TotalStakedUnderflow = 9,
    TotalStakedOverflow = 10,
    RewardsOverflow = 11,
    AdminNotFound = 12,
    OnlyAdmin = 13,
    MetadataUriTooLong = 14,
}


const PRECISION: i128 = 1_000_000_000_000_000_000;

/// Basis points denominator (10_000 = 100%).
const MAX_BPS: i128 = 10_000;

/// Default emergency-withdraw penalty in basis points (10% = 1_000 bps).
const DEFAULT_EMERGENCY_FEE_BPS: i128 = 1_000;

/// Maximum length, in bytes, of any metadata URI or description string.
///
/// Bounds the storage rental a single metadata update can commit the
/// contract to, and keeps values within a size integrators can handle.
const MAX_METADATA_LEN: u32 = 256;

#[contracttype]
pub enum DataKey {
    Admin,
    StakeToken,
    RewardToken,
    NftContract,
    TotalStaked,
    RewardPerTokenStored,
    StakeAmount(u64),             // NFT ID -> Staked amount
    StakeLockTime(u64),           // NFT ID -> Lock expiration timestamp
    NftRewardPerTokenPaid(u64),   // NFT ID -> Snapshot
    NftRewards(u64),              // NFT ID -> Accrued rewards
    /// Branding / project metadata (description, icon_url, website)
    ContractMeta,
    /// Whether contract is paused for emergency
    Paused,
    /// Ledger-sequence checkpoint of RewardPerTokenStored.
    /// Allows querying the accumulator value at past reward distributions.
    RewardPerTokenCheckpoint(u32),
    /// Emergency-withdraw fee in basis points (default DEFAULT_EMERGENCY_FEE_BPS).
    EmergencyFeeBps,
}

/// Contract-level errors.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    /// A recursive (re-entrant) call was detected on a guarded function.
    ReentrancyDetected = 1,
}

/// On-chain branding metadata for the contract.
///
/// Stored independently of staking logic so it can be updated at any time
/// by the admin without touching the core contract state.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractMetadata {
    /// Human-readable description of the contract.
    pub description: String,
    /// URL pointing to the project icon / logo.
    pub icon_url: String,
    /// Project or protocol website URL.
    pub website: String,
}

#[contracttype]
pub struct NftAttribute {
    pub display_type: String,
    pub trait_type: String,
    pub value: String,
    pub max_value: String,
}

#[contracttype]
pub struct StakeInfo {
    pub token_id: u64,
    pub amount: i128,
    pub lock_time: u64,
    pub pending_rewards: i128,
}

#[contract]
pub struct LiquidStaking;

#[contractimpl]
impl LiquidStaking {
    pub fn initialize(
        env: Env,
        admin: Address,
        stake_token: Address,
        reward_token: Address,
        nft_contract: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakeToken, &stake_token);
        env.storage().instance().set(&DataKey::RewardToken, &reward_token);
        env.storage().instance().set(&DataKey::NftContract, &nft_contract);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
        env.storage().instance().set(&DataKey::RewardPerTokenStored, &0_i128);
        // Initialise the emergency-pause flag to false (not paused).
        env.storage().instance().set(&DataKey::Paused, &false);

        // Initialise branding metadata with empty strings.
        env.storage().instance().set(&DataKey::ContractMeta, &ContractMetadata {
            description: String::from_str(&env, ""),
            icon_url: String::from_str(&env, ""),
            website: String::from_str(&env, ""),
        });
        env.storage().instance().set(&DataKey::Paused, &false);
        // Initialise the emergency fee penalty to the default (10%).
        env.storage().instance().set(&DataKey::EmergencyFeeBps, &DEFAULT_EMERGENCY_FEE_BPS);
    }

    pub fn deposit_rewards(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(env, Error::AmountNotPositive);
        }
        Self::_check_not_paused(&env);

        let total_staked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);

        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
        token::Client::new(&env, &reward_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        if total_staked > 0 {
            let mut rpt: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardPerTokenStored)
                .unwrap_or(0);
            rpt = rpt.checked_add(
                amount.checked_mul(PRECISION).unwrap_or_else(|| panic_with_error!(env, Error::RptOverflow)) / total_staked
            ).unwrap_or_else(|| panic_with_error!(env, Error::RptOverflow));
            env.storage()
                .instance()
                .set(&DataKey::RewardPerTokenStored, &rpt);

            // Record a checkpoint at the current ledger sequence so the
            // accumulator value can be queried historically.
            let seq = env.ledger().sequence();
            env.storage()
                .temporary()
                .set(&DataKey::RewardPerTokenCheckpoint(seq), &rpt);
        }

        // Topic: event name only; from + amount in data.
        env.events().publish((symbol_short!("dep_rwd"),), (from, amount));
    }



    pub fn stake(env: Env, user: Address, amount: i128, lock_duration: u64) -> u64 {
        user.require_auth();
        if env.storage().instance().get::<DataKey, bool>(&DataKey::Paused).unwrap_or(false) {
            panic_with_error!(env, Error::ContractPaused);
        }
        if amount <= 0 {
            panic_with_error!(env, Error::AmountNotPositive);
        }

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );

        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).unwrap();
        
        let name = String::from_str(&env, "Liquid Stake Receipt");
        let description = String::from_str(&env, "Represents a staked position.");
        let image = String::from_str(&env, "");

        let token_id: u64 = env.invoke_contract(
            &nft_contract,
            &symbol_short!("mint"),
            (
                env.current_contract_address(),
                user.clone(),
                String::from_str(&env, "Liquid Stake Receipt"),
                String::from_str(&env, "Represents a staked position."),
                String::from_str(&env, ""),
                0_u32, // royalty
                true,  // mutable
            ).into_val(&env),
        );

        env.storage().persistent().set(&DataKey::StakeAmount(token_id), &amount);
        let lock_time = env.ledger().timestamp().checked_add(lock_duration).unwrap_or_else(|| panic_with_error!(env, Error::LockTimeOverflow));
        let lock_time = env.ledger().timestamp() + lock_duration;
        
        // Populate attributes
        let mut attributes = Vec::new(&env);
        attributes.push_back(NftAttribute {
            trait_type: String::from_str(&env, "Stake Amount"),
            value: i128_to_string(&env, amount),
            display_type: String::from_str(&env, "number"),
            max_value: String::from_str(&env, ""),
        });
        attributes.push_back(NftAttribute {
            trait_type: String::from_str(&env, "Lock Expiration"),
            value: u64_to_string(&env, lock_time),
            display_type: String::from_str(&env, "date"),
            max_value: String::from_str(&env, ""),
        });
        attributes.push_back(NftAttribute {
            trait_type: String::from_str(&env, "Accrued Rewards"),
            value: String::from_str(&env, "0"),
            display_type: String::from_str(&env, "number"),
            max_value: String::from_str(&env, ""),
        });

        env.invoke_contract::<()>(
            &nft_contract,
            &symbol_short!("set_attrs"),
            (env.current_contract_address(), token_id, attributes).into_val(&env),
        );

        env.storage().persistent().set(&DataKey::StakeAmount(token_id), &amount);
        env.storage().persistent().set(&DataKey::StakeLockTime(token_id), &lock_time);

        let rpt: i128 = env.storage().instance().get(&DataKey::RewardPerTokenStored).unwrap_or(0);
        env.storage().persistent().set(&DataKey::NftRewardPerTokenPaid(token_id), &rpt);
        env.storage().persistent().set(&DataKey::NftRewards(token_id), &0_i128);

        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &total.checked_add(amount).unwrap_or_else(|| panic_with_error!(env, Error::TotalStakedOverflow)));

        // Topic: event name only; user + token_id + amount + lock_time in data.
        env.events().publish((symbol_short!("staked"), user, token_id), (amount, lock_time));
        env.events().publish((symbol_short!("staked"),), (user, token_id, amount, lock_time));
        
        token_id
    }

    pub fn unstake(env: Env, user: Address, token_id: u64) {
        user.require_auth();

        // Acquire the reentrancy guard. Any recursive call into a guarded function
        // while this is held reverts with `ReentrancyDetected`.
        let _guard = ReentrancyGuard::new(&env)
            .map_err(|_| Error::ReentrancyDetected)
            .unwrap();

        Self::_check_not_paused(&env);
        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).unwrap();
        let owner: Address = env.invoke_contract(
            &nft_contract,
            &symbol_short!("owner_of"),
            (token_id,).into_val(&env),
        );
        if user != owner {
            panic_with_error!(env, Error::NotTokenOwner);
        }

        let lock_time: u64 = env.storage().persistent().get(&DataKey::StakeLockTime(token_id)).unwrap_or(0);
        if env.ledger().timestamp() < lock_time {
            panic_with_error!(env, Error::StakeLocked);
        }

        let amount: i128 = env.storage().persistent().get(&DataKey::StakeAmount(token_id)).unwrap_or(0);
        if amount <= 0 {
            panic_with_error!(env, Error::NoStakeFound);
        }

        // Snapshot accrued rewards (this only updates internal state, no transfer).
        Self::_update_reward(&env, token_id);
        let reward: i128 = env.storage().persistent().get(&DataKey::NftRewards(token_id)).unwrap_or(0);
        // Clear the accrued reward record up-front so a re-entrant call cannot
        // claim the same reward twice.
        if reward > 0 {
            env.storage().persistent().set(&DataKey::NftRewards(token_id), &0_i128);
        }

        // ── Checks-Effects-Interactions ──────────────────────────────────────
        // Effects: update all internal user/contract state BEFORE performing any
        // cross-contract token transfer.
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total.checked_sub(amount).expect("total staked underflow"));

        env.storage().persistent().remove(&DataKey::StakeAmount(token_id));
        env.storage().persistent().remove(&DataKey::StakeLockTime(token_id));
        env.storage().persistent().remove(&DataKey::NftRewardPerTokenPaid(token_id));
        env.storage().persistent().remove(&DataKey::NftRewards(token_id));

        // Interactions: external token transfers happen only after state is settled.
        if reward > 0 {
            let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
            token::Client::new(&env, &reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &reward,
            );
        }

        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &total.checked_sub(amount).unwrap_or_else(|| panic_with_error!(env, Error::TotalStakedUnderflow)));

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        // Burn the NFT
        env.invoke_contract::<()>(
            &nft_contract,
            &symbol_short!("burn"),
            (env.current_contract_address(), token_id).into_val(&env),
        );

        // Topic: event name only; user + token_id + amount in data.
        env.events().publish((symbol_short!("unstaked"), user, token_id), amount);
        env.events().publish((symbol_short!("unstaked"),), (user, token_id, amount));
    }

    // ── Emergency Withdraw ─────────────────────────────────────────────────

    /// Withdraw entire stake directly when contract is paused, without reward updates.
    ///
    /// A fee penalty (`emergency_fee_bps` basis points, default 10%) is deducted
    /// from the staked amount and sent to the admin (treasury). The net amount is
    /// returned to the user. Both the net amount and the fee are included in the
    /// emitted event for a complete audit trail.
    pub fn emergency_withdraw(env: Env, user: Address, token_id: u64) {
        user.require_auth();
        assert!(Self::is_paused(env.clone()), "contract not paused");

        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).unwrap();
        let owner: Address = env.invoke_contract(
            &nft_contract,
            &symbol_short!("owner_of"),
            (token_id,).into_val(&env),
        );
        if user != owner {
            panic_with_error!(env, Error::NotTokenOwner);
        }

        let amount: i128 = env.storage().persistent().get(&DataKey::StakeAmount(token_id)).unwrap_or(0);
        assert!(amount > 0, "no stake found for token");

        // Calculate fee penalty and net withdrawal amount.
        let fee_bps: i128 = env
            .storage()
            .instance()
            .get(&DataKey::EmergencyFeeBps)
            .unwrap_or(DEFAULT_EMERGENCY_FEE_BPS);
        let fee_penalty: i128 = amount
            .checked_mul(fee_bps)
            .unwrap_or_else(|| panic_with_error!(env, Error::RewardsOverflow))
            / MAX_BPS;
        let net_amount: i128 = amount
            .checked_sub(fee_penalty)
            .unwrap_or_else(|| panic_with_error!(env, Error::TotalStakedUnderflow));

        // Update total staked
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &total.checked_sub(amount).expect("total staked underflow"));

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        let token_client = token::Client::new(&env, &stake_token);

        // Transfer net amount to user.
        token_client.transfer(
            &env.current_contract_address(),
            &user,
            &net_amount,
        );

        // Transfer fee penalty to admin (treasury).
        if fee_penalty > 0 {
            let admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .unwrap_or_else(|| panic_with_error!(env, Error::AdminNotFound));
            token_client.transfer(
                &env.current_contract_address(),
                &admin,
                &fee_penalty,
            );
        }

        env.storage().persistent().remove(&DataKey::StakeAmount(token_id));
        env.storage().persistent().remove(&DataKey::StakeLockTime(token_id));
        env.storage().persistent().remove(&DataKey::NftRewardPerTokenPaid(token_id));
        env.storage().persistent().remove(&DataKey::NftRewards(token_id));

        // Burn the NFT
        env.invoke_contract::<()>(
            &nft_contract,
            &symbol_short!("burn"),
            (env.current_contract_address(), token_id).into_val(&env),
        );

        // Emit event including fee_penalty so callers can audit the deduction.
        env.events().publish(
            (symbol_short!("emer_wd"),),
            (user, token_id, net_amount, fee_penalty),
        );
    }

    /// Update the emergency-withdraw penalty fee (admin only).
    ///
    /// # Arguments
    /// * `caller`   – Must be the contract admin
    /// * `fee_bps`  – New fee in basis points (0–10_000)
    pub fn set_emergency_fee(env: Env, caller: Address, fee_bps: i128) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::AdminNotFound));
        if caller != admin {
            panic_with_error!(env, Error::OnlyAdmin);
        }
        assert!(fee_bps >= 0 && fee_bps <= MAX_BPS, "fee_bps out of range");

        env.storage().instance().set(&DataKey::EmergencyFeeBps, &fee_bps);
    }

    /// Return the current emergency-withdraw fee in basis points.
    pub fn get_emergency_fee(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::EmergencyFeeBps)
            .unwrap_or(DEFAULT_EMERGENCY_FEE_BPS)
    }

    pub fn claim(env: Env, user: Address, token_id: u64) -> i128 {
        user.require_auth();
        Self::_check_not_paused(&env);

        // Acquire the reentrancy guard.
        let _guard = ReentrancyGuard::new(&env)
            .map_err(|_| Error::ReentrancyDetected)
            .unwrap();

        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).unwrap();
        let owner: Address = env.invoke_contract(
            &nft_contract,
            &symbol_short!("owner_of"),
            (token_id,).into_val(&env),
        );
        if user != owner {
            panic_with_error!(env, Error::NotTokenOwner);
        }

        Self::_update_reward(&env, token_id);

        let reward: i128 = env.storage().persistent().get(&DataKey::NftRewards(token_id)).unwrap_or(0);

        if reward > 0 {
            env.storage().persistent().set(&DataKey::NftRewards(token_id), &0_i128);

            let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
            token::Client::new(&env, &reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &reward,
            );

            // Topic: event name only; user + token_id + reward in data.
            env.events().publish((symbol_short!("claimed"), user, token_id), reward);
            env.events().publish((symbol_short!("claimed"),), (user, token_id, reward));
        }

        Self::_sync_nft_metadata(&env, token_id);

        reward
    }

    pub fn sync_nft(env: Env, token_id: u64) {
        Self::_sync_nft_metadata(&env, token_id);
    }

    pub fn get_stake_info(env: Env, token_id: u64) -> StakeInfo {
        let rpt: i128 = env.storage().instance().get(&DataKey::RewardPerTokenStored).unwrap_or(0);
        let nft_rpt: i128 = env.storage().persistent().get(&DataKey::NftRewardPerTokenPaid(token_id)).unwrap_or(0);
        let amount: i128 = env.storage().persistent().get(&DataKey::StakeAmount(token_id)).unwrap_or(0);
        let accrued: i128 = env.storage().persistent().get(&DataKey::NftRewards(token_id)).unwrap_or(0);
        let delta = rpt.checked_sub(nft_rpt).unwrap_or_else(|| panic_with_error!(env, Error::RewardsOverflow));
        let pending = accrued.checked_add(
            amount.checked_mul(delta).unwrap_or_else(|| panic_with_error!(env, Error::RewardsOverflow)) / PRECISION
        ).unwrap_or_else(|| panic_with_error!(env, Error::RewardsOverflow));
        let lock_time: u64 = env.storage().persistent().get(&DataKey::StakeLockTime(token_id)).unwrap_or(0);

        StakeInfo {
            token_id,
            amount,
            lock_time,
            pending_rewards: pending,
        }
    }

    /// Returns the reward-per-token accumulator value recorded at the given
    /// ledger sequence, or 0 if no distribution occurred at that sequence.
    pub fn get_reward_checkpoint(env: Env, ledger_seq: u32) -> i128 {
        env.storage()
            .temporary()
            .get(&DataKey::RewardPerTokenCheckpoint(ledger_seq))
            .unwrap_or(0)
    }

    // ── Emergency Pause ───────────────────────────────────────────────────────

    /// Pause the contract, blocking stake and unstake (admin only).
    pub fn pause(env: Env, caller: Address) {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::AdminNotFound));
        if caller != admin {
            panic_with_error!(env, Error::OnlyAdmin);
        }

        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), caller);
    }

    /// Unpause the contract, re-enabling stake and unstake (admin only).
    pub fn unpause(env: Env, caller: Address) {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::AdminNotFound));
        if caller != admin {
            panic_with_error!(env, Error::OnlyAdmin);
        }

        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"),), caller);
    }

    /// Returns true if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ── Contract Metadata ─────────────────────────────────────────────────────

    /// Update the contract's branding metadata (admin only).
    ///
    /// All three fields are replaced atomically. Pass the current value for
    /// any field you do not want to change.
    ///
    /// # Arguments
    /// * `caller`      – Must be the contract admin
    /// * `description` – New human-readable description
    /// * `icon_url`    – New icon / logo URL
    /// * `website`     – New project website URL
    /// Update the contract branding metadata.
    ///
    /// Admin only. Every field is length-bounded to MAX_METADATA_LEN bytes so
    /// a single update cannot commit the contract to unbounded storage rental.
    pub fn update_contract_meta(
        env: Env,
        caller: Address,
        description: String,
        icon_url: String,
        website: String,
    ) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::AdminNotFound));
        if caller != admin {
            panic_with_error!(env, Error::OnlyAdmin);
        }

        if description.len() > MAX_METADATA_LEN
            || icon_url.len() > MAX_METADATA_LEN
            || website.len() > MAX_METADATA_LEN
        {
            panic_with_error!(env, Error::MetadataUriTooLong);
        }

        let meta = ContractMetadata {
            description,
            icon_url,
            website,
        };
        env.storage().instance().set(&DataKey::ContractMeta, &meta);

        // Topic: event name; data: the new icon URI followed by the full
        // metadata. The URI leads so subscribers get MetadataUpdated(new_uri)
        // directly, while existing consumers of the whole struct still work.
        env.events().publish(
            (symbol_short!("meta_upd"),),
            (meta.icon_url.clone(), meta),
        );
    }

    /// Return the current contract branding metadata.
    pub fn get_contract_meta(env: Env) -> ContractMetadata {
        env.storage()
            .instance()
            .get(&DataKey::ContractMeta)
            .unwrap_or_else(|| panic_with_error!(env, Error::AlreadyInitialized))
    }

    fn _update_reward(env: &Env, token_id: u64) {
        let rpt: i128 = env.storage().instance().get(&DataKey::RewardPerTokenStored).unwrap_or(0);
        let nft_rpt: i128 = env.storage().persistent().get(&DataKey::NftRewardPerTokenPaid(token_id)).unwrap_or(0);
        let amount: i128 = env.storage().persistent().get(&DataKey::StakeAmount(token_id)).unwrap_or(0);
        let delta = rpt.checked_sub(nft_rpt).unwrap_or_else(|| panic_with_error!(env, Error::RewardsOverflow));
        let earned = amount.checked_mul(delta).unwrap_or_else(|| panic_with_error!(env, Error::RewardsOverflow)) / PRECISION;

        if earned > 0 {
            let prev: i128 = env.storage().persistent().get(&DataKey::NftRewards(token_id)).unwrap_or(0);
            env.storage().persistent().set(&DataKey::NftRewards(token_id), &prev.checked_add(earned).unwrap_or_else(|| panic_with_error!(env, Error::RewardsOverflow)));
        }

        env.storage().persistent().set(&DataKey::NftRewardPerTokenPaid(token_id), &rpt);
    }

    fn _check_not_paused(env: &Env) {
        if Self::is_paused(env.clone()) {
            panic_with_error!(env, Error::ContractPaused);
        }
    }

    fn _sync_nft_metadata(env: &Env, token_id: u64) {
        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).unwrap();
        let amount: i128 = env.storage().persistent().get(&DataKey::StakeAmount(token_id)).unwrap_or(0);
        let lock_time: u64 = env.storage().persistent().get(&DataKey::StakeLockTime(token_id)).unwrap_or(0);
        let info = Self::get_stake_info(env.clone(), token_id);

        let mut attributes = Vec::new(env);
        attributes.push_back(NftAttribute {
            trait_type: String::from_str(env, "Stake Amount"),
            value: i128_to_string(env, amount),
            display_type: String::from_str(env, "number"),
            max_value: String::from_str(env, ""),
        });
        attributes.push_back(NftAttribute {
            trait_type: String::from_str(env, "Lock Expiration"),
            value: u64_to_string(env, lock_time),
            display_type: String::from_str(env, "date"),
            max_value: String::from_str(env, ""),
        });
        attributes.push_back(NftAttribute {
            trait_type: String::from_str(env, "Accrued Rewards"),
            value: i128_to_string(env, info.pending_rewards),
            display_type: String::from_str(env, "number"),
            max_value: String::from_str(env, ""),
        });

        env.invoke_contract::<()>(
            &nft_contract,
            &symbol_short!("set_attrs"),
            (env.current_contract_address(), token_id, attributes).into_val(env),
        );
    }
}

fn i128_to_string(env: &Env, mut n: i128) -> String {
    if n == 0 {
        return String::from_str(env, "0");
    }
    let mut buf = [0u8; 40];
    let mut i = 40;
    let neg = n < 0;
    if neg { n = -n; }
    while n > 0 {
        i -= 1;
        buf[i] = (n % 10) as u8 + 48;
        n /= 10;
    }
    if neg {
        i -= 1;
        buf[i] = b'-';
    }
    String::from_str(env, core::str::from_utf8(&buf[i..]).unwrap())
}

fn u64_to_string(env: &Env, mut n: u64) -> String {
    if n == 0 {
        return String::from_str(env, "0");
    }
    let mut buf = [0u8; 20];
    let mut i = 20;
    while n > 0 {
        i -= 1;
        buf[i] = (n % 10) as u8 + 48;
        n /= 10;
    }
    String::from_str(env, core::str::from_utf8(&buf[i..]).unwrap())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, IntoVal, String,
    };
    
    // Using the imported Rust crate directly for tests

    fn setup() -> (Env, Address, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let stake_token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let reward_token_id = env.register_stellar_asset_contract_v2(admin.clone());

        let stake_sac = StellarAssetClient::new(&env, &stake_token_id.address());
        let reward_sac = StellarAssetClient::new(&env, &reward_token_id.address());

        stake_sac.mint(&alice, &1_000_000);
        stake_sac.mint(&bob, &1_000_000);
        reward_sac.mint(&admin, &10_000_000);

        // Register the NFT Contract natively instead of importing Wasm, it's easier and cleaner in multi-crate tests if we can,
        // but since we added `burn` to it, we'd need to bring the actual crate in.
        // Actually, for simplicity in tests, we can just use the compiled WASM or register the struct if we import it.
        // To avoid compiling issues with path in mock test, let's just assume we need to import it as a dev dependency.
        
        // Let's register a mock NFT contract here for test simplicity, since soroban multi-contract tests can be tricky without compiled wasms.
        
        // Wait, we have the `nft_metadata` crate in dev-dependencies! 
        // So we can do:
        let nft_contract_id = env.register_contract(None, nft_metadata::NftMetadataContract);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_contract_id);
        
        let ls_contract_id = env.register_contract(None, LiquidStaking);
        let ls_client = LiquidStakingClient::new(&env, &ls_contract_id);
        
        // Init NFT contract with LS as admin
        nft_client.initialize(
            &ls_contract_id, 
            &String::from_str(&env, "Liquid Stake"), 
            &String::from_str(&env, "LS")
        );

        ls_client.initialize(&admin, &stake_token_id.address(), &reward_token_id.address(), &nft_contract_id);

        (env, ls_contract_id, nft_contract_id, admin, alice, bob, reward_token_id.address())
    }

    #[test]
    fn test_stake_and_mint_nft() {
        let (env, ls_id, nft_id, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_id);

        let token_id = client.stake(&alice, &500_000, &3600);
        
        assert_eq!(token_id, 1);
        assert_eq!(nft_client.owner_of(&token_id), alice);
        
        let info = client.get_stake_info(&token_id);
        assert_eq!(info.amount, 500_000);
    }
    
    #[test]
    fn test_transfer_and_claim() {
        let (env, ls_id, nft_id, admin, alice, bob, reward_token) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_id);

        let token_id = client.stake(&alice, &500_000, &3600);
        
        // Admin deposits rewards
        client.deposit_rewards(&admin, &1_000);
        
        // Alice transfers NFT to Bob
        nft_client.transfer(&alice, &bob, &token_id);
        
        // Bob claims the rewards!
        let claimed = client.claim(&bob, &token_id);
        assert_eq!(claimed, 1_000);
        
        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&bob), 1_000);
    }
    
    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #7)")]
    fn test_unstake_locked() {
        let (env, ls_id, _, _, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        let token_id = client.stake(&alice, &500_000, &3600);
        
        // Should panic because 3600 seconds haven't passed
        client.unstake(&alice, &token_id);
    }

    #[test]
    fn test_update_contract_meta() {
        let (env, ls_id, _, admin, _, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        // Initial metadata should be empty strings.
        let initial = client.get_contract_meta();
        assert_eq!(initial.description, String::from_str(&env, ""));
        assert_eq!(initial.icon_url, String::from_str(&env, ""));
        assert_eq!(initial.website, String::from_str(&env, ""));

        // Admin updates branding.
        client.update_contract_meta(
            &admin,
            &String::from_str(&env, "Liquid staking protocol on Stellar"),
            &String::from_str(&env, "https://example.com/icon.png"),
            &String::from_str(&env, "https://example.com"),
        );

        let updated = client.get_contract_meta();
        assert_eq!(updated.description, String::from_str(&env, "Liquid staking protocol on Stellar"));
        assert_eq!(updated.icon_url, String::from_str(&env, "https://example.com/icon.png"));
        assert_eq!(updated.website, String::from_str(&env, "https://example.com"));
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #13)")]
    fn test_update_contract_meta_non_admin() {
        let (env, ls_id, _, _, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        // Non-admin should be rejected.
        client.update_contract_meta(
            &alice,
            &String::from_str(&env, "Hacked"),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
        );
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #4)")]
    fn test_normal_unstake_when_paused() {
        let (env, ls_id, _, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let token_id = client.stake(&alice, &500_000, &3600);
        client.pause(&admin);
        client.unstake(&alice, &token_id); // Should panic
    }

    #[test]
    fn test_pause_blocks_stake() {
        let (env, ls_id, _, admin, _alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        // Initially not paused.
        assert!(!client.is_paused());

        // Admin pauses the contract; state must reflect this.
        client.pause(&admin);
        assert!(client.is_paused());
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #4)")]
    fn test_stake_blocked_when_paused() {
        let (env, ls_id, _, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        client.pause(&admin);
        client.stake(&alice, &500_000, &3600); // Should panic
    }

    #[test]
    fn test_pause_and_emergency_withdraw() {
        let (env, ls_id, _, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let stake_token = env.as_contract(&ls_id, || {
            env.storage().instance().get(&DataKey::StakeToken).unwrap()
        });
        let token_client = TokenClient::new(&env, &stake_token);

        // Stake first
        let token_id = client.stake(&alice, &500_000, &3600);
        let info = client.get_stake_info(&token_id);
        assert_eq!(info.amount, 500_000);

        // Pause contract
        client.pause(&admin);
        assert!(client.is_paused());

        // Try emergency withdraw - should work, with 10% fee penalty
        client.emergency_withdraw(&alice, &token_id);
        // Check stake is gone
        let after_info = client.get_stake_info(&token_id);
        assert_eq!(after_info.amount, 0);
        // Net amount returned = 500_000 - 10% = 450_000; fee = 50_000 goes to admin
        assert_eq!(token_client.balance(&alice), 1_000_000 - 500_000 + 450_000); // 950_000
        assert_eq!(token_client.balance(&admin), 50_000);

        // Unpause
        client.unpause(&admin);
        assert!(!client.is_paused());
    }

    // ── Emergency withdraw event emission tests (Issue #1000) ────────────

    #[test]
    fn test_emergency_withdraw_emits_event_with_fee_penalty() {
        let (env, ls_id, _, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        let token_id = client.stake(&alice, &500_000, &3600);

        // Pause and emergency withdraw
        client.pause(&admin);

        let events_before = env.events().all().len();
        client.emergency_withdraw(&alice, &token_id);
        let events_after = env.events().all().len();

        // At least one new event must have been emitted
        assert!(events_after > events_before, "emergency_withdraw must emit an event");

        // Verify fee accounting: 10% fee on 500_000 = 50_000 penalty; net = 450_000
        let stake_token = env.as_contract(&ls_id, || {
            env.storage().instance().get(&DataKey::StakeToken).unwrap()
        });
        let token_client = TokenClient::new(&env, &stake_token);
        // alice started with 1_000_000, staked 500_000, gets back net 450_000
        assert_eq!(token_client.balance(&alice), 950_000, "net amount should be 90% of staked");
        // admin receives the 10% fee penalty
        assert_eq!(token_client.balance(&admin), 50_000, "admin should receive fee penalty");
    }

    #[test]
    fn test_set_emergency_fee_and_withdraw() {
        let (env, ls_id, _, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        // Default fee is 10% (1000 bps)
        assert_eq!(client.get_emergency_fee(), 1_000);

        // Admin changes fee to 5% (500 bps)
        client.set_emergency_fee(&admin, &500);
        assert_eq!(client.get_emergency_fee(), 500);

        let token_id = client.stake(&alice, &500_000, &3600);
        client.pause(&admin);
        client.emergency_withdraw(&alice, &token_id);

        let stake_token = env.as_contract(&ls_id, || {
            env.storage().instance().get(&DataKey::StakeToken).unwrap()
        });
        let token_client = TokenClient::new(&env, &stake_token);
        // Net = 500_000 - 5% = 475_000; fee = 25_000
        assert_eq!(token_client.balance(&alice), 975_000); // 1_000_000 - 500_000 + 475_000
        assert_eq!(token_client.balance(&admin), 25_000);
    }

    #[test]
    #[should_panic(expected = "contract not paused")]
    fn test_emergency_withdraw_not_paused() {
        let (env, ls_id, _, _, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let token_id = client.stake(&alice, &500_000, &3600);
        client.emergency_withdraw(&alice, &token_id); // Should panic
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #13)")]
    fn test_non_admin_cannot_pause() {
        let (env, ls_id, _, _, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        client.pause(&alice); // Should panic
    }

    #[test]
    fn test_reward_calculation_multiple_users() {
        let (env, ls_id, _, admin, alice, bob, reward_token) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        // Alice stakes 300k, Bob stakes 200k
        let alice_nft = client.stake(&alice, &300_000, &3600);
        let bob_nft = client.stake(&bob, &200_000, &3600);

        let reward_client = TokenClient::new(&env, &reward_token);

        // Advance ledger so deposits happen at different sequences
        env.ledger().set_sequence_number(1000);
        // Deposit 5_000 reward tokens — 60% to Alice, 40% to Bob
        client.deposit_rewards(&admin, &5_000);
        let checkpoint_1000 = client.get_reward_checkpoint(&1000);
        // rpt = 0 + 5_000 * PRECISION / 500_000 = 10_000_000_000_000_000
        let expected_rpt = 5_000_i128 * PRECISION / 500_000_i128;
        assert_eq!(checkpoint_1000, expected_rpt);

        // No claims yet — Bob gets pending in info
        let alice_info = client.get_stake_info(&alice_nft);
        let bob_info = client.get_stake_info(&bob_nft);
        // Alice: 300_000 * expected_rpt / PRECISION = 300_000 * 10_000_000_000_000_000 / 10^18 = 3_000
        assert_eq!(alice_info.pending_rewards, 3_000);
        // Bob: 200_000 * expected_rpt / PRECISION = 2_000
        assert_eq!(bob_info.pending_rewards, 2_000);

        // Advance ledger, deposit more rewards
        env.ledger().set_sequence_number(2000);
        client.deposit_rewards(&admin, &5_000);
        let checkpoint_2000 = client.get_reward_checkpoint(&2000);
        // rpt = 10_000_000_000_000_000 + 5_000 * PRECISION / 500_000 = 20_000_000_000_000_000
        let expected_rpt_2 = expected_rpt + 5_000_i128 * PRECISION / 500_000_i128;
        assert_eq!(checkpoint_2000, expected_rpt_2);

        // Bob claims his rewards
        let bob_claimed = client.claim(&bob, &bob_nft);
        // Bob's total after 2 deposits: 200_000 * expected_rpt_2 / PRECISION = 200_000 * 20_000_000_000_000_000 / 10^18 = 4_000
        assert_eq!(bob_claimed, 4_000);
        assert_eq!(reward_client.balance(&bob), 4_000);

        // Alice claims her rewards
        let alice_claimed = client.claim(&alice, &alice_nft);
        assert_eq!(alice_claimed, 6_000);
        assert_eq!(reward_client.balance(&alice), 6_000);

        // Both users' pending rewards should be 0 after claiming
        let alice_post = client.get_stake_info(&alice_nft);
        assert_eq!(alice_post.pending_rewards, 0);
        let bob_post = client.get_stake_info(&bob_nft);
        assert_eq!(bob_post.pending_rewards, 0);

        // Contract should have no reward tokens left
        assert_eq!(reward_client.balance(&ls_id), 0);

        // Query a ledger with no checkpoint
        let no_checkpoint = client.get_reward_checkpoint(&500);
        assert_eq!(no_checkpoint, 0);
    }

    #[test]
    fn test_rewards_unstake_distributes_pending() {
        let (env, ls_id, _, admin, alice, _, reward_token) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        let token_id = client.stake(&alice, &500_000, &0);

        // Deposit rewards
        client.deposit_rewards(&admin, &10_000);

        // Advance ledger past the lock (lock_duration = 0, so already unlocked)
        let info = client.get_stake_info(&token_id);
        assert_eq!(info.pending_rewards, 10_000);

        // Unstake — should pay rewards
        let reward_client = TokenClient::new(&env, &reward_token);
        let alice_bal_before = reward_client.balance(&alice);
        client.unstake(&alice, &token_id);
        let alice_bal_after = reward_client.balance(&alice);
        assert_eq!(alice_bal_after - alice_bal_before, 10_000);
    }

    #[test]
    fn test_rewards_follow_nft_on_transfer() {
        let (env, ls_id, nft_id, admin, alice, bob, reward_token) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_id);

        let token_id = client.stake(&alice, &500_000, &0);

        // First reward deposit while Alice owns
        client.deposit_rewards(&admin, &2_000);

        // Transfer to Bob
        nft_client.transfer(&alice, &bob, &token_id);

        // Second reward deposit while Bob owns
        client.deposit_rewards(&admin, &2_000);

        // Bob claims — gets all 4_000 (rewards follow the NFT)
        let bob_claimed = client.claim(&bob, &token_id);
        assert_eq!(bob_claimed, 4_000);

        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&bob), 4_000);
    }


    // -- Metadata update authorization & validation ---------------------------

    /// Build a String of exactly `n` ASCII bytes.
    fn string_of_len(env: &Env, n: usize) -> String {
        let filler = "a".repeat(n);
        String::from_str(env, &filler)
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #13)")]
    fn test_metadata_update_rejects_unauthorized_caller() {
        let (env, ls_id, _, _, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        // A staker is not the admin and must not be able to rebrand the
        // contract.
        client.update_contract_meta(
            &alice,
            &String::from_str(&env, "hijacked"),
            &String::from_str(&env, "https://evil.example/icon.png"),
            &String::from_str(&env, "https://evil.example"),
        );
    }

    #[test]
    fn test_metadata_update_rejected_caller_leaves_state_untouched() {
        let (env, ls_id, _, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        client.update_contract_meta(
            &admin,
            &String::from_str(&env, "official"),
            &String::from_str(&env, "https://example.com/icon.png"),
            &String::from_str(&env, "https://example.com"),
        );

        let attempt = client.try_update_contract_meta(
            &alice,
            &String::from_str(&env, "hijacked"),
            &String::from_str(&env, "https://evil.example/icon.png"),
            &String::from_str(&env, "https://evil.example"),
        );
        assert!(attempt.is_err());

        // The admin's metadata must survive the failed attempt.
        let meta = client.get_contract_meta();
        assert_eq!(meta.description, String::from_str(&env, "official"));
        assert_eq!(
            meta.icon_url,
            String::from_str(&env, "https://example.com/icon.png")
        );
    }

    #[test]
    fn test_metadata_accepts_uri_at_max_length() {
        let (env, ls_id, _, admin, _, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        // MAX_METADATA_LEN is the inclusive upper bound.
        let uri = string_of_len(&env, MAX_METADATA_LEN as usize);
        client.update_contract_meta(
            &admin,
            &String::from_str(&env, "ok"),
            &uri,
            &String::from_str(&env, "https://example.com"),
        );

        assert_eq!(client.get_contract_meta().icon_url.len(), MAX_METADATA_LEN);
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #14)")]
    fn test_metadata_rejects_icon_url_over_max_length() {
        let (env, ls_id, _, admin, _, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        let uri = string_of_len(&env, MAX_METADATA_LEN as usize + 1);
        client.update_contract_meta(
            &admin,
            &String::from_str(&env, "ok"),
            &uri,
            &String::from_str(&env, "https://example.com"),
        );
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #14)")]
    fn test_metadata_rejects_website_over_max_length() {
        let (env, ls_id, _, admin, _, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        let website = string_of_len(&env, MAX_METADATA_LEN as usize + 1);
        client.update_contract_meta(
            &admin,
            &String::from_str(&env, "ok"),
            &String::from_str(&env, "https://example.com/icon.png"),
            &website,
        );
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #14)")]
    fn test_metadata_rejects_description_over_max_length() {
        let (env, ls_id, _, admin, _, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        let description = string_of_len(&env, MAX_METADATA_LEN as usize + 1);
        client.update_contract_meta(
            &admin,
            &description,
            &String::from_str(&env, "https://example.com/icon.png"),
            &String::from_str(&env, "https://example.com"),
        );
    }

    #[test]
    fn test_metadata_oversized_update_leaves_state_untouched() {
        let (env, ls_id, _, admin, _, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        client.update_contract_meta(
            &admin,
            &String::from_str(&env, "official"),
            &String::from_str(&env, "https://example.com/icon.png"),
            &String::from_str(&env, "https://example.com"),
        );

        let oversized = string_of_len(&env, MAX_METADATA_LEN as usize + 1);
        assert!(client
            .try_update_contract_meta(
                &admin,
                &String::from_str(&env, "new"),
                &oversized,
                &String::from_str(&env, "https://example.com"),
            )
            .is_err());

        assert_eq!(
            client.get_contract_meta().icon_url,
            String::from_str(&env, "https://example.com/icon.png")
        );
    }

    #[test]
    fn test_metadata_update_emits_event() {
        let (env, ls_id, _, admin, _, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        let before = env.events().all().len();
        client.update_contract_meta(
            &admin,
            &String::from_str(&env, "official"),
            &String::from_str(&env, "https://example.com/icon.png"),
            &String::from_str(&env, "https://example.com"),
        );
        let after = env.events().all().len();

        assert!(
            after > before,
            "update_contract_meta must emit a MetadataUpdated event"
        );
    }

    #[test]
    fn test_nft_attributes() {

        let (env, ls_id, nft_id, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_id);

        let token_id = client.stake(&alice, &500_000, &3600);
        
        let metadata = nft_client.get_metadata(&token_id);
        assert_eq!(metadata.attributes.len(), 3);
        
        // Stake Amount
        assert_eq!(metadata.attributes.get(0).unwrap().trait_type, String::from_str(&env, "Stake Amount"));
        assert_eq!(metadata.attributes.get(0).unwrap().value, String::from_str(&env, "500000"));
        
        // Accrued Rewards (initially 0)
        assert_eq!(metadata.attributes.get(2).unwrap().trait_type, String::from_str(&env, "Accrued Rewards"));
        assert_eq!(metadata.attributes.get(2).unwrap().value, String::from_str(&env, "0"));
        
        // Add rewards and sync manually
        client.deposit_rewards(&admin, &1000);
        client.sync_nft(&token_id);
        
        let metadata_sync = nft_client.get_metadata(&token_id);
        assert_eq!(metadata_sync.attributes.get(2).unwrap().value, String::from_str(&env, "1000"));
        
        client.claim(&alice, &token_id);
        
        // After claim, sync is called, but rewards were just claimed, so it should be "0" again
        let metadata_after = nft_client.get_metadata(&token_id);
        assert_eq!(metadata_after.attributes.get(2).unwrap().value, String::from_str(&env, "0"));
    }

    // ── Reentrancy guard tests ──────────────────────────────────────────────

    /// A malicious stake token that re-enters `unstake` during the withdrawal
    /// transfer. It only re-enters when the caller is the liquid staking
    /// contract itself (i.e. on the stake payout).
    #[contract]
    pub struct MaliciousToken;

    #[contractimpl]
    impl MaliciousToken {
        pub fn init(env: Env, ls: Address) {
            env.storage()
                .instance()
                .set(&soroban_sdk::symbol_short!("ls"), &ls);
        }

        pub fn transfer(env: Env, from: Address, _to: Address, _amount: i128) {
            let ls: Address = env
                .storage()
                .instance()
                .get(&soroban_sdk::symbol_short!("ls"))
                .unwrap();
            // The withdrawal path: the liquid staking contract is the sender.
            if from == ls {
                // Attempt to re-enter the guarded unstake function.
                env.invoke_contract::<()>(
                    &ls,
                    &soroban_sdk::symbol_short!("unstake"),
                    (ls.clone(), 1u64).into_val(&env),
                );
            }
        }
    }

    /// Malicious token client handle (generated by the contract macro).
    #[test]
    #[should_panic]
    fn test_unstake_reentrancy_guarded() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);

        let reward_token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let reward_sac = StellarAssetClient::new(&env, &reward_token_id.address());
        reward_sac.mint(&admin, &10_000_000);

        // Register the malicious stake token.
        let malicious_id = env.register_contract(None, MaliciousToken);
        let malicious_client = MaliciousTokenClient::new(&env, &malicious_id);

        let nft_contract_id = env.register_contract(None, nft_metadata::NftMetadataContract);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_contract_id);

        let ls_contract_id = env.register_contract(None, LiquidStaking);
        let ls_client = LiquidStakingClient::new(&env, &ls_contract_id);

        nft_client.initialize(
            &ls_contract_id,
            &String::from_str(&env, "Liquid Stake"),
            &String::from_str(&env, "LS"),
        );
        ls_client.initialize(
            &admin,
            &malicious_id,
            &reward_token_id.address(),
            &nft_contract_id,
        );

        // Tell the malicious token where to re-enter.
        malicious_client.init(&ls_contract_id);

        // Alice stakes (malicious transfer is a no-op on deposit, no reentry).
        let token_id = ls_client.stake(&alice, &500_000, &0);

        // Fund rewards so a reward payout also occurs during unstake.
        ls_client.deposit_rewards(&admin, &1_000);

        // The withdrawal transfer triggers the malicious callback, which attempts to
        // call unstake again while the guard is held. The re-entrant call must be
        // reverted (the Soroban host forbids contract re-entry, and our guard would
        // revert with `Error::ReentrancyDetected` if re-entry were ever permitted).
        ls_client.unstake(&alice, &token_id);
    }

    /// Directly exercises the reentrancy guard's revert behaviour: a second acquire
    /// while the first is still held must revert with `Error::ReentrancyDetected`.
    #[test]
    #[should_panic(expected = "ReentrancyDetected")]
    fn test_reentrancy_guard_reverts() {
        let env = Env::default();
        let id = env.register_contract(None, LiquidStaking);
        env.as_contract(&id, || {
            let _guard = ReentrancyGuard::new(&env).unwrap();
            // While `_guard` is alive, a recursive acquire must revert.
            let _recursive = ReentrancyGuard::new(&env)
                .map_err(|_| Error::ReentrancyDetected)
                .unwrap();
        });
    }
}
