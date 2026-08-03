# Hot-storage Beta Retention, Pricing, and Renewal Design

**Date:** 2026-08-03

**Status:** Approved design, awaiting written-spec review

**Delivery phases:** 2 of 3 (retention and quotes), then 3 of 3 (renewal and expiry recovery)

**Depends on:** `2026-08-03-gallery-confirmation-petra-compatibility-design.md`

## Context

Vessel currently proves that an Aptos or Solana wallet can own a Shelby blob, but the upload duration is hard-coded to seven days and the Solana payment uses a static size tariff. Production verification confirmed that a real test upload was registered on Aptos Testnet, acknowledged by Shelby, paid from Solana Devnet USDC, and returned byte-for-byte intact. The seven-day lifetime is an application choice, not a Shelby protocol maximum.

The next product step is a hot-storage beta for real users. The beta remains on test networks and does not promise durable mainnet storage or monetary value. It must let users choose retention, understand the full test-token charge before signing, renew a live blob, and recover from interrupted payment or upload flows.

## Product contract

Vessel provides wallet-owned, time-bound hot storage on Shelby. A user needs to be able to:

- connect an installed Aptos or Solana wallet without giving Vessel a seed phrase;
- choose how long a file remains available;
- see a transparent, intent-bound quote before any payment or signature;
- upload, download, share, and inspect an owned blob;
- extend a live blob without paying for time already purchased;
- see expiry warnings and recover an interrupted operation.

Every payment surface must say `Test tokens — no real monetary value`. The UI must identify Aptos Testnet, Solana Devnet, and Shelby Testnet wherever network ambiguity could affect a signature. No faucet link is included.

## Goals

- Replace the hard-coded seven-day duration with presets of 7, 30, and 90 days plus an integer custom duration from 1 through 365 days.
- Derive storage quotes from live Shelby on-chain configuration and the same encoding rules used to create the blob transaction.
- Add sponsored gas and a two-percent Vessel service fee, with a minimum total quote of $0.01 in test-token accounting units.
- Bind every quote and payment authorization to the exact wallet, storage account, file, and expiration.
- Support incremental renewal of a live blob and in-app expiry warnings at seven, three, and one day remaining.
- Make on-chain/indexer data authoritative while retaining a fast browser cache.
- Add recovery paths that do not charge the user twice after a partially completed operation.

## Non-goals

- Mainnet payments, real-money claims, fiat checkout, refunds, or tax/accounting workflows.
- Permanent or archival storage guarantees.
- Email, SMS, or push notifications; the beta has no user account or notification permission model.
- Automatic renewal or unattended wallet signing.
- Renewing an already expired blob. It must be uploaded again.
- Deleting bytes from Shelby when a Gallery entry is removed.
- Adding a faucet link.
- Migrating the Aptos/Shelby SDK dependency stack as part of this work.

## Delivery boundaries

### Phase 2: retention and on-chain-derived quotes

Phase 2 adds retention controls, the quote engine and API, payment-path-specific settlement, quote invalidation, authoritative expiration storage, and upload recovery. It replaces static pricing and all seven-day constants in upload and ledger paths.

### Phase 3: renewal and expiry experience

Phase 3 adds Gallery warnings, renewal quotes and transactions, expired-blob re-upload guidance, and chain/indexer reconciliation for renewal state.

These are separate implementation plans and verification checkpoints. Phase 3 starts only after Phase 2 is deployed and a real 7-day and 30-day upload have been verified on test networks.

## Upload experience

### Retention selector

After a file is selected and validated, the Upload page shows four choices:

- `7 DAYS`
- `30 DAYS`
- `90 DAYS`
- `CUSTOM`

`CUSTOM` reveals a numeric input labelled `Storage duration in days`. It accepts integers only, with a minimum of 1 and maximum of 365. Decimal, empty, negative, zero, and out-of-range values block quoting and show an inline error. Presets and custom input are mutually exclusive. The user's selection is retained only for the current file and resets when the file is cleared.

The expiration instant is calculated from the server timestamp returned with the quote, not solely from the browser clock. The UI displays both the duration and the resulting UTC expiration date.

### Quote panel

The quote panel has four explicit states: loading, ready, expired, and unavailable. A ready quote shows:

- Shelby storage cost;
- estimated sponsored gas or direct Aptos gas, depending on wallet path;
- Vessel service fee (2%);
- total test-token value, subject to the $0.01 minimum;
- token(s) the selected wallet will actually spend;
- quote expiration countdown;
- the label `Test tokens — no real monetary value`.

Changing the file, connected wallet, storage address, duration, or network immediately invalidates the quote and disables the payment/upload action until a new quote is ready. Quotes expire five minutes after issue.

### Settlement by wallet family

The same economic formula is used for both wallet families, but settlement follows the connected chain:

- **Solana DAA:** the user transfers the quoted total in Solana Devnet USDC to the Vessel treasury. Vessel then sponsors Aptos gas and ShelbyUSD storage for the DAA transaction.
- **Native Aptos:** the user pays protocol storage in ShelbyUSD and transaction gas in APT directly. Any Vessel service-fee or minimum-price difference is transferred in ShelbyUSD to the configured Vessel Aptos treasury before registration. The quote must show these as separate wallet approvals; Vessel must not describe the direct protocol debit as money received by Vessel.

For native Aptos, the quote reports APT gas and ShelbyUSD debits separately as well as a test-dollar accounting total. Gas conversion uses a versioned beta reference rate returned in the quote. Because these are test tokens, that rate is an accounting input rather than a claim of realizable market value. The rate source and timestamp are visible in quote details. A production launch requires an approved oracle policy and is outside this design.

## Quote architecture

### Components

1. **Retention model** validates days and converts the selected duration into a target expiration using the quote server time.
2. **Shelby pricing reader** fetches the active payment tier, storage-provider fee, admin fee, payment-epoch duration, and relevant contract version from Aptos Testnet.
3. **Encoding estimator** uses the installed Shelby SDK's chunk and erasure-coding configuration to calculate the same chunkset count used by registration.
4. **Gas estimator** estimates the relevant Aptos transaction in gas units and applies a documented safety margin. It returns both native APT units and the versioned beta accounting conversion.
5. **Quote calculator** creates a deterministic breakdown and applies the fee/minimum formula.
6. **Signed quote service** issues and validates a stateless HMAC token suitable for Vercel serverless execution.
7. **Settlement adapters** verify Solana USDC or Aptos ShelbyUSD payment evidence without sharing chain-specific logic with the quote calculator.
8. **Artifact reconciler** reads Shelby/Aptos indexer data and merges it into the browser cache.

Each component has a narrow interface and can be tested with fixed clocks and mocked chain readers.

### Storage-cost calculation

For a new upload:

```text
chunksets = Shelby SDK expectedTotalChunksets(fileSize, encodingConfig)
paymentEpochs = ceil((targetExpiration - quoteServerTime) / paymentEpochDuration)
storageUnits = chunksets * paymentEpochs * (adminFeePerChunkEpoch + providerFeePerChunkEpoch)
networkCost = storageUnits in ShelbyUSD accounting units
subtotal = networkCost + applicableGasAccountingCost
total = max(0.01, subtotal * 1.02)
serviceFee = total - subtotal
```

All integer contract units are calculated with `BigInt`; rounding to display decimals happens only after the total contract-unit amount is fixed. The displayed two-percent line may therefore include the minimum-price uplift when the calculated total is below $0.01. The UI labels that case `Vessel fee / minimum uplift` to avoid implying that the uplift is exactly two percent.

The pricing reader caches successful on-chain configuration for at most 30 seconds. A quote records the config version and values used, so a later calculation can be reproduced. If live configuration cannot be read, quoting fails closed; no stale static tariff is substituted.

### Signed quote contract

The signed quote includes:

- quote ID, issued-at time, server time, and five-minute expiry;
- operation type: `upload` or `renewal`;
- connected chain and network;
- source wallet address and Aptos storage/DAA address;
- SHA-256 file hash, normalized blob name, byte size, and encoding ID for uploads;
- current expiration for renewals;
- requested duration and target expiration;
- itemized contract units, gas estimate, conversion reference, service fee, total, and settlement token;
- pricing-config version and domain separator.

The server rejects any payment, sponsorship, registration, or renewal request whose supplied context differs from the signed quote. Quote validation uses constant-time signature comparison and a production-only secret; the insecure development fallback must not enable payment routes in deployed environments.

### Drift check

Immediately before the first wallet approval, the client requests a fresh validation of the quote. If the current total is unchanged or differs by at most five percent, the client replaces the old quote and proceeds with the newly signed values. If the total increases or decreases by more than five percent, the quote panel returns to ready state and requires explicit user confirmation. No payment is initiated silently after a material price change.

After registration, Vessel records the payment amount emitted by the on-chain event and the actual gas used. A mismatch is diagnostic data; it must never retroactively debit the wallet. Repeated material drift disables new quotes and raises an operator-visible error until the calculator is corrected.

## Upload transaction and recovery flow

### Normal Solana DAA flow

`hash file` -> `request signed quote` -> `revalidate quote` -> `transfer Devnet USDC with quote memo` -> `verify treasury receipt and source debit` -> `issue 24-hour paid authorization bound to quote` -> `DAA signs register transaction` -> `gas station co-signs and submits` -> `wait for Aptos success` -> `write bytes to Shelby` -> `wait for acknowledgement` -> `reconcile artifact`.

### Normal native Aptos flow

`hash file` -> `request signed quote` -> `revalidate quote` -> `transfer Vessel fee/minimum uplift in ShelbyUSD when non-zero` -> `issue 24-hour paid authorization` -> `wallet signs register transaction` -> `wait for Aptos success` -> `write bytes to Shelby` -> `wait for acknowledgement` -> `reconcile artifact`.

The native registration itself charges the wallet's APT gas and ShelbyUSD protocol cost. The UI must show the two expected approvals before the first is requested.

### Recovery states

The browser writes a recovery record before each irreversible transaction. It contains no secret: quote ID, immutable quote context, chain signatures/hashes, paid authorization, current stage, and timestamps.

- Payment failed or was rejected: no paid authorization exists; the user can retry with a fresh quote.
- Payment succeeded but registration did not: re-verify the payment signature and resume registration with the 24-hour paid authorization; do not request payment again.
- Registration succeeded but byte upload did not: verify the Aptos transaction and resume `putBlob` for the exact hash-bound file. If the local file is no longer available, ask the user to reselect it and verify its SHA-256 before resuming.
- Bytes uploaded but acknowledgement/indexer state is pending: poll with bounded backoff and show `Finalizing on Shelby`; do not charge or register again.
- Browser cache was lost: scan the connected storage account through the indexer and reconstruct artifact records. Payment receipts are diagnostic and are not required to list an on-chain blob.

Recovery actions are idempotent. A 24-hour authorization permits only the exact paid operation and cannot be reused for another file, wallet, duration, or renewal.

## Artifact record and reconciliation

The browser ledger becomes a cache, not the source of truth. Each artifact record stores:

- blob name/key, public URL, SHA-256, byte size, MIME type, and encoding ID;
- source wallet, storage account, wallet family, and network;
- creation and authoritative expiration timestamps;
- register transaction hash, write acknowledgement hash, and payment signature when applicable;
- quoted and actual cost breakdowns;
- lifecycle state: `registering`, `uploading`, `finalizing`, `active`, `expiring`, `expired`, or `recovery_required`;
- last reconciliation timestamp.

On wallet restoration and Gallery load, the reconciler queries by the connected Aptos storage account. Chain/indexer expiration, deletion, and written status overwrite stale local values. Local-only presentation fields may remain cached. A different wallet never sees or mutates another wallet's cached artifact actions.

## Renewal design

### Eligibility and duration

Only a written, non-deleted blob whose authoritative expiration is still in the future can be renewed. The user chooses 7, 30, 90, or a custom integer from 1 through 365. The selected days are added to the blob's current expiration, not to the current time. The user therefore never pays again for unexpired time.

If the authoritative expiration has passed, Vessel disables renewal and offers `UPLOAD AGAIN`. The original file must be reselected because Vessel does not promise access to expired bytes.

### Renewal quote

Renewal uses the same live configuration, quote breakdown, five-minute TTL, settlement rules, and five-percent drift threshold as upload. Its storage epochs are calculated only for the interval from current expiration to target expiration. The quote binds the blob name, owner/storage account, current expiration read from chain, added days, and target expiration.

Before submission, the server checks that on-chain expiration still equals the quote's current expiration. If another session already renewed the blob, Vessel discards the quote and recalculates from the new expiration.

### Renewal transaction

- Native Aptos calls the Shelby `increase_expiration_time` path after any Vessel fee settlement.
- Solana DAA uses the sponsored `increase_expiration_time_with_sponsor` path after Devnet USDC verification; the DAA authorizes the operation and the gas station provides the required sponsor/fee-payer signatures.

After success, the reconciler reads the new on-chain expiration before updating Gallery. The success message includes the new UTC expiration and transaction link.

## Expiry experience

Gallery derives warnings from authoritative expiration:

- seven days or less: `EXPIRING SOON` with remaining days;
- three days or less: stronger warning and a prominent `RENEW` action;
- one day or less: critical warning with hours remaining;
- expired: `EXPIRED`, disable renewal, and show `UPLOAD AGAIN`.

Warnings appear when the user opens Vessel; there are no background, email, SMS, or push notifications. The thresholds are inclusive and each artifact shows only its highest-severity current warning.

Removing an artifact from Gallery uses the in-page confirmation from Phase 1 and removes only the browser cache entry. Reconciliation may rediscover an active on-chain blob; a separate local `hidden artifact` preference prevents intentionally removed cards from immediately reappearing. It does not delete or alter the Shelby blob.

## Error handling

- Invalid duration, unsupported file, oversized file, wrong network, missing wallet, or expired quote disables the primary action with a specific inline explanation.
- Pricing/configuration failure disables Upload and Renewal. Vessel does not silently reuse an old or static price.
- Wallet rejection is distinct from provider/API failure and leaves the quote intact when it is still valid.
- A network change invalidates the quote and all unsigned transaction material.
- A wallet change clears active UI state but preserves non-secret recovery records, scoped to their original wallet.
- Insufficient APT, ShelbyUSD, or Devnet USDC shows the exact missing test token and retry action without a faucet link.
- Chain success plus Shelby write failure becomes `recovery_required`, never a fresh charge.
- An indexer outage shows cached data as `Last verified <time>` and disables renewal until authoritative state is available.
- No seed phrase, private key, extension internals, stack trace, server secret, or gas-station credential is logged or returned to the browser.

## Accessibility and responsive behavior

- Retention presets are a labelled single-select group with a visible selected state independent of color.
- The custom input has an associated label, constraints, inline error, and mobile numeric keyboard hint.
- Quote changes are announced through a polite live region; transaction errors use an assertive alert only when user action is required.
- Countdown text does not update more than once per second and never steals focus.
- All wallet approvals originate from explicit buttons. No approval opens during page load or automatic quote refresh.
- Mobile layouts stack the price rows and keep the total and primary action visible without horizontal scrolling.

## Testing strategy

Implementation follows test-driven development.

### Unit tests

- Accept presets and integer custom values 1 and 365; reject all other invalid custom input.
- Calculate chunksets, rounded payment epochs, storage units, two-percent fee, and minimum uplift with `BigInt` fixtures.
- Prove renewal charges only the extension interval.
- Bind signed quotes to file hash, size, wallet, storage account, network, operation, and expiration.
- Reject expired, tampered, cross-wallet, cross-file, and cross-operation quotes.
- Apply the five-percent drift boundary exactly.
- Derive warning states at seven days, three days, one day, zero, and already expired.
- Merge authoritative artifact state without leaking records across wallets.

### Integration tests

- Read Shelby pricing config through mocked Aptos view responses and fail closed on unavailable or malformed values.
- Verify Devnet USDC treasury receipt, source debit, mint, memo, amount, and quote context.
- Verify Aptos ShelbyUSD service payment and quote context for native uploads.
- Resume from payment, registration, write, and acknowledgement recovery checkpoints without duplicate settlement.
- Build both upload and renewal payloads with the installed Shelby SDK/ABI surface.
- Confirm serverless stateless quote and paid-authorization validation across isolated process instances.

### Browser and accessibility tests

- Select each preset and custom duration with keyboard and pointer input.
- Confirm quote loading, expiry, invalidation, material drift confirmation, and error states.
- Complete native Aptos and Solana DAA upload paths with mocked wallets.
- Renew an active artifact, reject renewal of an expired artifact, and render 7/3/1-day warnings.
- Recover after simulated interruption at every irreversible stage.
- Verify responsive layout, focus order, labels, live regions, and no native browser dialogs.

### Testnet release verification

Before production deployment, complete one real 7-day upload with a native Aptos wallet and one real 30-day upload through Solana DAA. Record payment signatures, Aptos transaction hashes, Shelby acknowledgement, authoritative expiration, byte hash equality, quoted cost, and actual event cost. Then renew one live artifact and verify that on-chain expiration increased from its prior expiration by the selected duration.

No test uses mainnet or tokens represented as having real monetary value.

## Observability

Structured events use redacted wallet identifiers and include quote/config version, operation stage, network, duration, size bucket, quoted cost, actual event cost, drift percentage, transaction hash, and normalized error code. File contents, full wallet signatures, private material, and signed authorization tokens are never logged.

Operational alerts cover repeated quote-config failures, drift above five percent, payment verification failures, sponsor failures, and registrations without timely Shelby acknowledgement.

## Rollout and rollback

Phase 2 initially runs behind a server configuration flag. Static pricing remains available only as a code rollback target, never as a silent runtime fallback. After successful real testnet verification, the dynamic path becomes the only enabled quote path and all seven-day hard-coding is removed.

Phase 3 is separately flagged. If renewal is disabled, existing blobs and upload quotes continue to work, but Gallery retains accurate expiration and re-upload guidance.

Rollback must not remove recovery records or make already-paid authorizations unusable during their 24-hour recovery window. Contract transactions are irreversible; application rollback affects only new quoting and UI behavior.

## Acceptance criteria

- A user can choose 7, 30, 90, or an integer 1-365 days and see the exact target expiration before signing.
- The quote is derived from live on-chain Shelby configuration, itemized, valid for five minutes, and bound to the complete operation context.
- The total follows `max($0.01, (network cost + applicable gas accounting cost) * 1.02)` and clearly identifies test tokens. The applicable gas is sponsored for Solana DAA and paid directly for native Aptos.
- Native Aptos and Solana DAA settlement surfaces accurately describe which tokens are debited and who sponsors the Aptos-side costs.
- Payment or registration interruption can be resumed without a second charge for the same operation.
- Gallery expiration comes from chain/indexer data, warns at 7/3/1 days, and never treats local removal as Shelby deletion.
- A live blob can be extended from its existing expiration; an expired blob cannot be renewed.
- Real testnet release evidence proves upload, acknowledgement, payment, byte integrity, expiration, and one renewal.
