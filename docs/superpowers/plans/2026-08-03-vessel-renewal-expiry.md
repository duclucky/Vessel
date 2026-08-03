# Vessel Renewal and Expiry Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users extend an active wallet-owned Shelby blob from its current expiration and provide authoritative 7/3/1-day Gallery warnings plus safe re-upload guidance after expiry.

**Architecture:** Extend the quote/settlement infrastructure with a renewal operation bound to current on-chain metadata. Add one pure expiry-state model, one payload builder for native and sponsored Shelby renewal entry functions, and a Gallery renewal dialog. Reconciliation remains authoritative and recovery checkpoints make renewal idempotent.

**Tech Stack:** Vanilla ES modules, Express, Aptos TS SDK 5.2.1, Shelby SDK 0.3.1/indexer, existing Solana DAA sponsor flow, Node.js built-in test runner.

## Global Constraints

- Execute this plan only after the retention/on-chain quote plan passes its real 7-day and 30-day testnet checkpoint.
- Renewal accepts 7, 30, 90, or integer custom days 1-365.
- Added days start at the current authoritative expiration, never at the current time.
- Written, non-deleted blobs with expiration strictly greater than server time are eligible.
- Expired blobs cannot be renewed and must show `UPLOAD AGAIN`.
- Renewal quote lifetime, drift rule, pricing source, settlement rules, and test-token notice match upload quotes.
- Native uses `increase_expiration_time`; sponsored DAA uses `increase_expiration_time_with_sponsor`.
- In-app warnings are inclusive at 7 days, 3 days, and 1 day; no email, SMS, push, faucet link, or automatic wallet approval.
- Removing a Gallery card hides it locally and never deletes or alters the Shelby blob.

---

### Task 1: Pure expiry state and renewal intent

**Files:**
- Create: `app/server/public/expiry.js`
- Test: `app/server/test/expiry.test.js`

**Interfaces:**
- Produces: `expiryState({ expiresAtMs, nowMs }): { level, label, remainingMs, renewable }`.
- Produces: `createRenewalIntent({ artifact, session, days, serverTimeMs }): RenewalIntent`.

- [ ] **Step 1: Write failing threshold and extension tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryState, createRenewalIntent } from '../public/expiry.js';

const day = 86_400_000;

test('expiry warnings use inclusive 7, 3, and 1 day thresholds', () => {
  assert.equal(expiryState({ expiresAtMs: 8 * day, nowMs: 0 }).level, 'active');
  assert.equal(expiryState({ expiresAtMs: 7 * day, nowMs: 0 }).level, 'soon');
  assert.equal(expiryState({ expiresAtMs: 3 * day, nowMs: 0 }).level, 'warning');
  assert.equal(expiryState({ expiresAtMs: day, nowMs: 0 }).level, 'critical');
  assert.equal(expiryState({ expiresAtMs: 0, nowMs: 0 }).level, 'expired');
});

test('renewal adds days to the current expiration', () => {
  const intent = createRenewalIntent({
    artifact: {
      key: 'media/a.png', storageAddress: '0xabc', expiresAt: 10 * day,
      chunksetCount: 4, encoding: 0, isWritten: true, isDeleted: false,
    },
    session: { chain: 'aptos', sourceAddress: '0xabc', storageAddress: '0xabc' },
    days: 30,
    serverTimeMs: day,
  });
  assert.equal(intent.operation, 'renewal');
  assert.equal(intent.currentExpirationMicros, 10 * day * 1_000);
  assert.equal(intent.targetExpirationMicros, 40 * day * 1_000);
});

test('expired, unwritten, deleted, or cross-wallet artifacts cannot renew', () => {
  const base = {
    key: 'media/a.png', storageAddress: '0xabc', expiresAt: 10 * day,
    chunksetCount: 4, encoding: 0, isWritten: true, isDeleted: false,
  };
  const session = { chain: 'aptos', sourceAddress: '0xabc', storageAddress: '0xabc' };
  for (const [change, code] of [
    [{ expiresAt: day }, 'expired_blob'],
    [{ isWritten: false }, 'blob_not_written'],
    [{ isDeleted: true }, 'blob_deleted'],
    [{ storageAddress: '0xother' }, 'wallet_mismatch'],
  ]) {
    assert.throws(
      () => createRenewalIntent({ artifact: { ...base, ...change }, session, days: 7, serverTimeMs: day }),
      (error) => error.code === code,
    );
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd app/server && node --test test/expiry.test.js`

Expected: FAIL because `public/expiry.js` does not exist.

- [ ] **Step 3: Implement deterministic expiry and intent creation**

```js
import { normalizeRetentionDays } from './retention.js';

const DAY_MS = 86_400_000;
const renewalError = (message, code) => Object.assign(new Error(message), { code });

export function expiryState({ expiresAtMs, nowMs = Date.now() }) {
  const remainingMs = Number(expiresAtMs) - Number(nowMs);
  if (remainingMs <= 0) return { level: 'expired', label: 'EXPIRED', remainingMs: 0, renewable: false };
  if (remainingMs <= DAY_MS) return { level: 'critical', label: `${Math.max(1, Math.ceil(remainingMs / 3_600_000))}H LEFT`, remainingMs, renewable: true };
  if (remainingMs <= 3 * DAY_MS) return { level: 'warning', label: `${Math.ceil(remainingMs / DAY_MS)}D LEFT`, remainingMs, renewable: true };
  if (remainingMs <= 7 * DAY_MS) return { level: 'soon', label: `${Math.ceil(remainingMs / DAY_MS)}D LEFT`, remainingMs, renewable: true };
  return { level: 'active', label: `${Math.ceil(remainingMs / DAY_MS)}D LEFT`, remainingMs, renewable: true };
}
```

`createRenewalIntent` validates wallet/storage ownership, written/deleted status, and strict future expiration against `serverTimeMs`. It returns current and target expiration in safe integer microseconds, `chunksetCount`, `encoding`, blob key, wallet fields, and normalized days.

- [ ] **Step 4: Run tests and commit**

Run: `cd app/server && node --test test/expiry.test.js test/retention.test.js`

Expected: all expiry/retention tests PASS.

```bash
git add app/server/public/expiry.js app/server/test/expiry.test.js
git commit -m "feat(expiry): model renewal eligibility and warnings"
```

### Task 2: Renewal quote from authoritative blob metadata

**Files:**
- Modify: `app/server/src/lib/shelby-pricing.js`
- Modify: `app/server/src/lib/quotes.js`
- Modify: `app/server/src/index.js`
- Create: `app/server/test/renewal-quotes.test.js`
- Modify: `app/server/test/payment-routes.test.js`

**Interfaces:**
- Produces: `calculateRenewalQuote({ intent, pricing, gasUnits, gasUnitPriceOctas, aptUsdMicros })`.
- Adds `QuoteManager.issueRenewal(input, authoritativeBlob)`.
- Adds `POST /api/quotes/renewal` and supports renewal in `/api/quotes/validate`.

- [ ] **Step 1: Write failing incremental-cost and stale-state tests**

```js
test('renewal charges only epochs between current and target expiration', () => {
  const quote = calculateRenewalQuote({
    intent: {
      currentExpirationMicros: 10n * DAY_MICROS,
      targetExpirationMicros: 40n * DAY_MICROS,
      chunksetCount: 4,
    },
    pricing,
    gasUnits: 4_000n,
    gasUnitPriceOctas: 100n,
    aptUsdMicros: 5_000_000n,
  });
  assert.equal(quote.paymentEpochs, 30);
  assert.equal(quote.storageShelbyUsdUnits, String(4n * 30n * 42n));
});
```

Mock `ShelbyBlobClient.getBlobMetadata({ account, name })` and assert the route rejects: missing blob, owner mismatch, not written, deleted, expired, and client current expiration different from indexer. Assert a valid quote binds the exact authoritative current expiration and target expiration.

- [ ] **Step 2: Run renewal quote tests and verify RED**

Run: `cd app/server && node --test test/renewal-quotes.test.js test/payment-routes.test.js`

Expected: FAIL because quote manager supports upload only.

- [ ] **Step 3: Implement incremental pricing**

Reuse the upload calculator's conversion/fee helpers. Calculate:

```js
const extensionMicros = targetExpirationMicros - currentExpirationMicros;
const paymentEpochs = Number(ceilDiv(extensionMicros, pricing.epochDurationMicros));
const storageUnits = BigInt(chunksetCount)
  * BigInt(paymentEpochs)
  * (pricing.spUnitsPerChunkEpoch + pricing.adminUnitsPerChunkEpoch);
```

Reject non-positive extension and unsafe epoch counts. Apply the same gas, 2%, minimum, itemization, config version, and token settlement rules as upload.

- [ ] **Step 4: Add authoritative renewal route**

`POST /api/quotes/renewal` accepts wallet/storage address, blob name, client-observed current expiration, and days. The server reads the blob through the Shelby Testnet indexer, maps its authoritative metadata, creates a renewal intent, estimates renewal gas with `RENEW_GAS_UNITS_ESTIMATE` default `4000`, then issues a five-minute signed quote.

Revalidation repeats the indexer read. If current expiration changed, return a fresh quote based on the new expiration with `requiresConfirmation: true` regardless of percentage drift.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd app/server && node --test test/renewal-quotes.test.js test/quotes.test.js test/payment-routes.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/src/lib/shelby-pricing.js app/server/src/lib/quotes.js app/server/src/index.js app/server/test/renewal-quotes.test.js app/server/test/payment-routes.test.js
git commit -m "feat(renewal): quote incremental Shelby retention"
```

### Task 3: Native and sponsored renewal transactions

**Files:**
- Create: `app/server/client-src/wallets/renewal.js`
- Modify: `app/server/client-src/wallets/transaction-evidence.js`
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/client-src/vessel-solana.js`
- Modify: `app/server/src/lib/sponsor.js`
- Modify: `app/server/src/index.js`
- Create: `app/server/test/renewal.test.js`
- Modify: `app/server/test/transaction-evidence.test.js`
- Modify: `app/server/test/solana-daa-client.test.js`
- Modify: `app/server/test/sponsor.test.js`

**Interfaces:**
- Produces: `createIncreaseExpirationPayload({ blobName, targetExpirationMicros, sponsored }): InputGenerateTransactionPayloadData`.
- Exposes `window.VesselWallets.renew(context)` routing native Aptos or Solana DAA.
- Sponsor submission consumes `operation: 'renewal'`, signed quote, paid authorization, transaction, and sender authenticator.

- [ ] **Step 1: Write failing payload and authorization tests**

```js
test('renewal payload chooses the native and sponsored Shelby functions', () => {
  assert.deepEqual(createIncreaseExpirationPayload({
    blobName: 'media/a.png', targetExpirationMicros: 123, sponsored: false,
  }), {
    function: `${SHELBY_DEPLOYER}::blob_metadata::increase_expiration_time`,
    functionArguments: ['media/a.png', 123],
  });
  assert.match(
    createIncreaseExpirationPayload({ blobName: 'media/a.png', targetExpirationMicros: 123, sponsored: true }).function,
    /increase_expiration_time_with_sponsor$/,
  );
});
```

Test that native renewal signs the exact payload after service-fee settlement, waits for Aptos success, then re-reads expiration. Test sponsored renewal builds a multi-agent transaction whose sender is the paid DAA and whose sponsor/fee payer is the configured gas-station address. Changed blob name/current expiration/target expiration must fail paid-authorization validation.

Extend transaction evidence fixtures with `BlobExpirationExtendedEvent.payment_amount`, `old_expiration_micros`, and `new_expiration_micros`. Assert renewal returns actual storage units, gas used, and both expirations from the successful Aptos transaction.

- [ ] **Step 2: Run renewal transaction tests and verify RED**

Run: `cd app/server && node --test test/renewal.test.js test/transaction-evidence.test.js test/solana-daa-client.test.js test/sponsor.test.js`

Expected: FAIL because no renewal transaction module exists.

- [ ] **Step 3: Implement exact payload builder and native renewal**

```js
import { SHELBY_DEPLOYER } from '@shelby-protocol/sdk/browser';

export function createIncreaseExpirationPayload({ blobName, targetExpirationMicros, sponsored }) {
  if (!blobName || !Number.isSafeInteger(targetExpirationMicros)) throw new TypeError('Invalid renewal payload');
  const suffix = sponsored ? '_with_sponsor' : '';
  return {
    function: `${SHELBY_DEPLOYER}::blob_metadata::increase_expiration_time${suffix}`,
    functionArguments: [blobName, targetExpirationMicros],
  };
}
```

Native flow uses the common settlement client, calls the active Aptos adapter's `signAndSubmitTransaction`, waits for the hash, and returns `{ transactionHash, expirationMicros }` only after indexer confirmation equals the quoted target.

- [ ] **Step 4: Implement sponsored DAA renewal**

Reuse the DAA signer and gas-station configuration from sponsored upload. Build and sign the exact multi-agent transaction:

```js
const transaction = await client.aptos.transaction.build.multiAgent({
  sender: storageAddr,
  data: createIncreaseExpirationPayload({
    blobName: quote.blobName,
    targetExpirationMicros: quote.targetExpirationMicros,
    sponsored: true,
  }),
  secondarySignerAddresses: [cfg.gasStationAccount],
  withFeePayer: true,
});
const response = await signAptosTransactionWithSolana({
  solanaWallet: solWallet(),
  authenticationFunction: authFn,
  rawTransaction: transaction,
  domain: DOMAIN,
});
if (!['Approved', 'APPROVED'].includes(response.status)) throw new Error('User rejected the signature');
```

Serialize `transaction.bcsToBytes()` and `response.args.bcsToBytes()` exactly as the upload sponsor path does, then submit to `/api/sponsor/submit` with `operation: 'renewal'`.

Server validation chooses expected operation from the paid authorization before inspecting the payload. It permits only the two approved Shelby renewal function IDs and exact blob/target arguments.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd app/server && node --test test/renewal.test.js test/transaction-evidence.test.js test/solana-daa-client.test.js test/sponsor.test.js test/payment-routes.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/client-src/wallets/renewal.js app/server/client-src/wallets/transaction-evidence.js app/server/client-src/vessel-wallets.js app/server/client-src/vessel-solana.js app/server/src/lib/sponsor.js app/server/src/index.js app/server/test/renewal.test.js app/server/test/transaction-evidence.test.js app/server/test/solana-daa-client.test.js app/server/test/sponsor.test.js app/server/test/payment-routes.test.js
git commit -m "feat(renewal): extend native and DAA blobs"
```

### Task 4: Gallery warning states, renewal dialog, and hidden artifacts

**Files:**
- Create: `app/server/public/renewal-dialog.js`
- Modify: `app/server/public/gallery.html`
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/ledger.js`
- Modify: `app/server/public/vessel.css`
- Modify: `app/server/test/ledger-and-gallery.test.js`
- Create: `app/server/test/renewal-dialog.test.js`
- Modify: `app/server/test/accessibility.test.js`

**Interfaces:**
- Produces: `openRenewalDialog({ artifact, opener, requestQuote, settleAndRenew }): Promise<void>`.
- Ledger adds `hideArtifact(walletIdentity, key)`, `isHidden(walletIdentity, key)`, and `unhideArtifact(walletIdentity, key)`.

- [ ] **Step 1: Write failing Gallery contract tests**

Assert rendered cards expose:

- an authoritative `<time>` expiration;
- exactly one highest-severity state from `active`, `soon`, `warning`, `critical`, `expired`;
- `RENEW` for renewable items and `UPLOAD AGAIN` for expired items;
- no `RENEW` button for expired/deleted/unwritten items.

Add ledger tests proving locally removed active items stay hidden after reconciliation for the same wallet but remain visible to a different wallet only if that wallet owns them.

- [ ] **Step 2: Run Gallery tests and verify RED**

Run: `cd app/server && node --test test/ledger-and-gallery.test.js test/renewal-dialog.test.js test/accessibility.test.js`

Expected: FAIL because Gallery has no renewal UI or hidden-artifact preference.

- [ ] **Step 3: Implement hidden-artifact preference**

Store `vessel_hidden_artifacts_v1` as `{ [walletIdentity]: { [blobKey]: hiddenAtMs } }`, cap each wallet to 100 entries, and filter only presentation. `forgetMine` calls `hideArtifact`; it still performs no Shelby mutation. An explicit successful upload of the same content calls `unhideArtifact`.

- [ ] **Step 4: Render expiry states and actions**

Replace the old `ttl()` function with `expiryState()`. Use current authoritative `expiresAt`; show `EXPIRING SOON` text for 7 days or less, stronger border/color at 3 days, critical hours at 1 day, and `EXPIRED` at zero. Each card contains only one status badge.

`UPLOAD AGAIN` links to Upload and passes no stale payment authorization. `RENEW` opens the in-page renewal dialog.

- [ ] **Step 5: Implement accessible renewal dialog**

The dialog uses the same focus trap/backdrop/Escape infrastructure as the Phase 1 confirmation module but contains:

- current UTC expiration;
- 7/30/90 radio presets and 1-365 custom numeric input;
- loading/ready/expired/unavailable quote panel;
- itemized storage, gas, Vessel fee/minimum uplift, and total;
- `Test tokens — no real monetary value`;
- Cancel and explicit `PAY & RENEW` action.

Initial focus is on Cancel. Quote refresh never opens a wallet. A drift greater than five percent or changed current expiration replaces the quote and requires a second click.

- [ ] **Step 6: Wire renewal completion and run tests**

On success, re-read the artifact from the indexer, update the ledger with the authoritative expiration/transaction/cost, close the dialog, restore focus to the card's Renew button, and announce the new UTC expiration. If the card was replaced during render, focus the Gallery heading.

Run: `cd app/server && node --test test/ledger-and-gallery.test.js test/renewal-dialog.test.js test/accessibility.test.js test/expiry.test.js`

Expected: all focused tests PASS.

- [ ] **Step 7: Commit Gallery renewal experience**

```bash
git add app/server/public/renewal-dialog.js app/server/public/gallery.html app/server/public/app.js app/server/public/ledger.js app/server/public/vessel.css app/server/test/ledger-and-gallery.test.js app/server/test/renewal-dialog.test.js app/server/test/accessibility.test.js
git commit -m "feat(gallery): add expiry warnings and renewal"
```

### Task 5: Renewal recovery and idempotent reconciliation

**Files:**
- Modify: `app/server/public/recovery-ledger.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/client-src/wallets/artifact-reconciler.js`
- Modify: `app/server/test/recovery-ledger.test.js`
- Modify: `app/server/test/artifact-reconciler.test.js`
- Create: `app/server/test/renewal-recovery.test.js`

**Interfaces:**
- Recovery records support `operation: 'renewal'` with current and target expiration.
- Reconciler resolves completion only from authoritative indexer expiration.

- [ ] **Step 1: Write failing interruption tests**

Cover these checkpoints:

1. quote rejected: no payment and no recovery authorization;
2. settlement succeeded, renewal not submitted: resume with the same paid authorization;
3. renewal transaction submitted, response lost: find transaction/indexer target and mark active;
4. another session already renewed: invalidate old quote and re-quote from new expiration;
5. paid authorization replay after target reached: return existing success without another transaction.

Assert no path requests settlement twice for the same quote ID.

- [ ] **Step 2: Run recovery tests and verify RED**

Run: `cd app/server && node --test test/renewal-recovery.test.js test/recovery-ledger.test.js test/artifact-reconciler.test.js`

Expected: FAIL because recovery records are upload-only.

- [ ] **Step 3: Extend recovery schema and resume logic**

Allow `operation: 'renewal'`, `blobName`, `currentExpirationMicros`, and `targetExpirationMicros`. Before resubmission, read authoritative expiration:

- equal to target or greater: complete locally without submitting;
- equal to quoted current: resume the exact paid renewal;
- between current and target or otherwise changed: discard transaction material and request a fresh quote;
- expired: mark failed with `expired_blob` and show Upload Again.

- [ ] **Step 4: Run recovery tests and commit**

Run: `cd app/server && node --test test/renewal-recovery.test.js test/recovery-ledger.test.js test/artifact-reconciler.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/public/recovery-ledger.js app/server/public/app.js app/server/client-src/wallets/artifact-reconciler.js app/server/test/recovery-ledger.test.js app/server/test/artifact-reconciler.test.js app/server/test/renewal-recovery.test.js
git commit -m "feat(recovery): resume paid blob renewals"
```

### Task 6: Full verification and real renewal checkpoint

**Files:**
- Generated: `app/server/public/vessel-wallets.js`
- Generated: `app/server/public/vessel-solana.js`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: release-ready bundles and real testnet renewal evidence.

- [ ] **Step 1: Run complete tests and rebuild**

Run: `cd app/server && npm run check`

Expected: all Node tests PASS and browser bundle build exits 0.

- [ ] **Step 2: Inspect scope and static/native-dialog regressions**

Run:

```bash
git diff --check
rg -n "\bconfirm\s*\(|\balert\s*\(|\bprompt\s*\(|faucet|7 \* 24 \* 3600" app/server --glob '!node_modules/**' --glob '!public/vessel-*.js'
git status --short
git diff --stat
```

Expected: no native dialog, faucet, or hard-coded seven-day runtime matches; only scoped changes are present.

- [ ] **Step 3: Verify native Aptos renewal on testnet**

Choose an active artifact, add 7 days, record old expiration, quote, service-fee transaction when applicable, renewal transaction, and new indexer expiration. Verify:

```text
new expiration = old expiration + 7 * 86,400,000,000 microseconds
```

Confirm Gallery warning and UTC expiration use the indexer result, not browser time.

- [ ] **Step 4: Verify sponsored DAA renewal and one recovery path**

Renew an active Solana DAA artifact by 30 days. Verify Devnet USDC payment, quote memo, sponsored Aptos transaction using `increase_expiration_time_with_sponsor`, exact incremental expiration, and no second debit after reloading between payment and submission.

- [ ] **Step 5: Verify expired behavior and responsive accessibility**

With a mocked/local expired artifact, confirm Renew is unavailable, Upload Again is visible, dialog focus/keyboard behavior passes, warnings show only one severity, and mobile has no horizontal overflow.

- [ ] **Step 6: Commit generated bundles**

```bash
git add app/server/public/vessel-wallets.js app/server/public/vessel-solana.js
git commit -m "build: release hot-storage renewal flow"
```

Do not deploy Phase 3 unless both real renewal paths succeed, old/new expiration is evidenced from the indexer, and the paid recovery case produces no duplicate charge.
