# Vessel Retention and On-chain Quote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose 7, 30, 90, or 1-365 custom storage days and complete a wallet-bound upload using a five-minute quote derived from live Shelby configuration.

**Architecture:** Separate pure retention/pricing math from Aptos view readers, signed quote tokens, and chain-specific settlement verification. The browser hashes the selected file before quoting; the server binds the quote and a longer paid authorization to the file, wallet, DAA, network, and expiration. The browser ledger becomes a cache of authoritative chain/indexer values and stores non-secret recovery checkpoints.

**Tech Stack:** Vanilla ES modules, Express, Node.js crypto/test runner, Aptos TS SDK 5.2.1, Shelby SDK 0.3.1, Solana Web3/SPL Token, browser Web Crypto, Vercel serverless.

## Global Constraints

- Retention presets are 7, 30, and 90 days; custom accepts integer values from 1 through 365 inclusive.
- Quote lifetime is five minutes; paid recovery authorization lifetime is 24 hours.
- Total test-token accounting price is `max($0.01, (network cost + applicable gas accounting cost) * 1.02)`.
- Use live Shelby Testnet payment tiers and payment-epoch duration; fail closed when they cannot be read.
- Use `BigInt` for contract/token units and round only at explicit conversion boundaries.
- Quote context includes operation, networks, source wallet, storage account, SHA-256, blob name, bytes, encoding, duration, and expiration.
- Every price surface says `Test tokens — no real monetary value` and includes no faucet link.
- Native Aptos pays APT gas and ShelbyUSD protocol cost directly; Solana DAA pays Devnet USDC and Vessel sponsors Aptos-side costs.
- Keep Aptos/Shelby package versions pinned; do not introduce a database.
- Execute this plan only after the reliability plan passes production acceptance.

---

### Task 1: Pure retention and upload-intent model

**Files:**
- Create: `app/server/public/retention.js`
- Test: `app/server/test/retention.test.js`

**Interfaces:**
- Produces: `normalizeRetentionDays(value): number`, `targetExpirationMicros({ serverTimeMs, days }): number`, and `createUploadIntent({ file, fileHash, blobName, session, days, serverTimeMs, encoding }): object`.
- Consumes: normalized wallet session with `chain`, `sourceAddress`, and `storageAddress`.

- [ ] **Step 1: Write failing boundary and binding tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRetentionDays,
  targetExpirationMicros,
  createUploadIntent,
} from '../public/retention.js';

test('retention accepts only integer days from 1 through 365', () => {
  for (const value of [1, '7', 30, 90, 365]) {
    assert.equal(normalizeRetentionDays(value), Number(value));
  }
  for (const value of ['', 0, -1, 1.5, '1.5', 366, NaN]) {
    assert.throws(() => normalizeRetentionDays(value), /1 and 365/);
  }
});

test('expiration is based on quote server time in microseconds', () => {
  assert.equal(targetExpirationMicros({ serverTimeMs: 1_000, days: 7 }), 604_801_000_000);
});

test('upload intent binds file and wallet identity', () => {
  const intent = createUploadIntent({
    file: { size: 42, type: 'image/png' },
    fileHash: 'ab'.repeat(32),
    blobName: `media/${'ab'.repeat(32)}.png`,
    session: { chain: 'solana', sourceAddress: 'Source111', storageAddress: '0xdaa' },
    days: 30,
    serverTimeMs: 1_000,
    encoding: 0,
  });
  assert.equal(intent.operation, 'upload');
  assert.equal(intent.days, 30);
  assert.equal(intent.sizeBytes, 42);
  assert.equal(intent.fileHash, 'ab'.repeat(32));
  assert.equal(intent.expirationMicros, 2_592_001_000_000);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd app/server && node --test test/retention.test.js`

Expected: FAIL with module-not-found for `public/retention.js`.

- [ ] **Step 3: Implement the pure model**

```js
const DAY_MS = 86_400_000;
const HEX_64 = /^[0-9a-f]{64}$/;

export function normalizeRetentionDays(value) {
  if (value === '') throw new RangeError('Storage duration must be an integer between 1 and 365 days');
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new RangeError('Storage duration must be an integer between 1 and 365 days');
  }
  return days;
}

export function targetExpirationMicros({ serverTimeMs, days }) {
  const normalized = normalizeRetentionDays(days);
  if (!Number.isSafeInteger(serverTimeMs) || serverTimeMs <= 0) throw new TypeError('Invalid quote server time');
  return (serverTimeMs + normalized * DAY_MS) * 1_000;
}

export function createUploadIntent(input) {
  const days = normalizeRetentionDays(input.days);
  const fileHash = String(input.fileHash || '').toLowerCase();
  if (!HEX_64.test(fileHash)) throw new TypeError('Invalid SHA-256 file hash');
  if (!Number.isSafeInteger(input.file?.size) || input.file.size <= 0) throw new TypeError('Invalid file size');
  return Object.freeze({
    operation: 'upload',
    chain: input.session.chain,
    sourceAddress: input.session.sourceAddress,
    storageAddress: input.session.storageAddress,
    fileHash,
    blobName: String(input.blobName),
    sizeBytes: input.file.size,
    contentType: input.file.type || 'application/octet-stream',
    encoding: Number(input.encoding),
    days,
    expirationMicros: targetExpirationMicros({ serverTimeMs: input.serverTimeMs, days }),
  });
}
```

- [ ] **Step 4: Run the test and commit**

Run: `cd app/server && node --test test/retention.test.js`

Expected: 3 tests PASS.

```bash
git add app/server/public/retention.js app/server/test/retention.test.js
git commit -m "feat(retention): model bounded storage duration"
```

### Task 2: Shelby configuration reader and deterministic quote calculator

**Files:**
- Create: `app/server/src/lib/shelby-pricing.js`
- Test: `app/server/test/shelby-pricing.test.js`

**Interfaces:**
- Produces: `createShelbyPricingReader({ aptos, now, cacheMs }): { read(): Promise<PricingConfig> }`.
- Produces: `calculateUploadQuote({ intent, pricing, chunksetCount, gasUnits, gasUnitPriceOctas, aptUsdMicros }): QuoteBreakdown`.
- `PricingConfig` fields: `tierId`, `spUnitsPerChunkEpoch`, `adminUnitsPerChunkEpoch`, `epochDurationMicros`, `serverTimeMicros`, `readAtMs`, `configVersion`.

- [ ] **Step 1: Write failing reader and arithmetic tests**

Use an Aptos fixture whose `view` returns one active tier `{ payment_to_sp_per_chunk_per_epoch: '39', payment_to_admin_per_chunk_per_epoch: '3', active: true }` and epoch duration `'86400000000'`. Assert the reader calls:

```js
`${SHELBY_DEPLOYER}::payment::get_payment_tiers`
`${SHELBY_DEPLOYER}::config::get_payment_epoch_duration`
```

Add this calculator case:

```js
const result = calculateUploadQuote({
  intent: { sizeBytes: 1_127_355, expirationMicros: 605_800_000_000 },
  pricing: {
    tierId: 0,
    spUnitsPerChunkEpoch: 39n,
    adminUnitsPerChunkEpoch: 3n,
    epochDurationMicros: 86_400_000_000n,
    serverTimeMicros: 1_000_000n,
    configVersion: 'cfg-1',
  },
  chunksetCount: 4,
  gasUnits: 7_000n,
  gasUnitPriceOctas: 100n,
  aptUsdMicros: 5_000_000n,
});
assert.equal(result.paymentEpochs, 7);
assert.equal(result.storageShelbyUsdUnits, '1176');
assert.equal(result.totalAccountingMicro >= 10_000, true);
assert.equal(
  BigInt(result.serviceFeeAccountingMicro),
  BigInt(result.totalAccountingMicro) - BigInt(result.subtotalAccountingMicro),
);
```

Also test: no active tier, malformed numeric fields, and view failure all reject with `code === 'pricing_unavailable'`; two reads inside 30 seconds call each view once.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd app/server && node --test test/shelby-pricing.test.js`

Expected: FAIL because the pricing module does not exist.

- [ ] **Step 3: Implement live view reads with a 30-second success cache**

```js
import crypto from 'node:crypto';
import { SHELBY_DEPLOYER } from '@shelby-protocol/sdk/node';

const pricingError = (message) => Object.assign(new Error(message), {
  code: 'pricing_unavailable', status: 503, retriable: true,
});

const asBigInt = (value, field) => {
  try {
    const result = BigInt(value);
    if (result < 0n) throw new Error();
    return result;
  } catch {
    throw pricingError(`Invalid Shelby pricing field: ${field}`);
  }
};

export function createShelbyPricingReader({ aptos, now = Date.now, cacheMs = 30_000 }) {
  let cached;
  return {
    async read() {
      const current = now();
      if (cached && current - cached.readAtMs < cacheMs) return cached;
      try {
        const [tierResult, epochResult] = await Promise.all([
          aptos.view({ payload: { function: `${SHELBY_DEPLOYER}::payment::get_payment_tiers`, functionArguments: [] } }),
          aptos.view({ payload: { function: `${SHELBY_DEPLOYER}::config::get_payment_epoch_duration`, functionArguments: [] } }),
        ]);
        const tiers = tierResult[0];
        const tierId = tiers.findIndex((tier) => tier.active === true);
        if (tierId < 0) throw pricingError('Shelby has no active payment tier');
        const tier = tiers[tierId];
        const canonical = JSON.stringify({ tierId, tier, epoch: epochResult[0] });
        cached = Object.freeze({
          tierId,
          spUnitsPerChunkEpoch: asBigInt(tier.payment_to_sp_per_chunk_per_epoch, 'sp fee'),
          adminUnitsPerChunkEpoch: asBigInt(tier.payment_to_admin_per_chunk_per_epoch, 'admin fee'),
          epochDurationMicros: asBigInt(epochResult[0], 'epoch duration'),
          serverTimeMicros: BigInt(current) * 1_000n,
          readAtMs: current,
          configVersion: crypto.createHash('sha256').update(canonical).digest('hex'),
        });
        return cached;
      } catch (error) {
        if (error?.code === 'pricing_unavailable') throw error;
        throw pricingError('Live Shelby pricing is unavailable');
      }
    },
  };
}
```

- [ ] **Step 4: Implement integer quote arithmetic**

Use helpers `ceilDiv(n, d)`, `shelbyUnitsToAccountingMicros(units) = ceilDiv(units, 100n)` for 8-decimal ShelbyUSD to 6-decimal accounting units, and `gasOctasToAccountingMicros = ceilDiv(gasOctas * aptUsdMicros, 100_000_000n)`. Apply:

```js
const storageUnits = BigInt(chunksetCount)
  * BigInt(paymentEpochs)
  * (pricing.spUnitsPerChunkEpoch + pricing.adminUnitsPerChunkEpoch);
const gasOctas = gasUnits * gasUnitPriceOctas;
const subtotalMicro = storageMicro + gasMicro;
const markedUpMicro = ceilDiv(subtotalMicro * 102n, 100n);
const totalMicro = markedUpMicro < 10_000n ? 10_000n : markedUpMicro;
const serviceFeeMicro = totalMicro - subtotalMicro;
```

Return JSON-safe decimal strings for every `BigInt`, plus `paymentEpochs`, `tierId`, and `configVersion`.

- [ ] **Step 5: Run tests and commit**

Run: `cd app/server && node --test test/shelby-pricing.test.js`

Expected: all pricing tests PASS.

```bash
git add app/server/src/lib/shelby-pricing.js app/server/test/shelby-pricing.test.js
git commit -m "feat(pricing): derive storage quote from Shelby config"
```

### Task 3: Five-minute signed upload quotes

**Files:**
- Create: `app/server/src/lib/quotes.js`
- Modify: `app/server/src/config.js`
- Modify: `app/server/src/index.js`
- Test: `app/server/test/quotes.test.js`
- Modify: `app/server/test/config.test.js`
- Modify: `app/server/test/payment-routes.test.js`

**Interfaces:**
- Produces: `normalizeUploadQuoteContext(input): UploadQuoteContext`.
- Produces: `QuoteManager.issueUpload(input): Promise<PublicQuote>` and `QuoteManager.validate(token, expectedContext, { allowExpired }): SignedQuote`.
- Adds `POST /api/quotes/upload` and `POST /api/quotes/validate`.

- [ ] **Step 1: Write failing quote-token tests**

Create a fixed-clock `QuoteManager.forTest` with a pricing callback. Assert:

```js
const quote = await manager.issueUpload(context);
assert.equal(quote.expiresAtMs, now + 5 * 60_000);
assert.equal(quote.notice, 'Test tokens — no real monetary value');
assert.equal(manager.validate(quote.quoteToken, context).quoteId, quote.quoteId);

for (const change of [
  { fileHash: 'cd'.repeat(32) },
  { sizeBytes: 43 },
  { sourceAddress: 'Other111' },
  { storageAddress: '0xother' },
  { expirationMicros: context.expirationMicros + 1 },
  { days: 31 },
  { chain: 'aptos' },
]) {
  assert.throws(() => manager.validate(quote.quoteToken, { ...context, ...change }), /context/i);
}
```

Advance the clock past five minutes and assert `quote_expired`. Tamper with one payload byte and assert `invalid_quote`. Test that missing/weak `PAY_SECRET` prevents quote routes from becoming ready when `NODE_ENV === 'production'`.

- [ ] **Step 2: Run quote tests and verify RED**

Run: `cd app/server && node --test test/quotes.test.js test/config.test.js test/payment-routes.test.js`

Expected: FAIL because the quote manager and routes do not exist.

- [ ] **Step 3: Implement stateless HMAC quotes**

Use the token format `vquote.<base64url-json>.<base64url-hmac>`. The payload contains short stable keys for all context fields, the complete breakdown, `iat`, `exp`, `quoteId`, and `operation: 'upload'`. Compute `quoteId` as the first 24 hex characters of SHA-256 over the canonical context plus issue time. Validate HMAC with `crypto.timingSafeEqual` before parsing fields into the normalized context.

The public quote must expose itemized decimal strings, actual settlement token, server time, target UTC expiration, five-minute expiry, config version, and the required test-token notice. It must not expose the HMAC secret.

- [ ] **Step 4: Configure and mount quote routes**

Add exact configuration keys:

```js
dynamicQuotesEnabled: process.env.DYNAMIC_QUOTES_ENABLED === 'true',
paySecret: process.env.PAY_SECRET || '',
aptUsdReferenceMicros: BigInt(process.env.APT_USD_REFERENCE_MICROS || '5000000'),
registerGasUnitsEstimate: BigInt(process.env.REGISTER_GAS_UNITS_ESTIMATE || '7000'),
gasSafetyBps: BigInt(process.env.GAS_SAFETY_BPS || '12000'),
aptosTreasuryAddress: process.env.APTOS_TREASURY_ADDRESS || '',
```

Initialize an Aptos Testnet client, pricing reader, and QuoteManager once per serverless process. `POST /api/quotes/upload` must validate the file-size limit, read live gas price using `aptos.getGasPriceEstimation()`, apply the configured safety margin, calculate the SDK chunkset count, and return 503 when dynamic quotes are disabled or live pricing fails.

`POST /api/quotes/validate` reissues a fresh quote for the same normalized context and returns `driftPercentBps`; it sets `requiresConfirmation: true` when absolute drift is greater than 500 basis points.

- [ ] **Step 5: Run route tests and commit**

Run: `cd app/server && node --test test/quotes.test.js test/config.test.js test/payment-routes.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/src/lib/quotes.js app/server/src/config.js app/server/src/index.js app/server/test/quotes.test.js app/server/test/config.test.js app/server/test/payment-routes.test.js
git commit -m "feat(quotes): issue wallet-bound dynamic upload quotes"
```

### Task 4: Quote-bound Solana and native Aptos settlement

**Files:**
- Create: `app/server/src/lib/paid-authorizations.js`
- Create: `app/server/src/lib/aptos-settlement.js`
- Modify: `app/server/src/lib/payments.js`
- Modify: `app/server/src/index.js`
- Modify: `app/server/test/payments.test.js`
- Create: `app/server/test/aptos-settlement.test.js`
- Create: `app/server/test/paid-authorizations.test.js`

**Interfaces:**
- Produces: `PaidAuthorizationManager.issue({ quote, settlementChain, settlementHash }): string` and `.validate(token, expectedQuote): object`.
- Produces: `verifyAptosShelbyUsdTransfer({ transactionHash, quote, aptos, treasury, assetAddress }): Promise<Result>`.
- Changes Solana verification to consume `{ quoteToken, signature }` and require memo `quote.quoteId`.

- [ ] **Step 1: Write failing paid-authorization and settlement tests**

Test that a paid authorization remains valid for exactly 24 hours even after its five-minute quote has expired, but fails for a different quote ID, settlement hash, file, or wallet. Test that production refuses a blank secret.

For Aptos, use a parsed successful transaction fixture with sender equal to `quote.sourceAddress`, a fungible-asset withdrawal from ShelbyUSD, deposit to the configured treasury, and amount at least `quote.nativeServiceFeeShelbyUsdUnits`. Assert rejection for wrong sender, asset, treasury, amount, failed VM status, and transaction hash mismatch.

Update Solana tests so the transfer memo is the short `quoteId`; assert treasury receipt, bound source debit, Devnet USDC mint, and exact-or-greater amount.

- [ ] **Step 2: Run settlement tests and verify RED**

Run: `cd app/server && node --test test/payments.test.js test/aptos-settlement.test.js test/paid-authorizations.test.js`

Expected: FAIL because settlement still creates static payment intents and no paid authorization exists.

- [ ] **Step 3: Implement 24-hour signed paid authorization**

Use `vpaid.<payload>.<hmac>`. Payload fields are `quoteId`, SHA-256 of the full quote token, settlement chain/hash, immutable quote context digest, `iat`, and `exp = iat + 86_400_000`. Validation must not require the original quote to remain within five minutes, but it must validate the original quote signature with `allowExpired: true` and match all immutable fields.

- [ ] **Step 4: Refactor settlement verification**

Remove `priceBaseUsdc`, `pricePerMbUsdc`, `priceMicro`, and `createIntent` from `PaymentManager`. Add:

```js
async verifyQuotePayment({ quote, signature }) {
  // Existing parsed-transaction checks remain.
  // required = BigInt(quote.solanaAmountMicro)
  // expected memo = quote.quoteId
  // source owner = quote.sourceAddress
  // mint/network/treasury are server configuration.
}
```

Implement Aptos verification from transaction events/changes rather than trusting browser-supplied amounts. The expected transfer payload for the wallet is:

```js
{
  function: '0x1::primary_fungible_store::transfer',
  functionArguments: [SHELBYUSD_FA_METADATA_ADDRESS, aptosTreasuryAddress, serviceFeeUnits],
}
```

If service fee is zero, the server issues a paid authorization with settlement hash `no-service-fee:<quoteId>` without asking for a transfer.

- [ ] **Step 5: Replace payment routes and commit**

Expose:

```text
POST /api/pay/solana/verify  { quoteToken, signature }
POST /api/pay/aptos/verify   { quoteToken, transactionHash }
```

Each route validates the quote, verifies chain evidence, then returns `{ ok: true, paidAuthorization }`. Remove `/api/pay/quote`; do not retain the static tariff as a runtime fallback.

Run: `cd app/server && node --test test/payments.test.js test/aptos-settlement.test.js test/paid-authorizations.test.js test/payment-routes.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/src/lib/paid-authorizations.js app/server/src/lib/aptos-settlement.js app/server/src/lib/payments.js app/server/src/index.js app/server/test/payments.test.js app/server/test/aptos-settlement.test.js app/server/test/paid-authorizations.test.js app/server/test/payment-routes.test.js
git commit -m "feat(payment): bind settlement to signed quotes"
```

### Task 5: Retention selector and transparent quote panel

**Files:**
- Create: `app/server/public/quote-ui.js`
- Modify: `app/server/public/upload.html`
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/vessel.css`
- Modify: `app/server/test/upload.test.js`
- Create: `app/server/test/quote-ui.test.js`

**Interfaces:**
- Produces: `mountQuoteUi({ root, onRetentionChange }): { render(state), days(), reset() }`.
- Consumes: `/api/quotes/upload`, normalized wallet session, SHA-256 file hash, content-addressed blob name.

- [ ] **Step 1: Write failing HTML/UI contract tests**

Require these IDs in `upload.html`:

```js
for (const id of [
  'retention-options', 'retention-7', 'retention-30', 'retention-90',
  'retention-custom', 'custom-days', 'custom-days-error', 'quote-panel',
  'quote-status', 'quote-storage-cost', 'quote-gas-cost', 'quote-service-fee',
  'quote-total', 'quote-expiration', 'quote-countdown', 'quote-confirm',
]) assert.equal(ids.has(id), true, id);
```

Assert the page contains `Test tokens — no real monetary value`, `min="1"`, `max="365"`, `step="1"`, a labelled radiogroup, a polite quote live region, and no `faucet` text.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `cd app/server && node --test test/upload.test.js test/quote-ui.test.js test/accessibility.test.js`

Expected: FAIL because retention and quote UI do not exist.

- [ ] **Step 3: Add semantic retention and quote markup**

Add the retention selector after file selection details and before payment. Presets are radio inputs with values `7`, `30`, `90`; Custom reveals `#custom-days`. The quote panel contains an itemized `<dl>`, UTC expiration `<time>`, token/network line, test-token notice, and disabled primary button until `state.kind === 'ready'`.

- [ ] **Step 4: Implement quote UI state rendering**

`quote-ui.js` must support:

```js
render({ kind: 'loading' });
render({ kind: 'ready', quote });
render({ kind: 'expired', message: 'Quote expired — refresh to continue' });
render({ kind: 'unavailable', message });
```

It validates custom input with `normalizeRetentionDays`, announces quote changes in `#quote-status`, renders separate storage/gas/Vessel rows, labels minimum uplift when applicable, displays actual tokens by wallet family, and updates countdown no more than once per second. It never opens a wallet approval automatically.

- [ ] **Step 5: Wire file hashing, invalidation, and drift confirmation**

In `app.js`, selection computes SHA-256 with Web Crypto and creates the same content-addressed blob name used by upload. Store the immutable `{ file, intent, quote }` in `activeUploadContext`. On file, retention, wallet, storage address, or network change: abort the request, clear the quote, and disable the primary action.

Before the first approval, call `/api/quotes/validate`. Replace the quote when drift is at most 500 bps. When it is greater, render the fresh quote and require another click; do not proceed in the same event handler.

- [ ] **Step 6: Run focused UI tests and commit**

Run: `cd app/server && node --test test/upload.test.js test/quote-ui.test.js test/accessibility.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/public/quote-ui.js app/server/public/upload.html app/server/public/app.js app/server/public/vessel.css app/server/test/upload.test.js app/server/test/quote-ui.test.js
git commit -m "feat(upload): add retention and quote experience"
```

### Task 6: Settle and upload with the exact quoted expiration

**Files:**
- Create: `app/server/public/settlement-client.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/client-src/wallets/aptos-upload.js`
- Create: `app/server/client-src/wallets/transaction-evidence.js`
- Modify: `app/server/client-src/vessel-solana.js`
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/src/index.js`
- Modify: `app/server/test/aptos-upload.test.js`
- Create: `app/server/test/transaction-evidence.test.js`
- Modify: `app/server/test/solana-daa-client.test.js`
- Modify: `app/server/test/sponsor.test.js`
- Modify: `app/server/test/upload-router.test.js`

**Interfaces:**
- Produces: `settleQuote({ quote, session, aptosAdapter, solanaClient }): Promise<{ paidAuthorization, settlementHash }>`.
- Upload clients consume `{ quoteToken, paidAuthorization, expirationMicros, expectedFileHash, onCheckpoint }`.
- Sponsor route validates the paid authorization instead of the legacy `uploadToken`.
- Produces: `extractShelbyTransactionEvidence(transaction): { actualStorageUnits, gasUsed, transactionHash }`.

- [ ] **Step 1: Write failing exact-expiration and authorization tests**

Update native upload tests to pass `expirationMicros: 2_592_001_000_000` and assert the register payload uses that exact value, never `now + 7 days`. Assert a mismatched recomputed SHA-256 throws `file_changed` before signing.

Update Solana tests so sponsor submission includes `quoteToken` and `paidAuthorization`; assert changed file size, hash, wallet, DAA, or expiration is rejected. Add source scans proving no `7 * 24 * 3600` remains in upload code.

Add a transaction fixture containing `BlobRegisteredEvent.payment_amount`, transaction `gas_used`, hash, and success status. Assert `extractShelbyTransactionEvidence` returns decimal strings and rejects a failed transaction or a transaction without the expected Shelby event.

- [ ] **Step 2: Run upload tests and verify RED**

Run: `cd app/server && node --test test/aptos-upload.test.js test/transaction-evidence.test.js test/solana-daa-client.test.js test/sponsor.test.js test/upload-router.test.js`

Expected: FAIL because upload clients still generate seven-day expiration and use legacy payment tokens.

- [ ] **Step 3: Implement settlement client**

For Solana, transfer `quote.solanaAmountMicro` with memo `quote.quoteId`, then call `/api/pay/solana/verify`. For native Aptos, when `quote.nativeServiceFeeShelbyUsdUnits !== '0'`, sign the primary fungible-store transfer and call `/api/pay/aptos/verify`; otherwise call the same endpoint with `transactionHash: ''` and let the server issue the zero-fee authorization.

Return only after a paid authorization exists. Surface user rejection separately from chain verification failure.

- [ ] **Step 4: Bind upload clients to quote context**

Replace `expiresInSec` in `uploadNativeAptos` with required `expirationMicros`, `expectedFileHash`, and `paidAuthorization`. Recompute the file hash before signing and compare it in constant-time byte form. Use the quote's tier ID in the SDK payload by setting the payment-tier argument at `functionArguments[5]` after verifying the SDK payload shape has seven arguments.

In `vessel-solana.js`, use quote expiration/tier/hash and send the signed quote plus paid authorization to `/api/sponsor/submit`. On the server, validate the authorization and exact context before gas-station submission.

Capture the completed Aptos transaction response in both paths and parse the exact Shelby registration event plus `gas_used`. Return `actualStorageUnits`, `actualGasUsed`, and transaction hash to the ledger. A missing expected event leaves the operation in `finalizing` and triggers reconciliation; it must not fabricate zero cost.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd app/server && node --test test/aptos-upload.test.js test/transaction-evidence.test.js test/solana-daa-client.test.js test/sponsor.test.js test/upload-router.test.js test/payment-routes.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/public/settlement-client.js app/server/public/app.js app/server/client-src/wallets/aptos-upload.js app/server/client-src/wallets/transaction-evidence.js app/server/client-src/vessel-solana.js app/server/client-src/vessel-wallets.js app/server/src/index.js app/server/test/aptos-upload.test.js app/server/test/transaction-evidence.test.js app/server/test/solana-daa-client.test.js app/server/test/sponsor.test.js app/server/test/upload-router.test.js app/server/test/payment-routes.test.js
git commit -m "feat(upload): settle and register quoted retention"
```

### Task 7: Recovery checkpoints and authoritative artifact cache

**Files:**
- Create: `app/server/public/recovery-ledger.js`
- Modify: `app/server/public/ledger.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/client-src/vessel-wallets.js`
- Create: `app/server/client-src/wallets/artifact-reconciler.js`
- Create: `app/server/test/recovery-ledger.test.js`
- Modify: `app/server/test/ledger-and-gallery.test.js`
- Create: `app/server/test/artifact-reconciler.test.js`

**Interfaces:**
- Produces: recovery ledger `save(checkpoint)`, `loadForWallet(identity)`, `advance(id, stage, evidence)`, `complete(id)`.
- Produces: `reconcileArtifacts(local, remote, walletIdentity): ArtifactRecord[]`.
- Exposes `window.VesselWallets.listArtifacts()` backed by `ShelbyBlobClient.getAccountBlobs({ account })`.

- [ ] **Step 1: Write failing recovery and reconciliation tests**

Use memory storage to assert stages `quoted`, `paid`, `registered`, `uploading`, `finalizing`, `active`, and `recovery_required`; records must store quote ID, immutable context, transaction hashes, paid authorization, and timestamps but never file bytes, seed phrases, or private keys.

Test reconciliation rules:

```js
const merged = reconcileArtifacts(local, remote, identity);
assert.equal(merged[0].expiresAt, Number(remote[0].expirationMicros / 1_000));
assert.equal(merged[0].state, remote[0].isWritten ? 'active' : 'finalizing');
assert.equal(merged.some((item) => item.storageAddress !== identity.storageAddress), false);
```

Assert `commitUpload` uses returned authoritative `expirationMicros` and transaction hashes rather than adding seven days locally.

- [ ] **Step 2: Run ledger tests and verify RED**

Run: `cd app/server && node --test test/recovery-ledger.test.js test/ledger-and-gallery.test.js test/artifact-reconciler.test.js`

Expected: FAIL because recovery and reconciliation modules do not exist and ledger still adds seven days.

- [ ] **Step 3: Implement recovery ledger and checkpoint hooks**

Use localStorage key `vessel_recovery_v1`; cap to 30 records; normalize wallet identity as `chain:sourceAddress:storageAddress`. `advance` merges only an allowlist of non-secret evidence fields. Upload code calls `onCheckpoint` before and after every irreversible operation. A paid record remains resumable for 24 hours; stale unpaid records may be discarded.

- [ ] **Step 4: Implement chain-authoritative artifact reconciliation**

Create a browser Shelby client on Testnet and map `getAccountBlobs` output into the artifact schema from the design: name, owner, size, encoding, creation, expiration, written/deleted flags, and lifecycle state. Merge remote ownership/expiration/status over local display fields. Scope every read and action to the active storage address.

`commitUpload` stores returned `expirationMicros`, `registerTransactionHash`, `acknowledgementHash`, `paymentSignature`, quoted/actual costs, and `lastReconciledAt`; remove the local seven-day calculation.

- [ ] **Step 5: Add resume rules**

On Upload initialization, show one recovery panel per active wallet:

- `paid`: verify settlement again and rebuild the exact registration.
- `registered`: ask the user to reselect the file; SHA-256 must match before `putBlob`.
- `uploading` or `finalizing`: query the blob and acknowledgement before attempting another write.

All resume actions are explicit buttons. No wallet popup opens on page load.

- [ ] **Step 6: Run focused tests and commit**

Run: `cd app/server && node --test test/recovery-ledger.test.js test/ledger-and-gallery.test.js test/artifact-reconciler.test.js test/upload.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/public/recovery-ledger.js app/server/public/ledger.js app/server/public/app.js app/server/client-src/vessel-wallets.js app/server/client-src/wallets/artifact-reconciler.js app/server/test/recovery-ledger.test.js app/server/test/ledger-and-gallery.test.js app/server/test/artifact-reconciler.test.js app/server/test/upload.test.js
git commit -m "feat(recovery): reconcile wallet-owned upload state"
```

### Task 8: Structured redacted operation telemetry

**Files:**
- Create: `app/server/src/lib/telemetry.js`
- Modify: `app/server/src/index.js`
- Create: `app/server/test/telemetry.test.js`

**Interfaces:**
- Produces: `createTelemetry({ write, walletSalt }): { operation(event) }`.
- Consumes: normalized operation events from quote, settlement, sponsor, registration, and reconciliation routes.

- [ ] **Step 1: Write failing redaction and schema tests**

```js
test('operation telemetry redacts wallets and drops authorization material', () => {
  const rows = [];
  const telemetry = createTelemetry({ write: (row) => rows.push(row), walletSalt: 'test-salt' });
  telemetry.operation({
    stage: 'paid', operation: 'upload', network: 'testnet',
    wallet: 'SourceWallet111', storageAddress: '0xdaa', quoteId: 'quote-1',
    configVersion: 'cfg-1', durationDays: 30, sizeBytes: 1_127_355,
    quotedMicro: '20751', actualStorageUnits: '106848', driftBps: 30,
    transactionHash: '0xtxn', paidAuthorization: 'vpaid.secret',
  });
  assert.equal(JSON.stringify(rows).includes('SourceWallet111'), false);
  assert.equal(JSON.stringify(rows).includes('vpaid.secret'), false);
  assert.equal(rows[0].walletRef.length, 12);
  assert.equal(rows[0].sizeBucket, '1-5mb');
});
```

Also assert normalized error codes `pricing_unavailable`, `quote_drift`, `payment_verification_failed`, `sponsor_failed`, and `acknowledgement_timeout` are written with severity `error` and no stack trace.

- [ ] **Step 2: Run telemetry tests and verify RED**

Run: `cd app/server && node --test test/telemetry.test.js`

Expected: FAIL because telemetry module does not exist.

- [ ] **Step 3: Implement allowlisted structured events**

Hash lowercased wallet/storage identifiers with SHA-256 plus `walletSalt`, keep the first 12 hex characters, bucket file size, and serialize only: timestamp, stage, operation, network, duration, size bucket, quote/config IDs, quoted/actual cost, drift, transaction hash, normalized error code, and severity. `operation()` writes one JSON object through the injected writer; production uses `console.log(JSON.stringify(row))` for info and `console.error` for operator-visible errors.

- [ ] **Step 4: Instrument boundaries and commit**

Call telemetry only after normalized quote, settlement, sponsor, registration, and acknowledgement results exist. Never pass file bytes, signatures, quote tokens, paid authorizations, extension objects, or request bodies.

Run: `cd app/server && node --test test/telemetry.test.js test/payment-routes.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/src/lib/telemetry.js app/server/src/index.js app/server/test/telemetry.test.js
git commit -m "feat(observability): log redacted storage operations"
```

### Task 9: Full verification and real testnet release checkpoint

**Files:**
- Generated: `app/server/public/vessel-wallets.js`
- Generated: `app/server/public/vessel-solana.js`

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces: verified browser bundles and recorded release evidence in the task handoff.

- [ ] **Step 1: Build and run the entire automated suite**

Run: `cd app/server && npm run check`

Expected: all Node tests PASS and both browser bundles build successfully.

- [ ] **Step 2: Prove hard-coded/static pricing is gone**

Run:

```bash
rg -n "7 \* 24 \* 3600|priceBaseUsdc|pricePerMbUsdc|PRICE_BASE_USDC|PRICE_PER_MB_USDC|/api/pay/quote" app/server --glob '!node_modules/**' --glob '!public/vessel-*.js'
```

Expected: no matches in runtime source or tests except migration-history documentation.

- [ ] **Step 3: Inspect diff and secrets**

Run: `git diff --check && git status --short && git diff --stat`

Expected: only scoped source/test/bundle/environment-example changes; no secret values, local recovery data, or wallet material.

- [ ] **Step 4: Verify a real native Aptos 7-day upload**

With `DYNAMIC_QUOTES_ENABLED=true`, select a non-sensitive test asset, choose 7 days, record the itemized quote, approve any ShelbyUSD Vessel fee, approve Aptos registration, and verify:

- successful Aptos transaction and Shelby acknowledgement;
- indexer expiration corresponds to seven days from quote server time within contract epoch rounding;
- remote SHA-256 equals local SHA-256;
- Gallery expiration matches indexer data;
- quoted and actual event costs are recorded.

- [ ] **Step 5: Verify a real Solana DAA 30-day upload**

Choose 30 days and verify Devnet USDC treasury receipt/memo/source debit, Aptos sponsored registration, Shelby acknowledgement, byte equality, authoritative expiration, and no duplicate debit after one simulated resume.

- [ ] **Step 6: Commit generated bundles**

```bash
git add app/server/public/vessel-wallets.js app/server/public/vessel-solana.js
git commit -m "build: release dynamic retention quotes"
```

Do not enable production deployment until both real testnet cases pass and quote drift is at most five percent. Configure the exact environment keys from Task 3 directly in Vercel; do not modify the ignored local `.env.example` file.
