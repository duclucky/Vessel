# Vessel Solana Multi-Wallet DAA and Payment Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the proven Phantom/Solana DAA upload to all compatible installed Solana Wallet Standard providers and bind every USDC quote and sponsored submit to the correct wallet, DAA address, file size, and expiration.

**Architecture:** A Solana Wallet Standard adapter exposes the legacy-shaped `connect`, `signMessage`, and `signAndSendTransaction` methods required by the proven DAA module. The DAA module accepts an explicitly selected provider instead of reading `window.phantom`. Server payment tokens carry immutable upload context, verification proves both treasury receipt and source-wallet spend, and sponsor submission rejects a transaction whose sender differs from the bound DAA address.

**Tech Stack:** Vanilla JavaScript, `@wallet-standard/features@1.1.1`, `@solana/wallet-standard-features@1.4.0`, `@solana/web3.js@1.98.4`, `@shelby-protocol/solana-kit@0.2.8`, `@aptos-labs/ts-sdk@5.2.1`, `bs58@6.0.0`, Express, Node.js `node:test`, Solana Devnet, Shelby Testnet.

## Global Constraints

- Complete the wallet-foundation and native-Aptos plans first.
- Preserve the current Phantom live-green DAA derivation, USDC transfer, sponsor signing, testnet challenge fallback, and byte-upload behavior.
- Enable a Solana wallet only when it supports `standard:connect`, `standard:events`, `solana:signMessage`, and `solana:signAndSendTransaction` with legacy transactions on `solana:devnet`.
- Never fall back to whichever provider happens to own `window.solana` after the user selects a Wallet Standard descriptor.
- Derive storage identity from the selected account and the configured Vessel domain.
- Bind payment intent to `chain`, `sourceAddress`, `storageAddress`, `sizeBytes`, and `expirationMicros`.
- Verify the USDC source token balance belongs to `sourceAddress` and decreases by at least the quoted amount.
- Verify the serialized Aptos transaction sender equals `storageAddress` before gas-station submission.
- Reject mismatched, expired, tampered, wrong-source, or wrong-sender tokens with no sponsorship.
- Keep all HMAC, treasury, and gas-station secrets server-side.
- Do not enable an additional Solana wallet until its real DAA register and byte-upload path passes.

---

## File map

- Create `app/server/client-src/wallets/solana-adapter.js`: Wallet Standard to legacy-shaped provider adapter.
- Modify `app/server/client-src/vessel-solana.js`: explicit provider selection and context-aware quote/upload inputs.
- Modify `app/server/client-src/vessel-wallets.js`: register Solana adapters and route DAA uploads.
- Modify `app/server/client-src/wallets/upload-router.js`: use selected Solana adapter.
- Modify `app/server/public/app.js`: request identity-bound quotes and pass upload context.
- Modify `app/server/package.json` and `package-lock.json`: direct `bs58@6.0.0` dependency.
- Create `app/server/test/solana-adapter.test.js`.
- Modify `app/server/test/upload-router.test.js` and `wallet-registry.test.js`.
- Create `app/server/test/payments.test.js`.
- Create `app/server/test/sponsor.test.js`.
- Modify `app/server/src/lib/payments.js`: signed context and source-spend verification.
- Modify `app/server/src/lib/sponsor.js`: deserialize once and validate transaction sender.
- Modify `app/server/src/index.js`: validate quote, verify, and sponsor request context.
- Modify `app/server/src/config.js`: wallet capability flags.
- Create `app/server/test/wallet-api.test.js` or extend an existing server route test with dependency injection.
- Modify `NOTES.md` and `HANDOFF.md` after live acceptance.

---

### Task 1: Adapt Solana Wallet Standard providers to the proven client contract

**Files:**
- Modify: `app/server/package.json`
- Modify: `app/server/package-lock.json`
- Create: `app/server/client-src/wallets/solana-adapter.js`
- Create: `app/server/test/solana-adapter.test.js`
- Modify: `app/server/client-src/vessel-wallets.js`

**Interfaces:**
- Consumes a normalized Solana descriptor with a Wallet Standard provider.
- Produces `createSolanaAdapter(descriptor)` with controller adapter methods and `daaProvider()`.
- `daaProvider()` returns `{ name, publicKey, connect(), signMessage(bytes), signAndSendTransaction(transaction) }`.
- Solana session `{ chain: 'solana', walletId, walletName, sourceAddress, sourceNetwork: 'devnet', storageAddress, mode: 'daa' }` is completed after the DAA client returns the derived address.

- [ ] **Step 1: Add the direct base58 dependency**

Run from `app/server`:

```powershell
npm install --save-exact bs58@6.0.0
```

Expected: `npm ls bs58` shows direct `bs58@6.0.0`; the web3.js transitive 4.x copy may remain nested.

- [ ] **Step 2: Write failing adapter tests**

Create `test/solana-adapter.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, Transaction } from '@solana/web3.js';
import { createSolanaAdapter } from '../client-src/wallets/solana-adapter.js';

const key = new PublicKey('EUrhHCRueCGE39yvNM1zV15fyCcizY2P8xLzDNdc418s');
function provider() {
  const account = { address: key.toBase58(), publicKey: key.toBytes(), chains: ['solana:devnet'], features: ['solana:signMessage', 'solana:signAndSendTransaction'] };
  return {
    name: 'Standard Wallet', chains: ['solana:devnet'], accounts: [],
    features: {
      'standard:connect': { connect: async ({ silent } = {}) => { provider.silent = silent; return { accounts: [account] }; } },
      'standard:events': { on: () => () => {} },
      'solana:signMessage': { signMessage: async ({ message }) => [{ signedMessage: message, signature: Uint8Array.from({ length: 64 }, (_, i) => i) }] },
      'solana:signAndSendTransaction': { supportedTransactionVersions: ['legacy'], signAndSendTransaction: async () => [{ signature: Uint8Array.from({ length: 64 }, () => 1) }] },
    },
  };
}

test('standard signMessage is normalized to Phantom-compatible signature output', async () => {
  const adapter = createSolanaAdapter({ id: 'solana:standard:1', name: 'Standard Wallet', provider: provider() });
  const daa = adapter.daaProvider();
  const connected = await daa.connect({ onlyIfTrusted: true });
  const signed = await daa.signMessage(Uint8Array.from([1, 2, 3]));
  assert.equal(connected.publicKey.toBase58(), key.toBase58());
  assert.equal(signed.signature.length, 64);
});

test('standard signAndSendTransaction returns a base58 signature', async () => {
  const adapter = createSolanaAdapter({ id: 'solana:standard:1', name: 'Standard Wallet', provider: provider() });
  await adapter.daaProvider().connect();
  const tx = new Transaction(); tx.recentBlockhash = key.toBase58(); tx.feePayer = key;
  const result = await adapter.daaProvider().signAndSendTransaction(tx);
  assert.equal(typeof result.signature, 'string');
  assert.ok(result.signature.length > 40);
});
```

- [ ] **Step 3: Run and confirm the missing-module failure**

Run: `node --test test/solana-adapter.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement the Wallet Standard adapter**

Create `client-src/wallets/solana-adapter.js`:

```js
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

const DEVNET = 'solana:devnet';
export function createSolanaAdapter(descriptor) {
  const wallet = descriptor.provider;
  let account = null;
  let storageAddress = '';
  const connectStandard = async ({ silent = false } = {}) => {
    const output = await wallet.features['standard:connect'].connect({ silent });
    account = output.accounts.find((item) => item.chains?.includes(DEVNET)) || output.accounts[0];
    if (!account) throw Object.assign(new Error('No Solana account was authorized'), { code: 'provider_unavailable' });
    return account;
  };
  const provider = {
    name: descriptor.name,
    get publicKey() { return account ? new PublicKey(account.publicKey) : null; },
    async connect(options = {}) { const selected = await connectStandard({ silent: Boolean(options.onlyIfTrusted) }); return { publicKey: new PublicKey(selected.publicKey) }; },
    async signMessage(message) {
      const [output] = await wallet.features['solana:signMessage'].signMessage({ account, message });
      return { signature: output.signature, signedMessage: output.signedMessage };
    },
    async signAndSendTransaction(transaction) {
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [output] = await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({
        account, chain: DEVNET, transaction: serialized, options: { commitment: 'confirmed' },
      });
      return { signature: bs58.encode(output.signature) };
    },
  };
  return {
    daaProvider: () => provider,
    setStorageAddress(value) { storageAddress = value; },
    async connect({ silent = false } = {}) {
      const selected = await connectStandard({ silent });
      return { chain: 'solana', walletId: descriptor.id, walletName: descriptor.name, sourceAddress: selected.address, sourceNetwork: 'devnet', storageAddress, mode: 'daa' };
    },
    subscribe(listener) {
      return wallet.features['standard:events'].on('change', ({ accounts }) => {
        if (!accounts?.length) return listener({ session: null, status: 'disconnected' });
        account = accounts.find((item) => item.chains?.includes(DEVNET)) || accounts[0];
        listener({ session: { chain: 'solana', walletId: descriptor.id, walletName: descriptor.name, sourceAddress: account.address, sourceNetwork: 'devnet', storageAddress: '', mode: 'daa' } });
      });
    },
    async disconnect() { account = null; storageAddress = ''; },
  };
}
```

Before enabling a descriptor, confirm
`wallet.features['solana:signAndSendTransaction'].supportedTransactionVersions`
includes `'legacy'`. Mark it `incompatible` otherwise.

- [ ] **Step 5: Register Solana adapters in the composition root**

During registry scan, cache one `createSolanaAdapter(descriptor)` per enabled Solana
descriptor. The selected adapter's `daaProvider()` is the only provider passed to the
DAA module.

- [ ] **Step 6: Run adapter, registry, and build checks**

Run: `node --test test/solana-adapter.test.js test/wallet-registry.test.js && npm run build:client`

Expected: focused tests pass and both bundles build.

- [ ] **Step 7: Commit the standard adapter**

```powershell
git add app/server/package.json app/server/package-lock.json app/server/client-src/wallets/solana-adapter.js app/server/client-src/vessel-wallets.js app/server/public/vessel-wallets.js app/server/test/solana-adapter.test.js app/server/test/wallet-registry.test.js
git commit -m "feat(solana): adapt wallet standard providers"
```

---

### Task 2: Make the proven DAA module provider-selectable

**Files:**
- Modify: `app/server/client-src/vessel-solana.js`
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/client-src/wallets/upload-router.js`
- Modify: `app/server/test/upload-router.test.js`
- Create: `app/server/test/solana-daa-client.test.js`

**Interfaces:**
- `window.VesselSolana.selectProvider(provider)` stores the explicitly selected provider.
- `window.VesselSolana.connect(provider?)` derives from that provider and returns `{ solana, storageAccount, network }`.
- `window.VesselSolana.uploadSponsored(file, context)` accepts identity-bound payment context.
- `window.VesselSolana.clearProvider()` removes identity state on disconnect.

- [ ] **Step 1: Write the explicit-provider regression test**

Create `test/solana-daa-client.test.js` as a source-level contract test:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../client-src/vessel-solana.js', import.meta.url), 'utf8');

test('DAA client accepts an explicitly selected provider and exposes no implicit connect fallback', () => {
  assert.match(source, /function selectProvider\(nextProvider\)/);
  assert.match(source, /async function connect\(nextProvider/);
  assert.match(source, /clearProvider/);
  assert.doesNotMatch(source, /provider = getPhantom\(\);/);
});
```

- [ ] **Step 2: Run and confirm the old Phantom-only assignment fails**

Run: `node --test test/solana-daa-client.test.js`

Expected: FAIL because `connect()` assigns `getPhantom()`.

- [ ] **Step 3: Add explicit provider lifecycle**

Replace implicit selection with:

```js
function selectProvider(nextProvider) {
  if (!nextProvider) throw new Error('Select a Solana wallet before connecting');
  provider = nextProvider;
  return provider;
}

function clearProvider() {
  provider = null; pubkey = null; storageAddr = null; client = null;
}

async function connect(nextProvider) {
  if (nextProvider) selectProvider(nextProvider);
  if (!provider) {
    const legacy = getPhantom();
    if (!legacy) throw new Error('No selected Solana wallet is available');
    selectProvider(legacy);
  }
  await loadConfig();
  const response = await provider.connect();
  pubkey = response.publicKey.toString();
  storageAddr = deriveAddress(pubkey);
  client = new ShelbyClient({ network: CFG.net });
  return { solana: pubkey, storageAccount: storageAddr.toString(), network: NET };
}
```

The only allowed legacy fallback is reached when no Wallet Registry selection exists;
remove it after the production migration proves no caller depends on it.

- [ ] **Step 4: Connect session and DAA identities atomically**

In `vessel-wallets.js`, selecting a Solana descriptor must:

1. call the standard adapter's silent or interactive connect;
2. call `window.VesselSolana.connect(adapter.daaProvider())`;
3. place the returned `storageAccount` into the session;
4. call `adapter.setStorageAddress(storageAccount)`; and
5. publish `ready` only after both addresses are present.

On account change, clear the DAA address and rederive before enabling upload.

- [ ] **Step 5: Route Solana upload through the selected adapter**

Supply `solanaUpload` to the upload router as:

```js
async function solanaUpload(file, context) {
  const current = controller.getState().session;
  if (!current || current.mode !== 'daa') throw new Error('Connect a Solana wallet before uploading');
  return window.VesselSolana.uploadSponsored(file, context);
}
```

- [ ] **Step 6: Run focused tests and the full existing Solana build**

Run: `node --test test/solana-daa-client.test.js test/solana-adapter.test.js test/upload-router.test.js && npm run build:client`

Expected: all focused tests pass; the legacy DAA bundle still builds.

- [ ] **Step 7: Commit provider selection**

```powershell
git add app/server/client-src/vessel-solana.js app/server/client-src/vessel-wallets.js app/server/client-src/wallets/upload-router.js app/server/public/vessel-solana.js app/server/public/vessel-wallets.js app/server/test/solana-daa-client.test.js app/server/test/upload-router.test.js
git commit -m "refactor(solana): select DAA wallet provider"
```

---

### Task 3: Bind payment intents to wallet, DAA, file, and expiration

**Files:**
- Create: `app/server/test/payments.test.js`
- Modify: `app/server/src/lib/payments.js`
- Modify: `app/server/src/lib/sponsor.js`
- Modify: `app/server/src/index.js`
- Modify: `app/server/client-src/vessel-solana.js`
- Modify: `app/server/public/app.js`

**Interfaces:**
- `PaymentManager.createIntent({ sizeBytes, chain, sourceAddress, storageAddress, expirationMicros })`.
- Parsed payment context `{ amountMicro, sizeBytes, chain, sourceAddress, storageAddress, expirationMicros }`.
- `PaymentManager.verify(paymentId, signature)` verifies treasury receipt, memo, and source-wallet debit.
- `PaymentManager.checkUploadToken(paymentId, token, context)` compares all bound fields.
- `SponsorManager.submit(txnB64, senderAuthB64, { expectedSender })` rejects wrong Aptos sender.

- [ ] **Step 1: Write failing stateless-binding tests**

Create `test/payments.test.js` with a test-only constructor path that injects `conn`,
`treasuryPublicKey`, and `treasuryAta` rather than requiring a private key:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentManager } from '../src/lib/payments.js';

const context = { sizeBytes: 42, chain: 'solana', sourceAddress: 'Source111', storageAddress: '0xdaa', expirationMicros: 1_800_000_000_000_000 };

test('payment token is bound to the complete upload context', async () => {
  const manager = PaymentManager.forTest({ secret: 'secret', priceBaseUsdc: 0.01, pricePerMbUsdc: 0, treasury: 'Treasury111', treasuryAta: 'Ata111' });
  const quote = await manager.createIntent(context);
  const token = manager.uploadToken(quote.paymentId);
  assert.equal(manager.checkUploadToken(quote.paymentId, token, context), true);
  assert.equal(manager.checkUploadToken(quote.paymentId, token, { ...context, storageAddress: '0xother' }), false);
  assert.equal(manager.checkUploadToken(quote.paymentId, token, { ...context, sizeBytes: 43 }), false);
});

test('payment verification requires a debit owned by the bound source wallet', async () => {
  const tx = {
    meta: {
      err: null,
      preTokenBalances: [{ owner: 'Source111', mint: 'Mint111', uiTokenAmount: { amount: '20000' } }, { owner: 'Treasury111', mint: 'Mint111', uiTokenAmount: { amount: '0' } }],
      postTokenBalances: [{ owner: 'Source111', mint: 'Mint111', uiTokenAmount: { amount: '10000' } }, { owner: 'Treasury111', mint: 'Mint111', uiTokenAmount: { amount: '10000' } }],
    },
    transaction: { message: { instructions: [] } },
  };
  const manager = PaymentManager.forTest({ secret: 'secret', priceBaseUsdc: 0.01, pricePerMbUsdc: 0, treasury: 'Treasury111', treasuryAta: 'Ata111', mint: 'Mint111', tx });
  const quote = await manager.createIntent(context);
  tx.transaction.message.instructions.push({ memo: quote.paymentId });
  assert.equal((await manager.verify(quote.paymentId, 'sig')).ok, true);
  tx.meta.preTokenBalances[0].owner = 'Attacker111';
  assert.equal((await manager.verify(quote.paymentId, 'sig')).reason, 'source_mismatch');
});
```

- [ ] **Step 2: Run and verify the old constructor/API fails**

Run: `node --test test/payments.test.js`

Expected: FAIL because `forTest`, object-form `createIntent`, and context-aware token checks do not exist.

- [ ] **Step 3: Sign the complete context into `paymentId`**

Change the payload to compact fields:

```js
_mintPaymentId(amountMicro, context) {
  const payload = b64u(JSON.stringify({
    a: amountMicro, s: context.sizeBytes, c: context.chain,
    w: context.sourceAddress, d: context.storageAddress,
    x: context.expirationMicros, e: Date.now() + 15 * 60 * 1000,
  }));
  return `vpay.${payload}.${this._hmac(payload)}`;
}
```

`_parsePaymentId` must validate finite positive `s` and `x`, exact `c === 'solana'`,
non-empty `w` and `d`, HMAC integrity, and token expiry. It returns the expanded field
names.

- [ ] **Step 4: Compare request context and verify the source debit**

Implement constant-shape comparison:

```js
checkUploadToken(paymentId, token, context) {
  if (!paymentId || token !== this.uploadToken(paymentId)) return false;
  const intent = this._parsePaymentId(paymentId);
  return Boolean(intent
    && intent.chain === context.chain
    && intent.sourceAddress === context.sourceAddress
    && intent.storageAddress.toLowerCase() === context.storageAddress.toLowerCase()
    && intent.sizeBytes === Number(context.sizeBytes)
    && intent.expirationMicros === Number(context.expirationMicros));
}
```

In `verify`, require both:

- treasury USDC delta `>= intent.amountMicro`; and
- source wallet USDC delta `>= intent.amountMicro` for `owner === intent.sourceAddress`.

Return `source_mismatch` if no matching source balance exists and `insufficient_source_debit`
if its decrease is too small.

Add `PaymentManager.forTest()` as a narrow factory that builds an object with injected
public values and connection; it must not create a production bypass:

```js
static forTest({ secret, priceBaseUsdc, pricePerMbUsdc, treasury, treasuryAta, mint = USDC_DEVNET, tx = null }) {
  const manager = Object.create(PaymentManager.prototype);
  manager.conn = { getParsedTransaction: async () => tx };
  manager.usdcMint = { toString: () => mint };
  manager.priceBase = priceBaseUsdc;
  manager.pricePerMb = pricePerMbUsdc;
  manager.secret = secret;
  manager.treasury = { publicKey: { toString: () => treasury } };
  manager._ata = { toString: () => treasuryAta };
  return manager;
}
```

Because `_ata` is already populated, the existing `treasuryAta()` method returns this
injected public object without invoking token-address derivation.

- [ ] **Step 5: Validate the Aptos transaction sender before sponsorship**

Refactor `SponsorManager` with injectable test seams that default to the real gas
station and real BCS deserializer:

```js
constructor({ gasStationApiKey, network = 'testnet', gasStationClient, deserialize }) {
  if (!gasStationApiKey && !gasStationClient) throw new Error('SponsorManager requires GAS_STATION_API_KEY');
  const net = network === 'testnet' ? Network.TESTNET : network === 'mainnet' ? Network.MAINNET : Network.TESTNET;
  this.gs = gasStationClient || new GasStationClient({ network: net, apiKey: gasStationApiKey });
  this._deserialize = deserialize || ((txnB64, senderAuthB64) => ({
    transaction: MultiAgentTransaction.deserialize(new Deserializer(Buffer.from(txnB64, 'base64'))),
    senderAuthenticator: AccountAuthenticator.deserialize(new Deserializer(Buffer.from(senderAuthB64, 'base64'))),
  }));
}

deserialize(txnB64, senderAuthB64) {
  return this._deserialize(txnB64, senderAuthB64);
}

async submit(txnB64, senderAuthB64, { expectedSender }) {
  const { transaction, senderAuthenticator } = this.deserialize(txnB64, senderAuthB64);
  const actualSender = transaction.rawTransaction.sender.toString();
  if (actualSender.toLowerCase() !== expectedSender.toLowerCase()) {
    throw Object.assign(new Error('Sponsored transaction sender does not match paid storage identity'), { status: 403, code: 'sender_mismatch' });
  }
  const pending = await this.gs.signAndSubmitTransaction({ transaction, senderAuthenticator });
  return { hash: pending?.hash || pending?.transactionHash };
}
```

Create `test/sponsor.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SponsorManager } from '../src/lib/sponsor.js';

const sender = (value) => ({
  transaction: { rawTransaction: { sender: { toString: () => value } } },
  senderAuthenticator: { kind: 'auth' },
});

test('sponsor rejects a transaction whose sender differs from the paid DAA', async () => {
  let submitted = false;
  const sponsor = new SponsorManager({
    gasStationClient: { signAndSubmitTransaction: async () => { submitted = true; return { hash: '0xhash' }; } },
    deserialize: () => sender('0xattacker'),
  });
  await assert.rejects(
    () => sponsor.submit('txn', 'auth', { expectedSender: '0xpaid' }),
    (error) => error.code === 'sender_mismatch' && error.status === 403,
  );
  assert.equal(submitted, false);
});

test('sponsor submits when transaction sender equals the paid DAA', async () => {
  const sponsor = new SponsorManager({
    gasStationClient: { signAndSubmitTransaction: async () => ({ hash: '0xhash' }) },
    deserialize: () => sender('0xpaid'),
  });
  assert.deepEqual(await sponsor.submit('txn', 'auth', { expectedSender: '0xPAID' }), { hash: '0xhash' });
});
```

- [ ] **Step 6: Enforce request schemas in routes**

`POST /api/pay/quote` requires all context fields and calls `createIntent(context)`.

`POST /api/sponsor/submit` requires:

```js
const context = { chain, sourceAddress, storageAddress, sizeBytes: Number(sizeBytes), expirationMicros: Number(expirationMicros) };
if (!payments.checkUploadToken(paymentId, uploadToken, context)) {
  return send(res, 402, { error: 'payment required for this wallet and file', code: 'unpaid' });
}
const result = await sponsor.submit(String(transaction), String(senderAuthenticator), { expectedSender: context.storageAddress });
```

Client quote, verification, and `uploadSponsored` calls must pass the same immutable
context captured before the payment transaction begins. Abort and clear it when the
wallet session changes.

Create it once in `app.js` and never recompute expiration after payment:

```js
const expirationMicros = Date.now() * 1000 + 7 * 24 * 3600 * 1_000_000;
const uploadContext = {
  chain: 'solana',
  sourceAddress: session.sourceAddress,
  storageAddress: session.storageAddress,
  sizeBytes: file.size,
  expirationMicros,
};
const quote = await api('/api/pay/quote', { method: 'POST', body: uploadContext, signal: pendingWalletWork.signal });
const verified = await api('/api/pay/verify', { method: 'POST', body: { paymentId: quote.paymentId, signature: pay.signature }, signal: pendingWalletWork.signal });
const result = await window.VesselSolana.uploadSponsored(file, {
  paymentId: quote.paymentId,
  uploadToken: verified.uploadToken,
  uploadContext,
  onStep: setStep,
});
```

Extend the existing helper signature to
`api(path, { method = 'GET', body, form, signal } = {})` and assign `opts.signal = signal`
when provided so session invalidation can abort in-flight HTTP work.

Change `uploadSponsored` to use `uploadContext.expirationMicros` as the register
expiration and include every `uploadContext` field in `/api/sponsor/submit`. Reject a
call whose current Solana public key or derived address differs from that context before
opening a wallet signature request.

- [ ] **Step 7: Run payment and server regression tests**

Run: `node --test test/payments.test.js test/sponsor.test.js && npm test`

Expected: payment-binding tests and all existing tests pass.

- [ ] **Step 8: Commit identity-bound sponsorship**

```powershell
git add app/server/src/lib/payments.js app/server/src/lib/sponsor.js app/server/src/index.js app/server/client-src/vessel-solana.js app/server/public/app.js app/server/public/vessel-solana.js app/server/test/payments.test.js app/server/test/sponsor.test.js
git commit -m "fix(payment): bind sponsorship to wallet identity"
```

---

### Task 4: Capability flags, full UI activation, and session invalidation

**Files:**
- Modify: `app/server/src/config.js`
- Modify: `app/server/src/index.js`
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/wallet-modal.js`
- Modify: `app/server/test/wallet-modal.test.js`
- Create: `app/server/test/config.test.js`

**Interfaces:**
- `/api/config.walletFamilies` returns `{ aptos: boolean, solana: boolean, evm: false }`.
- Registry combines provider capability and server family flag before setting `enabled`.
- Session changes emit an invalidation callback consumed by upload/payment UI.

- [ ] **Step 1: Write failing public capability tests**

Create `test/config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('public config exposes wallet families without secrets and keeps EVM disabled', () => {
  const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /walletFamilies/);
  assert.match(source, /evm:\s*false/);
  assert.doesNotMatch(source, /gasStationApiKey:\s*config\.gasStationApiKey/);
  assert.doesNotMatch(source, /paySecret:\s*config\.paySecret/);
});
```

- [ ] **Step 2: Run and confirm the missing capability object**

Run: `node --test test/config.test.js`

Expected: FAIL because `/api/config` has no `walletFamilies`.

- [ ] **Step 3: Add server-controlled family flags**

Add to `config.js`:

```js
walletAptosEnabled: process.env.WALLET_APTOS_ENABLED !== 'false',
walletSolanaEnabled: process.env.WALLET_SOLANA_ENABLED !== 'false',
```

Add to `/api/config`:

```js
walletFamilies: {
  aptos: config.walletAptosEnabled,
  solana: config.walletSolanaEnabled && !!sponsor && !!payments,
  evm: false,
},
```

The registry marks a wallet enabled only when both its feature set and server family
flag are true. A disabled family remains visible with `unavailable` status and an
explanation.

- [ ] **Step 4: Invalidate pending work on wallet change or disconnect**

Add an `AbortController` owned by `app.js` for quote, verify, and sponsor fetches. On any
session identity change:

```js
pendingWalletWork?.abort();
pendingWalletWork = new AbortController();
activeUploadContext = null;
document.querySelector('#pay-gate')?.remove();
window.resetUpload?.();
```

Do not claim an already submitted blockchain transaction was cancelled; only stop
client continuation and stale sponsorship.

- [ ] **Step 5: Finalize account menu and switch-wallet behavior**

The connected-address menu must render the active chain badge, wallet name, source
address, storage address, `SWITCH WALLET`, and `DISCONNECT`. `SWITCH WALLET` closes the
menu and opens the selector. `DISCONNECT` calls both the controller and
`window.VesselSolana.clearProvider()` for DAA sessions.

- [ ] **Step 6: Run full automated verification**

Run: `npm run check`

Expected: all tests pass and both browser bundles build.

- [ ] **Step 7: Commit capability gating and invalidation**

```powershell
git add app/server/src/config.js app/server/src/index.js app/server/client-src/vessel-wallets.js app/server/public/app.js app/server/public/wallet-modal.js app/server/public/vessel-wallets.js app/server/test/wallet-modal.test.js app/server/test/config.test.js
git commit -m "feat(wallet): gate and invalidate wallet sessions"
```

---

### Task 5: Execute the combined live acceptance matrix and record production evidence

**Files:**
- Modify after green runs: `NOTES.md`
- Modify after green runs: `HANDOFF.md`

**Interfaces:**
- Produces a tested compatibility list and exact transaction/payment/blob evidence for each enabled provider.

- [ ] **Step 1: Run repository verification and diff review**

Run:

```powershell
npm run check
git diff --check
git status --short
```

Expected: tests/build pass; no unrelated tracked file is staged; user-owned dirty files
remain untouched.

- [ ] **Step 2: Verify Phantom regression first**

Through the real UI:

1. Select Phantom in the Solana group.
2. Confirm the derived address matches the prior domain derivation for that account.
3. Upload a deterministic small fixture.
4. Record USDC payment signature, Aptos transaction hash, DAA address, Shelby URL, byte
   count, and SHA-256.
5. Confirm HTTP 200 and byte equality.

This must pass before testing additional Solana wallets.

- [ ] **Step 3: Verify every additional compatible installed Solana wallet**

For each provider, record:

```text
Wallet name/version:
Source address:
Derived Aptos address:
USDC payment signature:
Aptos transaction hash:
Shelby URL:
HTTP status:
Input/output SHA-256:
```

Leave a provider visible but `incompatible` if any required signing capability or real
DAA upload step fails.

- [ ] **Step 4: Verify payment-binding attacks are rejected**

Using local test requests only, confirm:

- changing `sourceAddress` after quote returns `402 unpaid`;
- changing `storageAddress`, size, or expiration returns `402 unpaid`;
- using a payment from a different Solana source returns `source_mismatch`; and
- submitting an Aptos transaction with a sender other than the paid DAA returns
  `403 sender_mismatch`.

Do not send a gas-station transaction after any rejected check.

- [ ] **Step 5: Verify shared UX state**

Check:

1. A dual-chain wallet appears once in Aptos and once in Solana.
2. Reload silently restores authorized sessions without a signature popup.
3. Account/network changes reset stale identities and payment panels.
4. Clicking the address opens copy, switch, and disconnect actions.
5. Logout resets every CTA.
6. EVM providers remain disabled Beta.
7. Keyboard-only and 375px mobile flows work.

- [ ] **Step 6: Record evidence and deploy only green families**

Update `NOTES.md` with a provider compatibility table and exact live evidence. Update
`HANDOFF.md` with the final architecture and enabled families. Set any failed family to
disabled before deploy.

Deploy the existing Vercel project only after:

- native Aptos live acceptance is green or explicitly disabled;
- Phantom regression is green;
- each other enabled Solana wallet is green;
- payment mismatch checks are green; and
- the production smoke test repeats one wallet-owned upload.

- [ ] **Step 7: Commit the final evidence**

```powershell
git add NOTES.md HANDOFF.md
git commit -m "docs(wallet): record multi-wallet acceptance"
```

If capability flags changed because a provider family failed, include `src/config.js`,
its test, and the exact failure evidence in the same commit.

---

## Final completion gate for all three plans

Run from `app/server`:

```powershell
npm run check
git diff --check
git status --short
```

Required outcomes:

- Landing says `OPEN DAPP` and `LAUNCH STORAGE APP` and only navigates.
- The dApp selector scans and separates Aptos, Solana, and EVM Beta providers.
- Native Aptos uses the user's own address and direct APT/ShelbyUSD charges.
- Solana uses the selected provider, deterministic Aptos DAA, USDC payment, and
  sponsorship.
- Payment and sponsored transaction context cannot be replayed across identities or
  files.
- The connected-address menu supports copy, switch, and disconnect.
- Reload/account/network/logout states synchronize every CTA.
- All enabled provider families have fresh live evidence.
- Automated tests and both bundles pass.
- The final diff contains no secrets, unrelated edits, or accidental generated files.
