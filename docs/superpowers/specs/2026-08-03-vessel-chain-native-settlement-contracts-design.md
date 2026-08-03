# Vessel Chain-Native Settlement Contracts Design

**Date:** 2026-08-03

**Status:** Approved architecture, awaiting written-spec review

**Initial chains:** Aptos Testnet and Solana Devnet

**Depends on:** `2026-08-03-hot-storage-beta-retention-pricing-renewal-design.md`

## Context

Vessel currently settles payments by transferring ShelbyUSD to a normal Aptos treasury account or Devnet USDC to a normal Solana treasury token account. The backend then inspects the transaction and issues an authorization for the storage operation. This proves a payment occurred, but it does not provide a platform-owned on-chain state machine, durable replay protection, contract-controlled custody, or a portable receipt format.

The direct-transfer settlement paths must be retired. Vessel will deploy one native settlement implementation per supported payment chain: a Move package on Aptos and a Solana Program. Both implementations verify the same short-lived Ed25519 quote format, custody funds in program-controlled vaults, prevent quote reuse, and emit equivalent receipts. The backend verifies those receipts before it permits registration, sponsorship, or byte upload.

## Product and security contract

- Every payment to Vessel passes through the Vessel settlement contract or program on the payer's chain.
- No user payment is sent directly to a normal treasury wallet or externally owned token account.
- Aptos protocol gas and Shelby storage charges are not Vessel revenue. They continue to flow directly to validators and Shelby during blob registration.
- A settlement is valid only when the chain-native contract verifies the Vessel quote signature and creates a unique receipt for its `quote_id`.
- Vault withdrawals, signer rotation, accepted-asset changes, pausing, and upgrades are controlled by multisig from the first public deployment.
- Aptos governance uses an Aptos Multisig Account. Solana governance uses Squads.
- Beta upgrades are delayed by at least 24 hours. Upgrade authority can be removed permanently before mainnet.
- One dedicated Ed25519 quote-signing key is shared by the Aptos and Solana settlement implementations. Its public key is stored on-chain; its private key is an online operational key and never has withdrawal or upgrade authority.

## Goals

- Replace direct Aptos and Solana treasury transfers with contract-mediated settlement.
- Define one canonical, cross-chain quote payload and receipt model.
- Verify quotes on-chain, including wallet, asset, amount, file, storage identity, expiration, and network domain.
- Make replay impossible by allowing one successful receipt per `quote_id`.
- Keep user funds in contract/program-controlled vaults until a multisig withdrawal is executed.
- Preserve the existing Shelby registration model for native Aptos and sponsored Solana DAA uploads.
- Provide idempotent recovery after payment so a browser or backend failure never asks for the same payment twice.
- Establish a `SettlementAdapter` boundary that allows a future EVM contract without changing upload orchestration.

## Non-goals

- Bridging funds or receipts between chains.
- A single global cross-chain contract.
- Mainnet payments or claims that test tokens have monetary value.
- On-chain calculation of Shelby pricing, gas conversion, or the two-percent service fee.
- Contract-controlled custody of Aptos gas or Shelby protocol storage payments.
- Automatic refunds, chargebacks, fiat accounting, tax reporting, or revenue distribution.
- A custom multisig implementation.
- Adding EVM settlement in this delivery.

## Architecture

```text
Quote service
  -> canonical QuoteV1 bytes
  -> Ed25519 signature
  -> wallet submits to chain-native Vessel settlement
       Aptos Move contract -> ShelbyUSD service-fee vault -> SettlementReceipt event
       Solana Program      -> Devnet USDC total vault      -> receipt PDA + event
  -> backend SettlementAdapter verifies finalized receipt
  -> paid authorization bound to the receipt
  -> Shelby registration and byte upload continue
```

The settlement contracts share behavior, not state. Each chain maintains its own vault, replay registry, governance configuration, and receipts. The backend normalizes verified receipts into one internal type.

## Canonical quote format

### Serialization and signature

`QuoteV1` is serialized with Binary Canonical Serialization (BCS). Move uses its native BCS representation; the Solana Rust program and TypeScript client use the same field order and primitive widths. The Ed25519 signature covers:

```text
sha2_256("VESSEL_SETTLEMENT_V1" || bcs(QuoteV1))
```

The domain prefix is fixed ASCII. No JSON, locale-dependent number, floating-point value, or unordered map appears in signed data.

### QuoteV1 fields

Fields appear in this exact order:

1. `version: u8` — must equal `1`.
2. `chain: u8` — `1` for Aptos, `2` for Solana.
3. `network: u32` — Aptos uses its ledger chain ID (`2` on Testnet); Solana uses `1` for Devnet in QuoteV1.
4. `quote_id: vector<u8>` — exactly 32 cryptographically random bytes.
5. `payer: vector<u8>` — exactly 32 address/public-key bytes.
6. `storage_address: vector<u8>` — exactly 32 Aptos native or DAA storage-address bytes.
7. `asset: vector<u8>` — exactly 32 Aptos FA metadata or Solana mint bytes.
8. `amount: u64` — exact smallest-unit amount collected by this chain's Vessel vault.
9. `file_hash: vector<u8>` — exactly 32 SHA-256 bytes.
10. `retention_days: u16` — integer from 1 through 365.
11. `storage_expiration_micros: u64` — exact expiration bound to the Shelby registration.
12. `quote_expires_at_secs: u64` — five minutes after issuance.
13. `config_version: u64` — active settlement configuration version.

The chain-native implementation reconstructs the payload, hashes it, and verifies the Ed25519 signature against its configured quote signer. It also checks chain/network, payer, accepted asset, amount greater than zero, quote expiration, retention bounds, and active configuration version.

The quote service keeps the existing itemized accounting response for UI display, but HMAC is no longer payment evidence. Any internal server token is subordinate to the on-chain signed quote and receipt.

## Normalized settlement receipt

Every successful settlement yields the following normalized evidence:

- chain and network;
- contract/program identifier;
- `quote_id`;
- payer and storage address;
- accepted asset and exact amount;
- file hash and storage expiration;
- on-chain transaction hash/signature;
- block height or ledger version;
- finalized timestamp;
- contract configuration version.

The receipt is immutable. A second settlement with the same `quote_id` fails on-chain before any additional transfer occurs.

## Aptos Move contract

### Resources and events

The Move package contains a focused `vessel_settlement` module with:

- `Config`: Aptos chain ID, Ed25519 quote public key, ShelbyUSD metadata object address, config version, multisig admin address, pause state, and permanent-lock state;
- a contract-owned primary fungible store for accepted ShelbyUSD service fees;
- a replay table keyed by the 32-byte `quote_id`;
- `SettlementReceiptV1`, `Withdrawal`, `ConfigChangeScheduled`, `ConfigChangeExecuted`, `Paused`, and `UpgradeLocked` events.

### User settlement

`settle(payer, quote, signature)` performs all validation before moving funds. It verifies the caller is the signed payer, validates `QuoteV1`, rejects used or expired quote IDs, transfers the exact ShelbyUSD service-fee amount from the payer's primary fungible store to the contract vault, marks the quote ID used, and emits `SettlementReceiptV1`.

For native Aptos uploads, only the Vessel service fee or minimum uplift enters this vault. The wallet separately pays APT gas and Shelby protocol storage cost in the Shelby registration transaction. Vessel must display these as separate debits.

### Aptos governance

The package is published and administered by an Aptos Multisig Account. Early execution is disabled and the multisig voting duration enforces a minimum 24-hour beta delay for upgrades and sensitive configuration actions. Contract-level configuration changes use schedule/execute operations and cannot execute before their recorded timestamp.

The multisig controls withdrawals, pause/unpause, accepted metadata, quote-signer rotation, and package upgrades. The online quote signer controls none of these. Before mainnet, the package upgrade policy is changed irreversibly to immutable and the contract records `UpgradeLocked`.

## Solana Program

### Accounts and instructions

The Solana implementation uses Anchor and contains:

- a configuration PDA with cluster discriminator, quote public key, accepted USDC mint, config version, Squads authority, pause state, and lock state;
- a program vault ATA owned by a vault-authority PDA;
- one receipt PDA per quote, derived from `["receipt", quote_id]`;
- `settle`, `schedule_config_change`, `execute_config_change`, `withdraw`, `pause`, `unpause`, and `lock_upgrade` instruction surfaces.

### User settlement

The transaction contains an Ed25519 verification instruction immediately before the Vessel `settle` instruction. The program reads the instructions sysvar and proves that the configured public key signed the exact `QuoteV1` digest supplied to `settle`. It validates payer, cluster, mint, amount, expiry, retention, storage address, file hash, and config version.

The program creates the unique receipt PDA and transfers the exact quoted Devnet USDC total from the payer's ATA into the program vault ATA. The Solana total includes the accounting amount used to reimburse Vessel's Aptos gas and ShelbyUSD sponsorship plus the Vessel service fee. Creating the receipt PDA makes replay fail before a second token transfer.

### Solana governance

Squads is the program upgrade authority and the authority stored in the configuration PDA. Squads enforces a minimum 24-hour beta timelock for upgrades, withdrawals, signer rotation, accepted-mint changes, and other sensitive actions. The quote signer has no governance capability.

Before mainnet, a Squads proposal removes the BPF program upgrade authority permanently. The program records the lock intent before authority removal so indexers and the UI can show the immutable state.

## Backend boundaries

### Quote signer

The quote service calculates the same itemized prices already shown by Vessel, builds `QuoteV1`, hashes the domain-separated BCS bytes, and signs the digest with the shared Ed25519 operational key. Production startup fails closed if the key is missing, malformed, or does not match both on-chain configurations.

The signing key is versioned and stored in a secret manager or KMS-compatible signing service. Rotation is: schedule both on-chain changes, wait for both timelocks, execute both changes, update the signer service, and verify both configurations before issuing new quotes. Old quotes expire within five minutes, so no long dual-key window is required.

### SettlementAdapter

```text
SettlementAdapter.verify({ quote, transactionId })
  -> NormalizedSettlementReceipt
```

`AptosSettlementAdapter` verifies a successful finalized transaction, the exact Vessel module and event type, event fields, sender, vault transfer, quote ID, and ledger version. `SolanaSettlementAdapter` verifies finality, program ID, receipt PDA contents, vault token movement, quote ID, and slot.

The adapters never accept a normal wallet transfer, memo-only payment, arbitrary token transfer, or event from an unconfigured contract/program address.

### Paid authorization and sponsorship

After a receipt is verified, the backend issues a short-lived internal paid authorization bound to the receipt and full quote. This authorization may remain server-signed because contracts already provide the payment proof. It cannot be reused for another file, storage address, duration, registration, or chain.

For Solana DAA, the verified program receipt unlocks Aptos sponsorship. For native Aptos, the verified Move receipt unlocks the user's Shelby registration path. Registration success and settlement success remain separate required checkpoints.

## End-to-end flows

### Native Aptos

`select file` -> `request signed QuoteV1` -> `Petra settles Vessel fee through Move contract` -> `backend verifies SettlementReceiptV1` -> `Petra signs Shelby registration` -> `APT gas and ShelbyUSD protocol fee go directly to protocol` -> `write bytes` -> `reconcile artifact`.

### Solana DAA

`select file` -> `request signed QuoteV1` -> `wallet submits Ed25519 verify + Vessel Program settle` -> `USDC enters program vault and receipt PDA is created` -> `backend verifies receipt` -> `DAA signs registration` -> `Aptos gas station sponsors protocol costs` -> `write bytes` -> `reconcile artifact`.

## Recovery and idempotency

The browser records the quote and transaction ID immediately after wallet submission and before backend verification. Verification retries the same transaction with bounded backoff; it never starts a second settlement automatically.

- Submitted but not finalized: show `Payment pending` and retry receipt verification.
- Finalized contract receipt but backend unavailable: resume from the transaction ID and quote ID.
- Receipt verified but registration not submitted: reuse the paid authorization.
- Registration succeeded but byte write failed: resume the hash-bound write without another settlement.
- Quote expired before settlement: request a new quote; no funds moved.
- Wallet rejection or on-chain failure: retain the file selection and request no new approval automatically.
- Existing receipt PDA/replay-table entry: treat it as recovery evidence, not a reason to transfer again.

The known pre-contract Aptos test payment is legacy diagnostic evidence only and is not accepted as a Vessel settlement receipt. Migration must not charge it again automatically. Any refund from the former treasury is a separate, explicit operator action requiring user approval.

## Error handling

- Invalid signature, signer, domain, chain, network, payer, storage address, asset, amount, file hash, retention, expiry, or config version fails before token movement.
- Duplicate `quote_id` fails before token movement and returns a recoverable `receipt_exists` condition.
- Paused contracts reject new settlements while allowing receipt reads and multisig withdrawals.
- RPC/indexer delay produces `pending`, not `failed`; clients retry finalized receipt lookup.
- A receipt from an old or unknown deployment is rejected even when its token transfer is valid.
- Quote signer mismatch between chains disables quote issuance globally until configuration is consistent.
- No seed phrase, private key, multisig proposal payload, signed quote, or paid authorization is logged.

## Upgrade, pause, and withdrawal policy

- The beta timelock is 24 hours on both chains.
- All sensitive actions require the configured chain-native multisig threshold.
- Emergency pause may be proposed and executed through multisig; there is no single-key pause authority.
- Withdrawals specify asset, amount, and destination and emit an event. The destination may be a multisig-controlled operating account, but users never pay that account directly.
- Upgrade-lock is one-way. Once activated and the platform-specific upgrade authority is removed or made immutable, no admin action can restore upgradeability.
- Mainnet release requires immutable code or a separately approved governance design; beta authority is not silently carried into mainnet.

## Migration

1. Build and test both chain-native implementations and the shared quote codec.
2. Deploy Aptos Testnet and Solana Devnet contracts under multisig control.
3. Record module address, program ID, vault identifiers, multisig addresses, quote public key, config versions, and deployment transaction IDs in `deployments/vessel-settlement.testnet.json`.
4. Add both deployment identifiers to backend allowlists and verify on-chain configuration at startup.
5. Disable legacy direct-transfer quote and verification routes.
6. Enable contract settlement behind a beta feature flag.
7. Complete one real native Aptos settlement/upload and one real Solana DAA settlement/upload.
8. Confirm replay rejection and recovery from a deliberately interrupted backend verification.
9. Remove the legacy feature flag after recorded testnet evidence passes.

No production deployment occurs while either chain still permits the direct-transfer path.

## Testing strategy

Implementation follows test-driven development.

### Shared codec tests

- Golden BCS vectors are identical in TypeScript, Move, and Rust.
- Both chains accept the same Ed25519 public key and signature fixture.
- A one-bit change to every signed field invalidates the signature.
- Boundary values for `u64`, retention 1 and 365, expiry, and 32-byte fields are deterministic.

### Aptos Move tests

- Valid settlement moves the exact ShelbyUSD amount, records replay state, and emits the expected receipt.
- Wrong signer, payer, chain ID, asset, amount, signature, expiry, retention, file hash, config version, or paused state fails before transfer.
- Duplicate quote ID cannot debit twice.
- Only multisig-authorized operations can schedule and execute changes or withdraw.
- Timelocked actions cannot execute early; permanent lock cannot be reversed.

### Solana Program tests

- Valid Ed25519 instruction plus `settle` creates the receipt PDA and moves the exact USDC amount.
- Missing, reordered, or mismatched Ed25519 instruction fails before transfer.
- Wrong payer, cluster, mint, amount, signature, expiry, retention, file hash, config version, PDA, or paused state fails.
- Duplicate receipt PDA cannot debit twice.
- Only the Squads authority can execute timelocked admin actions and withdrawals.
- Final upgrade-authority removal is verified on Devnet.

### Backend integration tests

- Quote service signs canonical payloads and fails closed on signer/config mismatch.
- Aptos and Solana adapters reject normal wallet transfers and unknown deployments.
- Finality delays retry the same transaction without new payment.
- Receipt verification creates one operation-bound paid authorization.
- Sponsor and registration endpoints require matching receipt evidence.
- Legacy direct-transfer endpoints return a migration error and cannot authorize uploads.

### Testnet verification

- Aptos: Petra settles through the Move contract, receipt is finalized, Shelby registration succeeds, bytes are acknowledged, and replay is rejected without another debit.
- Solana: an installed wallet settles through the Vessel Program, the vault receives exact Devnet USDC, receipt PDA is finalized, DAA registration succeeds, and bytes are acknowledged.
- Both records preserve file hash, storage address, retention, quote ID, contract identity, and transaction evidence.
- Multisig schedules one harmless configuration-version update on each chain; execution before 24 hours fails and execution after the delay succeeds.

## Observability

Structured telemetry records chain, configured deployment ID, quote ID hash, receipt status, finality latency, config version, and normalized error code. It never records quote signatures, wallet signatures, secret keys, multisig signing material, file contents, or paid-authorization tokens.

The public UI links each successful settlement to the correct chain explorer and labels the receiving entity as `Vessel contract vault`, not `treasury wallet`.

## Acceptance criteria

- Aptos and Solana users pay only through configured Vessel contract/program addresses.
- Both implementations independently verify the same canonical Ed25519 quote schema.
- Funds enter contract/program-controlled vaults and require multisig withdrawal.
- One quote produces at most one on-chain receipt and at most one debit.
- Direct transfers, memo-only transfers, unknown deployments, and replayed transactions never authorize storage.
- Native Aptos continues to pay protocol gas and Shelby storage directly during registration; only Vessel revenue enters the settlement vault.
- Solana receipts unlock Aptos sponsorship only after finalized program verification.
- Interrupted verification resumes from the existing receipt without a second payment.
- Aptos Multisig Account and Squads control administration and beta upgrades with a 24-hour delay.
- Upgradeability can be removed permanently before mainnet.
- Real Testnet/Devnet evidence proves settlement, receipt, registration, byte acknowledgement, recovery, and replay rejection on both chains.
