# Vessel Settlement Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HMAC/direct-transfer payment assumptions with a canonical Ed25519 `QuoteV1`, deployment registry, normalized receipt interface, and idempotent browser recovery foundation.

**Architecture:** The Node backend serializes a fixed BCS payload, signs its domain-separated SHA-256 digest with one Ed25519 operational key, and returns chain-specific settlement metadata. Chain adapters verify finalized contract receipts and normalize them before the existing paid authorization unlocks registration. Browser recovery records a submitted transaction before verification, so retries never create a second debit.

**Tech Stack:** Node.js ESM, built-in `node:crypto`, `@aptos-labs/ts-sdk` BCS serializer, Node test runner, browser ES modules.

## Global Constraints

- `QuoteV1` has the exact 13-field order approved in the design spec.
- Domain digest is `sha2_256("VESSEL_SETTLEMENT_V1" || bcs(QuoteV1))`.
- Quote TTL is exactly five minutes.
- One Ed25519 key is shared by Aptos and Solana; the online signer has no governance authority.
- Direct wallet/ATA transfers never produce settlement authorization.
- Preserve `app/server/.gitignore` and `stitch_guideline_compliance_design (1)/`; never stage them.
- Every behavior change is test-first and every task ends in a focused commit.

---

### Task 1: Canonical QuoteV1 codec and golden vector

**Files:**
- Create: `app/server/src/lib/settlement/quote-v1.js`
- Create: `app/server/test/quote-v1.test.js`
- Modify: `app/server/package.json`

**Interfaces:**
- Produces: `normalizeQuoteV1(input)`, `encodeQuoteV1(input)`, `quoteDigest(input)`, `quoteIdHex(input)`.
- Uses: `Serializer` from `@aptos-labs/ts-sdk` and `createHash` from `node:crypto`.

- [ ] **Step 1: Write the failing golden-vector tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQuoteV1, quoteDigest, normalizeQuoteV1 } from '../src/lib/settlement/quote-v1.js';

const fixture = Object.freeze({
  version: 1,
  chain: 1,
  network: 2,
  quoteId: '11'.repeat(32),
  payer: '22'.repeat(32),
  storageAddress: '33'.repeat(32),
  asset: '44'.repeat(32),
  amount: '84100',
  fileHash: '55'.repeat(32),
  retentionDays: 7,
  storageExpirationMicros: '1786354494000000',
  quoteExpiresAtSecs: '1785749994',
  configVersion: '1',
});

test('QuoteV1 BCS bytes and digest remain stable', () => {
  assert.equal(encodeQuoteV1(fixture).toString('hex'), '0101020000002011111111111111111111111111111111111111111111111111111111111111112022222222222222222222222222222222222222222222222222222222222222222033333333333333333333333333333333333333333333333333333333333333332044444444444444444444444444444444444444444444444444444444444444448448010000000000205555555555555555555555555555555555555555555555555555555555555555070080cb0e11ae580600ea61706a000000000100000000000000');
  assert.equal(quoteDigest(fixture).toString('hex'), 'b25001894f27c8433e0d5ae2d386745918a2f0805811d4d72f925b66f3270918');
});

test('QuoteV1 rejects non-canonical fields', () => {
  for (const patch of [{ version: 2 }, { retentionDays: 0 }, { quoteId: 'aa' }, { amount: '0' }]) {
    assert.throws(() => normalizeQuoteV1({ ...fixture, ...patch }));
  }
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `cd app/server && node --test test/quote-v1.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/settlement/quote-v1.js`.

- [ ] **Step 3: Implement the fixed-order BCS codec**

```js
import { createHash } from 'node:crypto';
import { Serializer } from '@aptos-labs/ts-sdk';

const DOMAIN = Buffer.from('VESSEL_SETTLEMENT_V1', 'ascii');
const HEX_32 = /^[0-9a-f]{64}$/;
const bytes32 = (value, field) => {
  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!HEX_32.test(text)) throw new TypeError(`${field} must be 32 bytes`);
  return Uint8Array.from(Buffer.from(text, 'hex'));
};
const u64 = (value, field) => {
  const result = BigInt(value);
  if (result <= 0n || result > 0xffff_ffff_ffff_ffffn) throw new RangeError(`${field} is invalid`);
  return result;
};

export function normalizeQuoteV1(input) {
  const quote = {
    version: Number(input.version), chain: Number(input.chain), network: Number(input.network),
    quoteId: bytes32(input.quoteId, 'quoteId'), payer: bytes32(input.payer, 'payer'),
    storageAddress: bytes32(input.storageAddress, 'storageAddress'), asset: bytes32(input.asset, 'asset'),
    amount: u64(input.amount, 'amount'), fileHash: bytes32(input.fileHash, 'fileHash'),
    retentionDays: Number(input.retentionDays), storageExpirationMicros: u64(input.storageExpirationMicros, 'storageExpirationMicros'),
    quoteExpiresAtSecs: u64(input.quoteExpiresAtSecs, 'quoteExpiresAtSecs'), configVersion: u64(input.configVersion, 'configVersion'),
  };
  if (quote.version !== 1 || ![1, 2].includes(quote.chain) || !Number.isSafeInteger(quote.network)
    || quote.network < 0 || !Number.isInteger(quote.retentionDays)
    || quote.retentionDays < 1 || quote.retentionDays > 365) throw new RangeError('QuoteV1 field is invalid');
  return Object.freeze(quote);
}

export function encodeQuoteV1(input) {
  const q = normalizeQuoteV1(input);
  const s = new Serializer();
  s.serializeU8(q.version); s.serializeU8(q.chain); s.serializeU32(q.network);
  s.serializeBytes(q.quoteId); s.serializeBytes(q.payer); s.serializeBytes(q.storageAddress);
  s.serializeBytes(q.asset); s.serializeU64(q.amount); s.serializeBytes(q.fileHash);
  s.serializeU16(q.retentionDays); s.serializeU64(q.storageExpirationMicros);
  s.serializeU64(q.quoteExpiresAtSecs); s.serializeU64(q.configVersion);
  return Buffer.from(s.toUint8Array());
}

export const quoteDigest = (input) => createHash('sha256').update(DOMAIN).update(encodeQuoteV1(input)).digest();
export const quoteIdHex = (input) => Buffer.from(normalizeQuoteV1(input).quoteId).toString('hex');
```

- [ ] **Step 4: Verify the independent golden vector**

Run: `cd app/server && node --test test/quote-v1.test.js`

Expected: PASS with the reviewed BCS bytes and SHA-256 digest above.

- [ ] **Step 5: Add a focused test script and commit**

Add to `app/server/package.json`:

```json
"test:settlement": "node --test test/quote-v1.test.js"
```

Run: `cd app/server && npm run test:settlement`

Expected: the QuoteV1 tests PASS. Each later task appends its test file to this script in the same commit that creates the file.

Commit:

```powershell
git add app/server/src/lib/settlement/quote-v1.js app/server/test/quote-v1.test.js app/server/package.json
git commit -m "feat(settlement): add canonical QuoteV1 codec"
```

### Task 2: Ed25519 contract quote manager

**Files:**
- Create: `app/server/src/lib/settlement/contract-quotes.js`
- Create: `app/server/test/contract-quotes.test.js`
- Modify: `app/server/src/lib/quotes.js`
- Modify: `app/server/package.json`

**Interfaces:**
- Consumes: `quoteDigest(quoteV1)` from Task 1 and existing `calculateUploadQuote` output.
- Produces: `ContractQuoteManager.issueUpload(context)`, `verifySignature(contractQuote)`, and a public quote with `contractQuote`, `contractSignature`, and `quotePublicKey`.

- [ ] **Step 1: Write failing signature, expiry, and tamper tests**

```js
test('contract quote is signed by the configured Ed25519 key', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const manager = ContractQuoteManager.forTest({ privateKey, publicKey, now: () => 1_785_749_694_000n, pricing });
  const result = await manager.issueUpload(aptosContext);
  assert.equal(result.contractQuote.quoteExpiresAtSecs, '1785749994');
  assert.equal(manager.verifySignature(result), true);
  assert.equal(manager.verifySignature({ ...result, contractQuote: { ...result.contractQuote, amount: '84101' } }), false);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd app/server && node --test test/contract-quotes.test.js`

Expected: FAIL with `ContractQuoteManager` missing.

- [ ] **Step 3: Implement Ed25519 signing and chain-specific amount mapping**

```js
const CHAIN = { aptos: 1, solana: 2 };
const NETWORK = { aptos: 2, solana: 1 };

function settlementAmount(chain, breakdown) {
  return chain === 'aptos'
    ? (BigInt(breakdown.serviceFeeAccountingMicro) * 100n).toString()
    : String(breakdown.totalAccountingMicro);
}

export class ContractQuoteManager {
  async issueUpload(input) {
    const context = normalizeUploadQuoteContext(input);
    const breakdown = await this.priceUpload(context);
    const issuedAtMs = Number(this.now());
    const contractQuote = Object.freeze({
      version: 1,
      chain: CHAIN[context.chain],
      network: NETWORK[context.chain],
      quoteId: randomBytes(32).toString('hex'),
      payer: addressBytes32(context.sourceAddress, context.chain),
      storageAddress: addressBytes32(context.storageAddress, 'aptos'),
      asset: context.chain === 'aptos' ? this.aptosAssetHex : this.solanaMintHex,
      amount: settlementAmount(context.chain, breakdown),
      fileHash: context.fileHash,
      retentionDays: context.days,
      storageExpirationMicros: String(context.expirationMicros),
      quoteExpiresAtSecs: String(Math.floor(issuedAtMs / 1000) + 300),
      configVersion: String(this.configVersion),
    });
    const signature = cryptoSign(null, quoteDigest(contractQuote), this.privateKey);
    return publicContractQuote({ uploadContext: context, breakdown, contractQuote, signature, publicKey: this.publicKey });
  }
}
```

Use raw 32-byte public keys and 64-byte signatures encoded as lowercase hex. Import private keys from a PKCS#8 DER base64 environment value with `createPrivateKey`; derive and compare the public key at startup.

- [ ] **Step 4: Retain `QuoteManager` only for internal paid authorization compatibility**

Change `app/server/src/lib/quotes.js` so pricing/context normalization remains exported, but new upload issuance is delegated to `ContractQuoteManager`. Do not delete HMAC validation until Task 5 migrates `PaidAuthorizationManager`.

- [ ] **Step 5: Run tests and commit**

Extend `test:settlement` to `node --test test/quote-v1.test.js test/contract-quotes.test.js`.

Run: `cd app/server && node --test test/quote-v1.test.js test/contract-quotes.test.js test/quotes.test.js`

Expected: PASS.

```powershell
git add app/server/src/lib/settlement/contract-quotes.js app/server/src/lib/quotes.js app/server/test/contract-quotes.test.js app/server/package.json
git commit -m "feat(quotes): sign contract-verifiable Ed25519 quotes"
```

### Task 3: Versioned deployment registry and fail-closed configuration

**Files:**
- Create: `deployments/vessel-settlement.testnet.json`
- Create: `app/server/src/lib/settlement/deployments.js`
- Create: `app/server/test/settlement-deployments.test.js`
- Modify: `app/server/src/config.js`
- Modify: `app/server/.env.example`

**Interfaces:**
- Produces: `loadSettlementDeployments({ file, quotePublicKey })`.
- Returns: frozen `{ aptos, solana, quotePublicKey, configVersion }` only when both chain records are complete and agree.

- [ ] **Step 1: Write failing registry validation tests**

Test that an enabled registry rejects a zero module/program ID, mismatched quote keys, non-24-hour timelock, wrong test networks, and missing multisig/vault identifiers. Test that `SETTLEMENT_CONTRACTS_ENABLED=false` allows an undeployed manifest only in development/test.

- [ ] **Step 2: Create the non-secret manifest schema**

```json
{
  "schemaVersion": 1,
  "environment": "testnet",
  "quotePublicKey": "0000000000000000000000000000000000000000000000000000000000000000",
  "configVersion": "1",
  "aptos": { "chainId": 2, "moduleAddress": "0x0", "vaultAddress": "0x0", "multisigAddress": "0x0", "deploymentTransaction": "0x0", "timelockSeconds": 86400 },
  "solana": { "cluster": "devnet", "programId": "11111111111111111111111111111111", "configPda": "11111111111111111111111111111111", "vaultAta": "11111111111111111111111111111111", "squadsMultisig": "11111111111111111111111111111111", "deploymentSignature": "", "timelockSeconds": 86400 }
}
```

Zeros are explicit undeployed sentinels and are rejected whenever the feature is enabled.

- [ ] **Step 3: Implement validation and config keys**

Add:

```env
SETTLEMENT_CONTRACTS_ENABLED=false
SETTLEMENT_DEPLOYMENTS_FILE=../../deployments/vessel-settlement.testnet.json
QUOTE_SIGNER_PRIVATE_KEY_B64=
QUOTE_SIGNER_PUBLIC_KEY_HEX=
```

Remove `SOLANA_TREASURY_SECRET_KEY` and `APTOS_TREASURY_ADDRESS` from the documented active payment path; retain comments marking them legacy until rollout removes code references.

- [ ] **Step 4: Run tests and commit**

Run: `cd app/server && node --test test/settlement-deployments.test.js test/config.test.js`

Expected: PASS.

```powershell
git add deployments/vessel-settlement.testnet.json app/server/src/lib/settlement/deployments.js app/server/test/settlement-deployments.test.js app/server/src/config.js app/server/.env.example
git commit -m "feat(settlement): validate chain deployment registry"
```

### Task 4: Normalized receipt and adapter boundary

**Files:**
- Create: `app/server/src/lib/settlement/receipt.js`
- Create: `app/server/src/lib/settlement/adapters.js`
- Create: `app/server/test/settlement-adapters.test.js`
- Modify: `app/server/package.json`

**Interfaces:**
- Produces: `normalizeSettlementReceipt(input)` and `SettlementAdapterRegistry.verify({ chain, quote, transactionId })`.
- Adapter contract: `adapter.verify({ quote, transactionId }) -> Promise<NormalizedSettlementReceipt>`.

- [ ] **Step 1: Write failing normalization and routing tests**

```js
test('registry returns an immutable receipt only from the selected chain adapter', async () => {
  const aptos = { verify: async () => receiptFixture({ chain: 'aptos' }) };
  const registry = new SettlementAdapterRegistry({ aptos, solana: { verify: async () => assert.fail() } });
  const receipt = await registry.verify({ chain: 'aptos', quote, transactionId: '0xtx' });
  assert.equal(receipt.quoteId, quote.contractQuote.quoteId);
  assert.equal(Object.isFrozen(receipt), true);
});
```

Reject receipts whose deployment ID, quote ID, payer, asset, amount, storage address, file hash, expiration, config version, or transaction ID differs from the signed quote.

- [ ] **Step 2: Implement strict normalization and registry dispatch**

The normalized object contains exactly:

```js
{
  chain, network, deploymentId, quoteId, payer, storageAddress, asset, amount,
  fileHash, storageExpirationMicros, transactionId, blockReference,
  finalizedAtMs, configVersion
}
```

No adapter may return raw RPC data through this boundary.

- [ ] **Step 3: Run tests and commit**

Extend `test:settlement` to include `test/settlement-adapters.test.js`.

Run: `cd app/server && node --test test/settlement-adapters.test.js`

Expected: PASS.

```powershell
git add app/server/src/lib/settlement/receipt.js app/server/src/lib/settlement/adapters.js app/server/test/settlement-adapters.test.js app/server/package.json
git commit -m "feat(settlement): add normalized receipt adapters"
```

### Task 5: Receipt-bound paid authorization

**Files:**
- Modify: `app/server/src/lib/paid-authorizations.js`
- Modify: `app/server/test/paid-authorizations.test.js`

**Interfaces:**
- Consumes: normalized receipt from Task 4 and signed `contractQuote` from Task 2.
- Produces: `issue({ quote, receipt })` and `validate(token, expectedQuote, { transactionId })`.

- [ ] **Step 1: Replace tests that trust an arbitrary settlement hash**

Require `receipt.quoteId === quote.contractQuote.quoteId`, full receipt/quote equality, and a configured deployment ID. Prove that a normal wallet transfer object cannot be passed to `issue`.

- [ ] **Step 2: Implement receipt digest binding**

```js
const receiptDigest = (receipt) => digest(JSON.stringify(normalizeSettlementReceipt(receipt)));

issue({ quote, receipt }) {
  assertReceiptMatchesQuote(receipt, quote);
  const payload = {
    v: 2,
    qid: quote.contractQuote.quoteId,
    rd: receiptDigest(receipt),
    sc: receipt.chain,
    tx: receipt.transactionId,
    iat: this.now(),
    exp: this.now() + this.ttlMs,
  };
  return this.encodeAndSign(payload);
}
```

Version 1 authorizations are rejected once `SETTLEMENT_CONTRACTS_ENABLED=true`.

- [ ] **Step 3: Run tests and commit**

Run: `cd app/server && node --test test/paid-authorizations.test.js test/settlement-adapters.test.js`

Expected: PASS.

```powershell
git add app/server/src/lib/paid-authorizations.js app/server/test/paid-authorizations.test.js
git commit -m "feat(payment): bind authorizations to contract receipts"
```

### Task 6: Idempotent browser submission and verification recovery

**Files:**
- Create: `app/server/public/contract-settlement-client.js`
- Create: `app/server/test/contract-settlement-client.test.js`
- Modify: `app/server/public/recovery-ledger.js`
- Modify: `app/server/test/recovery-ledger.test.js`
- Modify: `app/server/package.json`

**Interfaces:**
- Produces: `settleContractQuote({ quote, chainClient, request, onSubmitted })`.
- `chainClient.submit({ contractQuote, contractSignature }) -> { transactionId }`.
- `onSubmitted({ quoteId, transactionId })` must run before `/api/settlements/verify`.

- [ ] **Step 1: Write the interrupted-verification test**

```js
test('retry verifies the recorded transaction without submitting another payment', async () => {
  let submits = 0;
  const saved = [];
  const chainClient = { submit: async () => ({ transactionId: `tx-${++submits}` }) };
  const request = async () => { throw Object.assign(new Error('pending'), { code: 'receipt_pending' }); };
  await assert.rejects(() => settleContractQuote({ quote, chainClient, request, onSubmitted: (x) => saved.push(x) }));
  assert.equal(submits, 1);
  assert.deepEqual(saved, [{ quoteId: quote.contractQuote.quoteId, transactionId: 'tx-1' }]);
});
```

- [ ] **Step 2: Implement submit-once, verify-many behavior**

```js
export async function settleContractQuote({ quote, chainClient, request, onSubmitted, transactionId }) {
  let id = transactionId;
  if (!id) {
    const submitted = await chainClient.submit({
      contractQuote: quote.contractQuote,
      contractSignature: quote.contractSignature,
    });
    id = String(submitted?.transactionId || '');
    if (!id) throw settlementError('Wallet did not return a transaction ID', 'settlement_submission_failed');
    await onSubmitted?.({ quoteId: quote.contractQuote.quoteId, transactionId: id });
  }
  return request('/api/settlements/verify', {
    method: 'POST', body: {
      quoteToken: quote.quoteToken,
      uploadContext: quote.uploadContext,
      contractQuote: quote.contractQuote,
      contractSignature: quote.contractSignature,
      transactionId: id,
    },
  });
}
```

Add recovery stage `settlement_submitted` and allowlisted `settlementTransactionId`. Never store private keys, raw signed quote bytes, or wallet signatures.

- [ ] **Step 3: Run tests and commit**

Extend `test:settlement` to include `test/contract-settlement-client.test.js`.

Run: `cd app/server && node --test test/contract-settlement-client.test.js test/recovery-ledger.test.js`

Expected: PASS.

```powershell
git add app/server/public/contract-settlement-client.js app/server/test/contract-settlement-client.test.js app/server/public/recovery-ledger.js app/server/test/recovery-ledger.test.js app/server/package.json
git commit -m "feat(recovery): persist contract settlement before verification"
```

### Task 7: Foundation verification checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-08-03-vessel-settlement-foundation.md` (checkboxes only)

**Interfaces:**
- Produces a reviewed foundation consumed by the Aptos and Solana implementation plans.

- [ ] **Step 1: Run focused and full checks**

Run:

```powershell
cd app/server
npm run test:settlement
npm run check
```

Expected: all Node tests PASS and both browser bundles build.

- [ ] **Step 2: Scan for accidental secrets and legacy authorization**

Run:

```powershell
cd D:\Visell
rg -n "PRIVATE KEY|BEGIN PRIVATE|QUOTE_SIGNER_PRIVATE_KEY_B64=.+|SOLANA_TREASURY_SECRET_KEY=.+" --glob '!app/server/.env' --glob '!node_modules/**'
rg -n "verifyQuotePayment|verifyAptosShelbyUsdTransfer" app/server/src app/server/public --glob '!public/vessel-*.js'
```

Expected: no committed secret values; legacy verifier references remain only until the rollout plan removes their routes and cannot be selected when contract settlement is enabled.

- [ ] **Step 3: Review diff and commit checkpoint metadata only if needed**

Run: `git status --short && git diff --check`

Expected: only scoped implementation changes plus the preserved user-owned `.gitignore` and Stitch directory.
