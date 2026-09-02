# AnchorPoint Codebase Index

Generated from a local scan of the repository on 2026-08-26.

## Repository Shape

AnchorPoint is a mixed TypeScript and Rust monorepo for Stellar anchor workflows, Soroban smart contracts, local mock infrastructure, and deployment assets.

Top-level file counts from `git ls-files`, excluding dependency/build directories:

| Area | Files | Purpose |
| --- | ---: | --- |
| `backend/` | 345 | Express API, Prisma schema & migrations, business services, workers & schedulers, resilience proxies, tests, docs |
| `src/` | 142 | Root Rust workspace of Soroban contract crates (`amm`, `circuit_breaker`, `flash_loan`, `governance`, `token`, `staking`, etc.) and shared utilities |
| `dashboard/` | 96 | React/Vite/Tailwind dashboard frontend, components, hooks, QA docs |
| `contracts/` | 52 | Secondary Rust workspace of deployable/example Soroban contracts (`anchorpoint`, `governance`, `reentrancy-guard`, `swap`, `registry`, etc.) |
| `infra/` | 30 | Kubernetes manifests, cert-manager, Terraform (RDS/KMS), ELK/Logstash/Kibana, monitoring |
| `root configs/scripts` | 22 | Monorepo configs (`package.json`, `Cargo.toml`, `docker-compose.yml`), CI (`.github/`), scripts, specifications |
| `docs/` | 14 | Repo-level operational, architectural, QA, and security audit documentation |
| `tools/` | 12 | Deterministic Horizon/Soroban mock server and fixtures |
| `demo/` | 2 | Legacy/simple mock anchor server |

## Main Entrypoints

| Area | Entrypoint | Notes |
| --- | --- | --- |
| Monorepo scripts | `package.json` | npm workspaces for `dashboard`, `demo`, and `backend` |
| Backend API | `backend/src/index.ts` | Express app, health check, Swagger, metrics, SEP routes, API routes, Socket.io |
| Backend DB | `backend/prisma/schema.prisma` | PostgreSQL/SQLite Prisma schema plus migration history |
| Dashboard | `dashboard/src/main.tsx`, `dashboard/src/App.tsx` | Single React app with dashboard, config, transaction, and SEP-24 surfaces |
| Mock server | `tools/mock-server/src/server.ts` | Express mock Horizon REST and Soroban RPC endpoints |
| Root Rust workspace | `Cargo.toml` | 24 contract/util member crates under `src/*` |
| Contracts workspace | `contracts/Cargo.toml` | 12 contract member crates under `contracts/*` |
| Docker stack | `docker-compose.yml` | Backend, Redis, Jaeger, Prometheus |
| CI | `.github/workflows/` | Backend CI, Rust contracts CI, and PR validation workflows |

## Common Commands

From the repository root:

```sh
npm run install:all
npm run dev
npm run test:backend
npm run lint:backend
npm run migrate:check
```

Backend-only:

```sh
cd backend
npm run dev
npm run build
npm test
npm run test:coverage
npm run prisma:generate
npm run prisma:migrate
npm run migrate:verify
npm run migrate:check
npm run migrate:status
npm run start:worker:recurring-payments
npm run start:worker:key-rotation
npm run start:worker:fee-report
```

Dashboard-only:

```sh
cd dashboard
npm run dev
npm run build
npm run lint
```

Mock server:

```sh
cd tools/mock-server
npm run dev
npm run build
npm test
```

Rust workspaces:

```sh
# Root workspace contracts
cargo test
cargo build --release

# Secondary contracts workspace
cd contracts
cargo test
cargo build --release
```

## Backend Index

The backend is a TypeScript Express app with Jest/Supertest coverage, Prisma persistence (PostgreSQL/SQLite), Redis-backed caching and rate limiting, BullMQ distributed task queue, Swagger docs, Prometheus metrics, feature flags, resilience circuit breakers, notifications, and OpenTelemetry tracing support.

Backend source breakdown:

| Path | Files | Contents |
| --- | ---: | --- |
| `backend/src/services/` | 103 | Business logic: auth, Stellar, KYC, relayer, multisig, recurring payments, batch payments, fees, metrics, indexer, notifications, feature flags, storage |
| `backend/src/api/` | 80 | API routes (37), controllers (26), and middleware (17) |
| `backend/src/lib/` | 20 | Prisma client, Redis client, KMS key management, notification providers, SMTP/email, Socket.io |
| `backend/docs/` | 15 | Dedicated architecture, operational, security, and setup documentation |
| `backend/src/utils/` | 14 | Logger, Logstash transport, SEP-10 helpers, storage key helpers, tracing utilities, sampling config |
| `backend/prisma/` | 12 | Prisma schema, migrations, migration lock, SQLite dev DB |
| `backend/scripts/` | 12 | Migration verification, integrity checking, rollback generation, DB bootstrap |
| `backend/src/config/` | 11 | Env validation, networks, auth thresholds, assets, Swagger, queues, feature flags, SEP-38 caching |
| `backend/src/workers/` | 11 | Contract queue worker, fee report worker/scheduler, recurring payments worker, upload expiry scheduler, KYC expiry scheduler, key rotation worker |
| `backend/src/test/` | 10 | Higher-level / end-to-end style integration tests |
| `backend/src/tracing/` | 9 | Tracing service, OpenTelemetry middleware, Winston format, Prisma extension |
| `backend/src/resilience/` | 8 | Circuit breaker factory, registry, Horizon/Redis/third-party API proxies, telemetry |
| `backend/src/sep31/` | 4 | SEP-31 cross-border remittance router, service, types, validation |
| `backend/src/types/` | 4 | Indexer, relayer, and alert shared TypeScript type declarations |

Key directories:

| Path | Contents |
| --- | --- |
| `backend/src/api/routes/` | Express routers for admin, auth, API keys, assets, batch, config, events, feature flags, fees, info, metrics, multisig, notifications, queue dashboard, recurring payments, relayer, SEP flows (SEP-6, 10, 12, 24, 31, 38, 40), transactions, users |
| `backend/src/api/controllers/` | Controller layer handling request validation and delegating to services |
| `backend/src/api/middleware/` | Auth (JWT/SEP-10), API key, dynamic rate limiting, metrics, OpenTelemetry tracing, request logging, security headers, feature flags, error handling |
| `backend/src/services/` | Business logic: auth, Stellar, KYC, relayer gasless onboarding, multisig coordination, recurring payments, batch payments, fee estimation/reporting, price aggregation, event indexer, storage providers |
| `backend/src/workers/` | Background BullMQ workers, recurring payment runners, and scheduled cron jobs |
| `backend/src/resilience/` | Opossum-based circuit breakers, Horizon proxy, Redis proxy, and external API fallback wrappers |
| `backend/src/lib/` | Prisma ORM, Redis singleton, KMS key management/envelope encryption, notification providers (Email, SMS, Push), Socket.io |
| `backend/prisma/` | Prisma schema, migration definitions, SQLite dev database |
| `backend/scripts/` | Migration verification, schema integrity checking, bootstrap scripts, rollback generation |
| `backend/docs/` | Feature flags, migration integrity, key management, task queue, multisig coordination, SEP-40, Soroban error handling, disaster recovery, BullMQ setup |

Mounted routes in `backend/src/index.ts`:

| Mount | Router | Description |
| --- | --- | --- |
| `/` | Root handler | Welcome / status message |
| `/health` | Health check handler | Multi-service health check (Database, Redis, Soroban RPC) |
| `/api-docs`, `/api-docs.json` | Swagger UI / JSON | Interactive Swagger API documentation |
| `/api/transactions` | `transactions.route.ts` | Transaction history, detail, and submission |
| `/api/admin` | `admin.route.ts` | Admin auth, user management, and system administration |
| `/api/config` | `config.route.ts` | Dynamic system configuration and audit log inspection |
| `/api/reports` | `fee-report.route.ts` | Fee statistics, PDF/CSV generation, and scheduled reporting |
| `/api/events` | `event.route.ts` | Soroban and Horizon event subscriptions and querying |
| `/api/notifications` | `notifications.route.ts` | User notification preferences and message dispatch |
| `/api/relayer` | `relayer.route.ts` | Gasless token approval and relayer execution |
| `/api/recurring-payments` | `recurring-payments.route.ts` | Recurring payment schedules and run histories |
| `/api/queue-dashboard` | `queue-dashboard.route.ts` | BullMQ administrative monitoring dashboard |
| `/sep10` | `auth.route.ts` | SEP-10 Stellar challenge-response authentication (`authLimiter`) |
| `/sep12` | `sep12.route.ts` | SEP-12 KYC customer identity and document upload |
| `/sep31` | `sep31.route.ts` | SEP-31 cross-border remittance transfer API (`publicLimiter`) |
| `/sep38` | `sep38.route.ts` | SEP-38 RFQ and firm price quotes (`publicLimiter`) |
| `/sep40` | `sep40.route.ts` | SEP-40 decentralized oracle price feed rates |
| `/sep6` | `sep6.route.ts` | SEP-6 programmatic deposit and withdrawal (`publicLimiter`) |
| `/sep24` | `sep24.route.ts` | SEP-24 interactive deposit and withdrawal flow (`publicLimiter`) |
| `/info` | `info.route.ts` | SEP-6/24 custodial and asset info endpoint (`publicLimiter`) |
| `/metrics` | `metrics.route.ts` | Prometheus operational and business metrics (`publicLimiter`) |

Important backend services:

| Service | Responsibility |
| --- | --- |
| `auth.service.ts` | SEP-10 challenge generation/verification, JWT issuance, multi-key authentication |
| `stellar.service.ts` | Stellar account creation, trustlines, payments, transaction building/submission |
| `kyc.service.ts`, `kyc-provider.service.ts` | SEP-12 KYC customer data handling and third-party verification provider adapters |
| `contract-queue.service.ts` | BullMQ task queue management for asynchronous smart contract invocations |
| `circuit-breaker.service.ts` | Protocol circuit breaker monitoring and threshold evaluations |
| `relayer.service.ts` | Gasless transaction fee sponsorship and token approval relaying |
| `multisig.service.ts` | Off-chain multi-signature transaction coordination and signature collection |
| `recurring-payments.service.ts` | Recurring payment scheduling, execution, and retry management |
| `batch-payment.service.ts` | Chunked batch token payments with concurrency control and error handling |
| `fee.service.ts`, `fee-report.service.ts` | Fee calculation, statistics aggregation, and PDF/CSV report generation |
| `price-aggregation.service.ts` | Horizon and DEX price aggregation with fallback logic |
| `event-indexer.service.ts` | Soroban smart contract event polling and database indexing |
| `storage-provider.service.ts`, `upload-store.service.ts` | Local/S3/GCS file storage abstraction for temporary KYC document uploads |
| `key-rotation.service.ts` | Automated KMS master encryption key rotation |
| `feature-flag.service.ts` | Dynamic Redis/DB feature flag evaluation |
| `advanced-cache.service.ts`, `redis.service.ts` | Multi-tier caching abstractions and Redis connection management |
| `hot-wallet-monitor.service.ts` | Stellar hot wallet balance monitoring and low-balance alerting |
| `soroban-error.service.ts` | Soroban error code decoding and user-friendly error messages |

Prisma schema inventory:

- **Models**: `User`, `AdminUser`, `AdminPasswordResetToken`, `ApiKey`, `RecurringPaymentSchedule`, `RecurringPaymentRun`, `Transaction`, `FeeReport`, `NotificationPreference`, `Notification`, `KycCustomer`, `Quote`, `SystemConfig`, `AdminConfigAuditLog`, `ContractJob`, `ContractEvent`, `MultisigTransaction`, `MultisigSignature`, `MultisigNotification`, `AssetValidationResult`, `CrawlJobRecord`, `UploadRecord`.
- **Enums**: `Tier`, `RecurringPaymentScheduleStatus`, `RecurringPaymentRunStatus`, `NotificationType`, `NotificationStatus`, `KYCStatus`, `JobStatus`, `JobPriority`, `MultisigStatus`.

## Backend Worker Queue Architecture

AnchorPoint utilizes a distributed, asynchronous background processing architecture powered by **BullMQ** on **Redis** and scheduled via cron triggers.

```
┌─────────────────┐        ┌──────────────────┐        ┌────────────────────┐
│  API Controller │───────▶│ BullMQ Queue     │───────▶│ Worker Processes   │
│  (e.g. Relayer) │        │ (Redis Backed)   │        │ (Contract / Queue) │
└─────────────────┘        └──────────────────┘        └────────────────────┘
         │                           │                            │
         ▼                           ▼                            ▼
┌─────────────────┐        ┌──────────────────┐        ┌────────────────────┐
│ Database        │        │ Redis State      │        │ Stellar / Soroban  │
│ (ContractJob)   │        │ & Priority Sets  │        │ RPC Network        │
└─────────────────┘        └──────────────────┘        └────────────────────┘
```

### Job Types and Lifecycle

1. **`CONTRACT_CALL`**: Standard asynchronous invocation of Soroban contract methods (e.g. transfer, deposit). Retries up to 5 times with exponential backoff (base 3s).
2. **`CONTRACT_DEPLOY`**: Upload and deployment of WASM bytecode and contract initialization. Retries up to 3 times with exponential backoff (base 5s).
3. **`SETTLEMENT`**: High-priority batch and channel settlement operations. Retries up to 10 times with exponential backoff (base 2s).
4. **`TRANSACTION_SUBMIT`**: Building and submitting Stellar envelope XDRs with sequence number management. Retries up to 5 times.
5. **`BATCH_OPERATION`**: Bundled multi-account transfers and disbursements. Fixed delay backoff (10s).

### Priority Levels

Jobs are scheduled with priority weighting:
- `URGENT` (Priority 1): Emergency circuit breaker actions, critical settlements
- `HIGH` (Priority 2): Contract deployments, time-sensitive transaction submissions
- `NORMAL` (Priority 3): Standard contract calls, user transfers
- `LOW` (Priority 4): Batch operations, indexing, and non-blocking sync tasks

### Dedicated Workers and Schedulers

- **`contract-queue.worker.ts`**: BullMQ worker processing smart contract tasks with error classification (e.g., classifying `too_early`, `insufficient_balance`, `tx_bad_seq` as retryable with backoff, vs non-retryable invalid argument traps).
- **`fee-report.worker.ts` & `fee-report.scheduler.ts`**: Scheduled cron generator running daily/weekly/monthly fee aggregations, computing XLM totals, and compiling PDF/CSV export artifacts.
- **`recurring-payments.worker.ts`**: Periodic runner checking `RecurringPaymentSchedule` records, dispatching payment runs, and incrementing attempt/retry tracking.
- **`upload-expiry.scheduler.ts`**: Garbage collection scheduler scanning `UploadRecord` for expired temporary KYC files and cleaning them from object storage (S3/GCS/local).
- **`kyc-expiry.scheduler.ts`**: Background job scanning customer KYC verification records and updating statuses to `KYC_EXPIRING_SOON` or expired.
- **`key-rotation.worker.ts`**: Cryptographic worker automating KMS key rotation and re-encrypting encrypted database secrets.
- **Queue Telemetry**: Real-time queue metrics and job health are exposed via `/api/queue-dashboard` (Bull-Board UI) and `/metrics` (Prometheus).

## Contract Storage Schema Patterns

Soroban smart contracts in AnchorPoint follow strict storage categorization principles across the three Soroban storage tiers: **Instance Storage**, **Persistent Storage**, and **Temporary Storage**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Soroban Storage Tiers                           │
├──────────────────────┬────────────────────────┬────────────────────────┤
│   Instance Storage   │   Persistent Storage   │   Temporary Storage    │
├──────────────────────┼────────────────────────┼────────────────────────┤
│ • Singleton config   │ • User balances        │ • Reentrancy locks     │
│ • Admin addresses    │ • User LP shares       │ • Commit-reveal rounds │
│ • Pause / breaker    │ • Vesting grants       │ • Short-lived bitmaps  │
│ • Global totals      │ • KYC expiry entries   │ • Ephemeral session    │
│ • Oracle bindings    │ • Checkpoint history   │   states               │
└──────────────────────┴────────────────────────┴────────────────────────┘
```

### Storage Type Breakdown

1. **Instance Storage (`env.storage().instance()`)**:
   - Used for contract configuration, protocol administration, pause flags, oracle contract addresses, timelocks, and global pool reserves.
   - Tied directly to the contract instance lifecycle; archived/extended alongside the contract binary.
2. **Persistent Storage (`env.storage().persistent()`)**:
   - Used for unbounded, user-specific data entries such as user balances, LP share balances, vesting grants, KYC expiry timestamps, and historical checkpoints.
   - Independent TTL management; prevents unbounded contract storage bloat.
3. **Temporary Storage (`env.storage().temporary()`)**:
   - Used for short-lived, transient data such as reentrancy lock keys (`ReentrancyGuardKey::Locked`), multi-phase random generation commit states, and temporary indexing buffers.
   - Lowest storage cost; automatically pruned when expired.

### Crate Storage Schema Reference

| Crate | Storage Keys (`DataKey`) | Tier Usage | Description |
| --- | --- | --- | --- |
| `src/amm` | `Admin`, `TokenA`, `TokenB`, `ReserveA`, `ReserveB`, `TotalShares`, `Paused`<br>`Shares(Address)` | Instance<br>Persistent | Pool admin, token pair, reserves, total shares, and pause state stored in Instance; user LP share ledger stored in Persistent. Reentrancy guard protected. |
| `src/circuit_breaker` | `Admin`, `PauseTier`, `UnpauseUnlocksAt`, `PendingUnpauseTier`, `TimelockSeconds`, `AuthorizedBots`, `OracleContract`, `ReferencePrice(Address)`, `VolatilityBps`, `TripCount`, `VolumeThreshold`, `VolumeWindow` | Instance | Full circuit breaker state: pause tier (`None`, `SwapOnly`, `WithdrawOnly`, `All`), timelock unlock timestamps, bot address vector, asset reference prices, rolling volume window. |
| `src/flash_loan` | `FeeBps`, `SecurityRegistry` | Instance | Flash loan fee configuration (basis points) and security registry address. Supports single and multi-asset batch loans with balance verification. |
| `src/token` | `Admin`, `TotalSupply(u64)`, `TokenMetadata(u64)`<br>`Balance(u64, Address)`, `Allowance(u64, Address, Address)`, `OperatorApproval(Address, Address)` | Instance<br>Persistent | Global token metadata and total supply in Instance; user balances, token allowances, and operator approvals in Persistent. |
| `src/staking` | `Admin`, `Token`, `BaseRate`, `Tiers`, `PenaltyBps`, `Stake(Address)`<br>`SnapshotEpoch`, `TotalStaked`, `EpochTotal(u32)`, `UserCheckpoint(Address, u32)` | Instance<br>Persistent | Staking parameters and lock tiers in Instance; epoch-based user checkpoints and historical snapshot weights in Persistent. |
| `src/governance` | `Admin`, `TokenContract`, `ProposalCounter`, `Proposal(u32)`, `UserVotes(u32, Address)`, `VotingCredits(Address)` | Instance | Proposal lifecycle, voting threshold, voting power credit tracking, and tally states. |
| `src/kyc` | `Admin`, `VerifierPubKey`<br>`UserKyc(Address)` | Instance<br>Persistent | Verifier ed25519 public key and admin in Instance; individual user KYC expiration timestamps in Persistent. |
| `src/bridge` | `Admin`, `RelayerKey`, `MinCollateralRatio`<br>`Processed(BytesN<32>)`, `SourceLocked(u32, Address)`, `DestinationMinted(u32, Address)` | Instance<br>Persistent | Relayer config and ratios in Instance; processed transaction hashes (replay prevention) and lock/mint mappings in Persistent. |
| `src/proxy` / `src/upgradeable` | `Admin`, `Implementation`, `PendingWasmHash`, `PendingUnlocksAt`, `Approvers`, `ApprovalCount` | Instance | Upgradeable proxy storage tracking current WASM executable hash, proposed upgrade hash, timelock unlock timestamp, and multi-sig approvers. |
| `src/liquidation` | `OracleId`, `CollateralToken`, `DebtToken`, `NextVaultId`<br>`Vaults(u32)` | Instance<br>Persistent | Oracle and token parameters in Instance; individual collateralized debt position (CDP) vaults in Persistent. |
| `src/vesting` | `Admin`, `GrantCounter`<br>`Grant(u32)` | Instance<br>Persistent | Vesting admin and counter in Instance; individual vesting schedules and claimed amounts in Persistent. |
| `src/yield_farming` | `Admin`, `AmmPool`, `RewardToken`, `RewardRate`, `LastUpdateLedger`, `RewardPerShareStored`<br>`Stake(Address)` | Instance<br>Persistent | AMM pool reference, reward rate, and accumulated reward-per-share in Instance; user staked LP amounts in Persistent. |
| `src/random` | `Admin`, `CurrentPhase`, `RoundCounter`, `Commitment(u32, Address)`, `Secret(u32, Address)`, `CommitCount(u32)` | Instance | Multi-round commit-reveal randomness protocol state. |
| `src/security_registry` | `SuperAdmin`, `IsPaused`, `ContractPaused(Address)` | Instance | Global emergency protocol pause and per-contract pause status lookup. |
| `src/utils` / `contracts/reentrancy-guard` | `ReentrancyGuardKey::Locked` | Temporary / Instance | Transient reentrancy mutex acquisition key preventing recursive reentrancy attacks. |
| `contracts/swap` | `TokenA`, `TokenB`, `CurrentTick`, `CurrentSqrtPriceX96`, `CurrentLiquidity`, `FeeGrowthGlobal0X128` | Instance | Concentrated liquidity pool tick math, price roots, and global fee growth accumulators. |
| `contracts/liquid_staking` | `Admin`, `StakeToken`, `RewardToken`, `NftContract`, `TotalStaked`, `RewardPerTokenStored` | Instance / Persistent | Liquid staking pool state and reward accumulators with NFT receipt token integration. |
| `contracts/xlm_wrapper` | `Admin`, `TotalSupply`, `Name`<br>`Balance(Address)`, `Allowance(Address, Address)`, `OperatorApproval(Address, Address)` | Instance<br>Persistent | Wrapped XLM contract parameters in Instance; account balances and allowance delegations in Persistent. |
| `contracts/registry` | `Admin`, `PendingAdmin`, `Contract(String)`, `AllContractTypes`, `RegistryVersion`, `Paused` | Instance | Contract registry mapping human-readable contract names to deployed addresses with two-step admin transfer. |
| `contracts/revenue_distributor` | `Admin`, `Treasury`, `GovStakers`, `GovShareBps`, `PayoutTokens`, `PayoutCursor` | Instance | Revenue distribution parameters, fee sweep cursor, and treasury/governance payout splits. |

## Root Rust Workspace Index

The root `Cargo.toml` workspace manages 24 core Soroban smart contract crates and development utilities under `src/`:

`amm`, `auth`, `batch`, `bridge`, `circuit_breaker`, `escrow_multisig`, `escrow_timelock`, `event_hub`, `flash_loan`, `governance`, `indexing`, `kyc`, `liquidation`, `oracle_consumer`, `oracle_medianizer`, `proxy`, `random`, `security_registry`, `staking`, `token`, `upgradeable`, `utils`, `vesting`, `yield_farming`, `benchmarks`.

Notable root workspace crates:

| Crate | Main focus |
| --- | --- |
| `src/amm` | Constant-product AMM pool with geometric mean initial liquidity, 0.3% swap fees, user LP share accounting, per-pool pause controls, and reentrancy protection |
| `src/auth` | Role-Based Access Control (RBAC) and authorization primitives for contract administration |
| `src/batch` | Atomic multi-operation batch executor contract bundling sequential contract calls |
| `src/bridge` | Cross-chain bridge coordinator managing locked collateral, relayer-signed mints, and replay protection |
| `src/circuit_breaker` | Protocol circuit breaker supporting tiered pauses (`SwapOnly`, `WithdrawOnly`, `All`), oracle volatility triggers, rolling volume thresholds, and timelocked unpausing |
| `src/escrow_multisig` | M-of-N threshold multi-signature escrow contract |
| `src/escrow_timelock` | Timelocked escrow contract with conditional claimant releases and refund mechanisms |
| `src/event_hub` | Protocol event aggregation and notification publication hub |
| `src/flash_loan` | Uncollateralized flash loan provider supporting single-asset and multi-asset batch loans with balance verification and receiver callbacks |
| `src/governance` | On-chain governance system with proposal submission, voting power credit tracking, and timelocked execution |
| `src/indexing` | Optimized contract indexer utilizing compact active bitmaps and address-to-ID mappings |
| `src/kyc` | On-chain KYC registry verifying cryptographic signatures from approved KYC verifiers with expiry tracking |
| `src/liquidation` | Collateralized debt position (CDP) liquidation engine integrated with oracle price feeds |
| `src/oracle_consumer` | TWAP-capable oracle price consumer with data staleness validation |
| `src/oracle_medianizer` | Multi-source price aggregator computing median values across independent oracle feeds |
| `src/proxy` | Upgradeable proxy contract executing multi-sig approved, timelocked WASM upgrades |
| `src/random` | Multi-round commit-reveal verifiable random number generator |
| `src/security_registry` | Protocol-wide emergency pause registry and per-contract security status directory |
| `src/staking` | Flexible staking rewards engine with configurable lock tiers, early withdrawal penalties, and snapshot epoch checkpoints |
| `src/token` | Fungible and semi-fungible token contract with balances, allowances, and operator approvals |
| `src/upgradeable` | Multi-sig contract upgrade proposal, signature collection, and execution module |
| `src/utils` | Shared contract utilities: cross-contract reentrancy guard, contract metadata, fee calculations, and storage helpers |
| `src/vesting` | Token vesting schedule manager supporting linear streams and cliff durations |
| `src/yield_farming` | AMM liquidity provider (LP) yield farming and token reward distribution contract |
| `src/benchmarks` | Resource consumption and gas benchmarking harness for Soroban contract operations |

## Contracts Workspace Index

The `contracts/` workspace uses `soroban-sdk = 22.0.0` and contains 12 deployable and example contract packages:

| Crate | Main focus |
| --- | --- |
| `contracts/anchorpoint` | Admin configuration, rate-limiting, action cooldowns, and storage key utilities |
| `contracts/bridge_stub` | Burn/mint bridge test stub with relayer access controls |
| `contracts/governance` | Standalone governance contract with comprehensive state-machine, fuzz, and storage verification tests |
| `contracts/liquid_staking` | Liquid staking pool issuing NFT receipt metadata for staked positions |
| `contracts/nft_metadata` | Dynamic NFT collection and token metadata management contract |
| `contracts/random_gen` | Standalone commit-reveal random generator with committer list management |
| `contracts/reentrancy-guard` | Reusable reentrancy guard module with security documentation and vulnerable/protected vault examples |
| `contracts/registry` | Versioned contract address registry with pause states and two-step admin transfer |
| `contracts/revenue_distributor` | Protocol fee revenue distributor routing AMM swap fees to stakers and treasury |
| `contracts/staking` | Multi-reward token staking contract with whitelist enforcement |
| `contracts/swap` | Concentrated liquidity style multi-asset swap contract |
| `contracts/xlm_wrapper` | Wrapped XLM token contract with admin pause and operator approval capabilities |
| `contracts/yield` | Staking yield distribution pool with reward-per-token tracking |

## Dashboard Index

The dashboard is a Vite React application built with TypeScript, Tailwind CSS, Framer Motion, Lucide icons, Axios, and Stellar SDK.

Key files:

| Path | Purpose |
| --- | --- |
| `dashboard/src/App.tsx` | Main application shell, route navigation, overview metrics, transaction table, SEP-24 modal |
| `dashboard/src/main.tsx` | React 18 DOM mount and root provider initialization |
| `dashboard/src/index.css` | Tailwind base directives, custom utilities, and CSS theme variables |
| `dashboard/vite.config.ts` | Vite configuration, dev server proxy, and alias definitions |
| `dashboard/tailwind.config.js` | Tailwind color palettes, typography, and animation configurations |
| `dashboard/docs/` | Cross-browser QA, mobile testing, and webhook notification integration guides |

The frontend defaults API calls to `http://localhost:3002` unless `VITE_API_BASE_URL` is set.

## Mock Server And Demo

`tools/mock-server` is a deterministic Express server providing local Horizon REST and Soroban RPC simulation:

| Path | Purpose |
| --- | --- |
| `tools/mock-server/src/server.ts` | Server bootstrap mounting Horizon and Soroban RPC handlers |
| `tools/mock-server/src/horizon/routes.ts` | Horizon REST mocks (accounts, transactions, fee stats, claimable balances) |
| `tools/mock-server/src/soroban/routes.ts` | Soroban JSON-RPC mocks (`getHealth`, `getEvents`, `getTransaction`, `simulateTransaction`, `sendTransaction`) |
| `tools/mock-server/src/scenarios/` | Scenario switching (success, rate limit, timeout, failure simulations) |
| `tools/mock-server/src/ledger-state/` | Fixture-backed ledger state management |
| `tools/mock-server/fixtures/` | Mock ledger accounts and contract state fixtures |

`demo/server.js` is the lightweight mock anchor server used for basic dashboard demonstration flows.

## Infrastructure Index

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | Multi-container local stack: Backend API, Redis, Jaeger tracing, Prometheus |
| `prometheus.yml` | Prometheus scrape targets and interval configuration |
| `infra/k8s/workers/` | Kubernetes worker deployment manifests and horizontal autoscalers |
| `infra/k8s/cert-manager/` | cert-manager ClusterIssuers, Let's Encrypt certificates, ingress annotations |
| `infra/k8s/ingress-nginx/` | NGINX ingress controller routing rules and SSL termination |
| `infra/terraform/rds/` | AWS RDS PostgreSQL Terraform module and variable definitions |
| `infra/terraform/kms/` | AWS KMS key management Terraform module and QA runbooks |
| `infra/elasticsearch/watchers/` | Elasticsearch watchers for error spikes and latency threshold alerts |
| `infra/logstash/pipeline.conf` | Logstash processing pipeline parsing backend JSON logs |
| `infra/kibana/dashboard.ndjson` | Pre-configured Kibana visualizations and analytics dashboards |
| `infra/monitoring/` | Infrastructure monitoring dashboards, metrics exporters, and alert rules |

## Documentation Index

High-signal repository documentation:

| Path | Topic |
| --- | --- |
| `README.md` | Monorepo overview, architecture, quickstart, and workspace map |
| `backend/README.md` | Backend architecture, setup, environment configuration, and test suites |
| `docs/TRACING_README.md` | OpenTelemetry distributed request tracing and Jaeger visualization guide |
| `docs/PRODUCTION_READINESS.md` | Production deployment checklist, security validations, and health requirements |
| `docs/TESTNET_DEPLOYMENT_ARCHITECTURE.md` | Stellar testnet deployment architecture and contract addresses |
| `docs/UPGRADEABLE_PATTERN_GUIDE.md` | Soroban upgradeable contract patterns, multi-sig timelocks, and migrations |
| `docs/WITHDRAWAL_FLOW_TESTNET_QA.md` | Testnet QA runbook for end-to-end SEP-24/SEP-6 withdrawal workflows |
| `docs/mock-server.md` | Horizon REST & Soroban JSON-RPC mock server setup and scenarios |
| `docs/rate-limiting.md` | Redis dynamic rate limiting policies and configuration |
| `docs/security-audit.md` | Security review, threat model analysis, and mitigation checklist |
| `docs/testing-governance.md` | Governance contract fuzzing, storage verification, and test execution |
| `backend/docs/BULLMQ_WORKER_SETUP.md` | BullMQ worker setup, concurrency tuning, and Redis queue management |
| `backend/docs/DISASTER_RECOVERY_DB_RESTORE.md` | Database disaster recovery, WAL archiving, and point-in-time restore procedures |
| `backend/docs/FEATURE_FLAGS.md` | Dynamic runtime feature flag management and caching |
| `backend/docs/FUTURENET_CONFIGURATION.md` | Futurenet network configuration and contract deployments |
| `backend/docs/KEY_MANAGEMENT.md` | AWS KMS key management, envelope encryption, and secret rotation |
| `backend/docs/MIGRATION_INTEGRITY.md` | Database migration verification, drift detection, and automated rollback |
| `backend/docs/MULTISIG_COORDINATION.md` | Off-chain multi-signature transaction coordination and signature collection |
| `backend/docs/MULTISIG_SETUP.md` | Multisig signer threshold setup and key allocation |
| `backend/docs/REDIS_CHALLENGES.md` | Redis challenge storage and authentication TTL management |
| `backend/docs/RELAYER_GASLESS_ONBOARDING.md` | Relayer architecture and gasless onboarding workflows |
| `backend/docs/resilience-patterns.md` | Backend circuit breaker proxies, telemetry, and external service fallbacks |
| `backend/docs/SEP40_SWAP_RATES.md` | SEP-40 decentralized price oracle integration and caching |
| `backend/docs/SOROBAN_ERROR_HANDLING.md` | Soroban contract error interpretation and category mapping |
| `backend/docs/TASK_QUEUE.md` | Distributed task queue architecture and worker execution |
| `contracts/reentrancy-guard/README.md` | Reentrancy guard usage and test fixtures |
| `contracts/reentrancy-guard/SECURITY_GUIDE.md` | Reentrancy security principles and contract patterns |
| `contracts/registry/README.md` | Contract address registry usage |
| `contracts/swap/README.md` | Concentrated swap contract usage |
| `contracts/xlm_wrapper/README.md` | Wrapped XLM token contract usage |
| `src/event_hub/README.md` | Event hub contract documentation |

## Watch Points From The Scan

These are operational and architectural considerations to keep in mind when modifying or deploying AnchorPoint:

1. **Dual Listeners in `backend/src/index.ts`**: Verify HTTP/Socket.io server initialization on port 3002 to avoid duplicate listener bindings in production environments.
2. **Rate Limiter Placement**: Public endpoints (`/sep6`, `/sep24`, `/sep31`, `/sep38`, `/info`, `/metrics`) share `publicLimiter` Redis-backed rate limiting; authenticated routes (`/sep10`) use dedicated `authLimiter`.
3. **Database Migration Verification**: Always run `npm run migrate:check` and `npm run migrate:verify` in `backend/` before deploying Prisma schema updates to verify migration integrity and prevent drift.
4. **BullMQ Concurrency**: In high-load environments, ensure worker concurrency (`QUEUE_CONCURRENCY`) matches available database connection pool limits.
5. **Contract Storage Rent**: For production Soroban contracts, ensure persistent storage entries (e.g. balances, checkpoints) are monitored for TTL extensions using automated archiver/rent bots.

## Quick Orientation For Future Changes

Use this routing pattern for backend work:

1. Start at the route in `backend/src/api/routes/`.
2. Follow to a controller in `backend/src/api/controllers/` if present.
3. Follow business logic into `backend/src/services/` or background workers in `backend/src/workers/`.
4. Check persistence in `backend/prisma/schema.prisma` and migrations.
5. Check tests colocated beside routes/services or under `backend/src/test/`.

Use this pattern for contract work:

1. Identify the workspace: root `src/*` or `contracts/*`.
2. Inspect the crate `Cargo.toml`.
3. Read the crate `lib.rs` and any `tests` modules.
4. Prefer existing shared utilities in `src/utils` and established security patterns such as `security_registry`, `circuit_breaker`, and `reentrancy-guard`.
5. Adhere to Soroban storage tier best practices (Instance vs Persistent vs Temporary).

Use this pattern for dashboard work:

1. Start at `dashboard/src/App.tsx`.
2. Check API assumptions against `VITE_API_BASE_URL` and backend routes.
3. Keep styling aligned with `dashboard/src/index.css` and Tailwind config.
