# Vessel Native Aptos Wallet and Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any compatible installed Aptos wallet connect on Aptos Testnet, use its own address as the Shelby storage identity, and upload while paying APT gas and ShelbyUSD directly.

**Architecture:** An Aptos Wallet Standard adapter normalizes connect, silent restore, network switching, account/network events, and transaction submission. Native upload follows Shelby's documented browser sequence: generate commitments, ask the wallet to submit `createRegisterBlobPayload`, wait for confirmation, then call unauthenticated testnet `rpc.putBlob` for the registered bytes. The upload router keeps this direct path isolated from Solana payment and sponsorship routes.

**Tech Stack:** Vanilla JavaScript, `@aptos-labs/wallet-standard@0.5.2`, `@aptos-labs/ts-sdk@5.2.1`, `@shelby-protocol/sdk@0.3.1`, esbuild, Node.js `node:test`, Aptos Testnet, Shelby Testnet.

## Global Constraints

- Complete `2026-08-03-vessel-wallet-foundation.md` first.
- Use the connected Aptos address for both `sourceAddress` and `storageAddress`; never derive a DAA for Aptos-native sessions.
- Require `Network.TESTNET` and chain ID `2` before a session becomes ready.
- Request `aptos:changeNetwork` when available; otherwise expose a manual-switch state and retry action.
- Never call `/api/pay/quote`, `/api/pay/verify`, or `/api/sponsor/submit` for an Aptos-native upload.
- Never call `ShelbyClient.upload()` with a wallet adapter: SDK 0.3.1 types that method as `Account`, which assumes direct signing material.
- Use the official wallet-compatible flow: `generateCommitments` → `ShelbyBlobClient.createRegisterBlobPayload` → wallet `signAndSubmitTransaction` → Aptos `waitForTransaction` → `ShelbyClient.rpc.putBlob`.
- Keep `@aptos-labs/ts-sdk` pinned and overridden at `5.2.1`.
- Use `SHELBYUSD_FA_METADATA_ADDRESS` exported by the installed Shelby SDK rather than hard-coding an asset address.
- Treat balances as a preflight aid; the signed on-chain transaction remains the source of truth for exact fees.
- Do not deploy if a real Aptos wallet cannot register, upload, and read a byte-exact blob under its own address.

---

## File map

- Create `app/server/client-src/wallets/aptos-adapter.js`: Aptos Wallet Standard adapter.
- Create `app/server/client-src/wallets/aptos-upload.js`: balance preflight and documented native upload sequence.
- Create `app/server/client-src/wallets/upload-router.js`: route by `session.mode`.
- Modify `app/server/client-src/vessel-wallets.js`: register Aptos adapters and expose active upload API.
- Modify `app/server/public/app.js`: identity rendering, network state, direct upload branch, funding UI.
- Modify `app/server/public/identity.html`: chain-neutral/native-aware identity copy.
- Modify `app/server/public/upload.html`: native Aptos payment explanation and funding panel hooks.
- Modify `app/server/public/wallet-ui.js`: network-required presentation.
- Create `app/server/test/aptos-adapter.test.js`, `aptos-upload.test.js`, and `upload-router.test.js`.
- Modify `app/server/test/identity.test.js`, `upload.test.js`, and `wallet-ui.test.js`.
- Modify `NOTES.md` and `HANDOFF.md` only after the live probe succeeds.

---

### Task 1: Normalize Aptos Wallet Standard connection and Testnet switching

**Files:**
- Create: `app/server/client-src/wallets/aptos-adapter.js`
- Create: `app/server/test/aptos-adapter.test.js`
- Modify: `app/server/client-src/vessel-wallets.js`

**Interfaces:**
- Consumes descriptor `{ id, name, provider }` where provider implements Aptos Wallet Standard features.
- Produces `createAptosAdapter(descriptor)` with `connect({ silent })`, `ensureNetwork()`, `signAndSubmitTransaction({ data })`, `subscribe(listener)`, and `disconnect()`.
- Produces session `{ chain: 'aptos', walletId, walletName, sourceAddress, sourceNetwork: 'testnet', storageAddress, mode: 'native' }`.
- Throws errors with `code` equal to `user_rejected`, `wrong_network`, `switch_unsupported`, or `provider_unavailable`.

- [ ] **Step 1: Write failing adapter tests**

Create `test/aptos-adapter.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAptosAdapter } from '../client-src/wallets/aptos-adapter.js';

const approved = (args) => ({ status: 'Approved', args });
function wallet({ network = { name: 'testnet', chainId: 2 }, changeNetwork } = {}) {
  const account = { address: { toString: () => '0xabc' } };
  return {
    name: 'Petra',
    features: {
      'aptos:connect': { connect: async () => approved(account) },
      'aptos:disconnect': { disconnect: async () => {} },
      'aptos:account': { account: async () => account },
      'aptos:network': { network: async () => network },
      'aptos:changeNetwork': changeNetwork ? { changeNetwork } : undefined,
      'aptos:onAccountChange': { onAccountChange: async () => {} },
      'aptos:onNetworkChange': { onNetworkChange: async () => {} },
      'aptos:signAndSubmitTransaction': { signAndSubmitTransaction: async ({ payload }) => approved({ hash: payload.function }) },
    },
  };
}

test('native Aptos session uses the wallet address as storage address', async () => {
  const provider = wallet();
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });
  const session = await adapter.connect({ silent: false });
  assert.equal(session.sourceAddress, '0xabc');
  assert.equal(session.storageAddress, '0xabc');
  assert.equal(session.mode, 'native');
});

test('wrong network requests Aptos Testnet when changeNetwork exists', async () => {
  let requested;
  const provider = wallet({
    network: { name: 'mainnet', chainId: 1 },
    changeNetwork: async (input) => { requested = input; return approved({ success: true }); },
  });
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });
  await adapter.connect({ silent: false });
  assert.deepEqual(requested, { name: 'testnet', chainId: 2 });
});

test('wrong network without changeNetwork exposes manual switch state', async () => {
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider: wallet({ network: { name: 'mainnet', chainId: 1 } }) });
  await assert.rejects(() => adapter.connect({ silent: false }), (error) => error.code === 'switch_unsupported');
});
```

- [ ] **Step 2: Run and confirm the missing-module failure**

Run: `node --test test/aptos-adapter.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement Aptos adapter feature calls**

Create `client-src/wallets/aptos-adapter.js`:

```js
import { Network } from '@aptos-labs/ts-sdk';

const TESTNET = { name: Network.TESTNET, chainId: 2 };
const approvedArgs = (response, code = 'user_rejected') => {
  if (response?.status !== 'Approved') throw Object.assign(new Error('Wallet request was rejected'), { code });
  return response.args;
};
const addressOf = (account) => account?.address?.toString?.() || String(account?.address || '');

export function createAptosAdapter(descriptor) {
  const wallet = descriptor.provider;
  const feature = (name) => wallet.features?.[name];
  let session = null;
  const listeners = new Set();

  const ensureNetwork = async () => {
    const current = await feature('aptos:network').network();
    if (String(current.name).toLowerCase() === Network.TESTNET && Number(current.chainId) === 2) return current;
    const changer = feature('aptos:changeNetwork');
    if (!changer?.changeNetwork) throw Object.assign(new Error('Switch your wallet to Aptos Testnet'), { code: 'switch_unsupported' });
    const changed = approvedArgs(await changer.changeNetwork(TESTNET));
    if (!changed.success) throw Object.assign(new Error(changed.reason || 'Unable to switch network'), { code: 'wrong_network' });
    return TESTNET;
  };

  const buildSession = (account) => {
    const address = addressOf(account);
    return { chain: 'aptos', walletId: descriptor.id, walletName: descriptor.name, sourceAddress: address, sourceNetwork: 'testnet', storageAddress: address, mode: 'native' };
  };

  return {
    async connect({ silent = false } = {}) {
      const account = approvedArgs(await feature('aptos:connect').connect(silent, TESTNET));
      await ensureNetwork(); session = buildSession(account); return session;
    },
    ensureNetwork,
    async signAndSubmitTransaction({ data }) {
      return approvedArgs(await feature('aptos:signAndSubmitTransaction').signAndSubmitTransaction({ payload: data }));
    },
    subscribe(listener) {
      listeners.add(listener);
      feature('aptos:onAccountChange').onAccountChange(async (account) => { session = buildSession(account); listener({ session }); });
      feature('aptos:onNetworkChange').onNetworkChange(async (network) => {
        if (String(network.name).toLowerCase() !== Network.TESTNET || Number(network.chainId) !== 2) {
          listener({ session, status: 'network_required', error: 'Switch your wallet to Aptos Testnet' });
        }
      });
      return () => listeners.delete(listener);
    },
    async disconnect() { await feature('aptos:disconnect').disconnect(); session = null; },
  };
}
```

- [ ] **Step 4: Register Aptos descriptors with the adapter resolver**

In `vessel-wallets.js`, keep an `adapters` map keyed by descriptor ID. During `scan()`,
create and cache `createAptosAdapter(descriptor)` for every enabled Aptos row. Resolve
from this map in the session controller.

- [ ] **Step 5: Run adapter, session, and bundle checks**

Run: `node --test test/aptos-adapter.test.js test/wallet-session.test.js && npm run build:client`

Expected: all focused tests pass and the browser bundle builds.

- [ ] **Step 6: Commit Aptos connection**

```powershell
git add app/server/client-src/wallets/aptos-adapter.js app/server/client-src/vessel-wallets.js app/server/public/vessel-wallets.js app/server/test/aptos-adapter.test.js
git commit -m "feat(aptos): connect native wallet sessions"
```

---

### Task 2: Preflight native balances and implement the official three-step upload

**Files:**
- Create: `app/server/client-src/wallets/aptos-upload.js`
- Create: `app/server/test/aptos-upload.test.js`

**Interfaces:**
- Produces `readNativeBalances(address, deps): Promise<{ aptOctas, shelbyUsdUnits }>`.
- Produces `uploadNativeAptos(file, { session, adapter, expiresInSec, onStep, deps })`.
- Upload result `{ key, url, account, size, contentType, ownedByYou: true, paymentMode: 'native-aptos' }`.
- `deps` contains `aptos`, `shelby`, `createProvider`, `generateCommitments`, `expectedTotalChunksets`, `createRegisterPayload`, and `shelbyUsdAsset` so unit tests do not access a network.

- [ ] **Step 1: Write failing balance and upload-sequence tests**

Create `test/aptos-upload.test.js` with deterministic dependencies:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeBalances, uploadNativeAptos } from '../client-src/wallets/aptos-upload.js';

test('balance preflight reads APT and the ShelbyUSD fungible asset', async () => {
  let where;
  const balances = await readNativeBalances('0xabc', {
    shelbyUsdAsset: '0xshelby',
    aptos: {
      getAccountAPTAmount: async () => 123,
      getCurrentFungibleAssetBalances: async ({ options }) => { where = options.where; return [{ amount: '456' }]; },
    },
  });
  assert.deepEqual(balances, { aptOctas: 123, shelbyUsdUnits: 456 });
  assert.deepEqual(where, { owner_address: { _eq: '0xabc' }, asset_type: { _eq: '0xshelby' } });
});

test('native upload registers before RPC byte upload and never calls sponsor APIs', async () => {
  const calls = [];
  const file = { name: 'proof.png', type: 'image/png', size: 3, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  const result = await uploadNativeAptos(file, {
    session: { storageAddress: '0xabc', sourceAddress: '0xabc' },
    adapter: { signAndSubmitTransaction: async ({ data }) => { calls.push(['sign', data]); return { hash: '0xtxn' }; } },
    expiresInSec: 60,
    deps: {
      aptos: {
        getAccountAPTAmount: async () => 100,
        getCurrentFungibleAssetBalances: async () => [{ amount: '100' }],
        waitForTransaction: async ({ transactionHash }) => calls.push(['wait', transactionHash]),
      },
      shelby: { baseUrl: 'https://api.testnet.shelby.xyz/shelby', rpc: { putBlob: async (args) => calls.push(['put', args]) } },
      shelbyUsdAsset: '0xshelby',
      createProvider: async () => ({ config: { chunkSizeBytes: 1, erasure_k: 1 } }),
      generateCommitments: async () => ({ blob_merkle_root: '0xroot', raw_data_size: 3 }),
      expectedTotalChunksets: () => 1,
      createRegisterPayload: (args) => ({ function: 'register', ...args }),
    },
  });
  assert.deepEqual(calls.map(([name]) => name), ['sign', 'wait', 'put']);
  assert.equal(calls[2][1].account, '0xabc');
  assert.equal(result.account, '0xabc');
  assert.equal(result.paymentMode, 'native-aptos');
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run: `node --test test/aptos-upload.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement balance preflight**

Use the installed SDK export in production dependencies:

```js
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import {
  ShelbyBlobClient, ShelbyClient, SHELBYUSD_FA_METADATA_ADDRESS,
  createDefaultErasureCodingProvider, expectedTotalChunksets, generateCommitments,
} from '@shelby-protocol/sdk/browser';

export async function readNativeBalances(address, deps = defaultDeps()) {
  const [aptOctas, rows] = await Promise.all([
    deps.aptos.getAccountAPTAmount({ accountAddress: address }),
    deps.aptos.getCurrentFungibleAssetBalances({ options: { where: {
      owner_address: { _eq: address }, asset_type: { _eq: deps.shelbyUsdAsset },
    } } }),
  ]);
  return { aptOctas: Number(aptOctas || 0), shelbyUsdUnits: Number(rows[0]?.amount || 0) };
}
```

Use this complete dependency constructor:

```js
function defaultDeps() {
  const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
  const shelby = new ShelbyClient({ network: Network.TESTNET });
  return {
    aptos,
    shelby,
    shelbyUsdAsset: SHELBYUSD_FA_METADATA_ADDRESS,
    createProvider: createDefaultErasureCodingProvider,
    generateCommitments,
    expectedTotalChunksets,
    createRegisterPayload: (args) => ShelbyBlobClient.createRegisterBlobPayload(args),
  };
}
```

- [ ] **Step 4: Implement native upload sequencing**

The production function must perform exactly:

```js
export async function uploadNativeAptos(file, { session, adapter, expiresInSec = 7 * 24 * 3600, onStep, deps = defaultDeps() }) {
  assertNativeBalances(await readNativeBalances(session.sourceAddress, deps));
  const blobData = new Uint8Array(await file.arrayBuffer());
  const provider = await deps.createProvider();
  onStep?.('encoding');
  const commitments = await deps.generateCommitments(provider, blobData);
  const expirationMicros = Date.now() * 1000 + expiresInSec * 1_000_000;
  const blobName = await contentAddressedName(file, blobData);
  const payload = deps.createRegisterPayload({
    account: session.storageAddress,
    blobName,
    blobMerkleRoot: commitments.blob_merkle_root,
    numChunksets: deps.expectedTotalChunksets(commitments.raw_data_size),
    expirationMicros,
    blobSize: commitments.raw_data_size,
  });
  onStep?.('signing');
  const submitted = await adapter.signAndSubmitTransaction({ data: payload });
  onStep?.('confirming');
  await deps.aptos.waitForTransaction({ transactionHash: submitted.hash });
  onStep?.('uploading');
  await deps.shelby.rpc.putBlob({ account: session.storageAddress, blobName, blobData });
  return {
    key: blobName,
    url: `${deps.shelby.baseUrl}/v1/blobs/${session.storageAddress}/${blobName}`,
    account: session.storageAddress,
    size: blobData.length,
    contentType: file.type || 'application/octet-stream',
    ownedByYou: true,
    paymentMode: 'native-aptos',
  };
}
```

Use this complete helper so retries do not invent a new key:

```js
async function contentAddressedName(file, blobData) {
  const digest = await crypto.subtle.digest('SHA-256', blobData);
  const sha = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const rawExtension = String(file.name || '').split('.').pop() || 'bin';
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `media/${sha}.${extension}`;
}
```

- [ ] **Step 5: Add explicit insufficient-balance errors**

Export:

```js
export function assertNativeBalances({ aptOctas, shelbyUsdUnits }) {
  if (aptOctas <= 0) throw Object.assign(new Error('APT is required for Aptos transaction gas'), { code: 'insufficient_apt' });
  if (shelbyUsdUnits <= 0) throw Object.assign(new Error('ShelbyUSD is required for storage'), { code: 'insufficient_shelby_usd' });
}
```

Call it before encoding. Do not claim the preflight predicts the exact final fee.

- [ ] **Step 6: Run focused tests and build**

Run: `node --test test/aptos-upload.test.js && npm run build:client`

Expected: balance and sequencing tests pass; browser bundle builds.

- [ ] **Step 7: Commit native upload primitives**

```powershell
git add app/server/client-src/wallets/aptos-upload.js app/server/test/aptos-upload.test.js app/server/public/vessel-wallets.js
git commit -m "feat(aptos): add direct Shelby upload flow"
```

---

### Task 3: Route uploads and render Aptos-native identity and funding states

**Files:**
- Create: `app/server/client-src/wallets/upload-router.js`
- Create: `app/server/test/upload-router.test.js`
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/identity.html`
- Modify: `app/server/public/upload.html`
- Modify: `app/server/public/wallet-ui.js`
- Modify: `app/server/test/identity.test.js`
- Modify: `app/server/test/upload.test.js`
- Modify: `app/server/test/wallet-ui.test.js`

**Interfaces:**
- Produces `createUploadRouter({ aptosUpload, solanaUpload })`.
- Produces `router.upload(file, { session, onStep, expiresInSec })`.
- `window.VesselWallets.upload()` delegates through the router.

- [ ] **Step 1: Write the failing route-isolation test**

Create `test/upload-router.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadRouter } from '../client-src/wallets/upload-router.js';

test('native Aptos routes only to direct upload', async () => {
  const calls = [];
  const router = createUploadRouter({
    aptosUpload: async () => { calls.push('aptos'); return { paymentMode: 'native-aptos' }; },
    solanaUpload: async () => { calls.push('solana'); },
  });
  const result = await router.upload({}, { session: { mode: 'native', chain: 'aptos' } });
  assert.deepEqual(calls, ['aptos']);
  assert.equal(result.paymentMode, 'native-aptos');
});

test('upload refuses a disconnected session', async () => {
  const router = createUploadRouter({ aptosUpload: async () => {}, solanaUpload: async () => {} });
  await assert.rejects(() => router.upload({}, { session: null }), /Connect a wallet/);
});
```

- [ ] **Step 2: Run and confirm the missing-module failure**

Run: `node --test test/upload-router.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the router**

```js
export function createUploadRouter({ aptosUpload, solanaUpload }) {
  return {
    async upload(file, context) {
      const { session } = context;
      if (!session) throw new Error('Connect a wallet before uploading');
      if (session.chain === 'aptos' && session.mode === 'native') return aptosUpload(file, context);
      if (session.chain === 'solana' && session.mode === 'daa') return solanaUpload(file, context);
      throw new Error(`Uploads are unavailable for ${session.chain}`);
    },
  };
}
```

Plan three supplies the generalized `solanaUpload`. Until then, pass the current
`window.VesselSolana` compatibility implementation.

- [ ] **Step 4: Replace page-level Phantom branching with session routing**

In `app.js`:

- if there is no ready session, open the wallet dialog before accepting a file;
- call `window.VesselWallets.upload(file, { onStep: setStep })`;
- map Aptos steps `encoding`, `signing`, `confirming`, `uploading` to the existing progress UI;
- map `insufficient_apt` and `insufficient_shelby_usd` to an Aptos funding panel;
- retain Solana's current USDC gate through the compatibility upload function; and
- call `ledger.commitUpload(result)` only after the routed upload resolves.

Use app-owned DOM creation for the funding panel. The panel must show the connected
address and separate links for the official Aptos Testnet APT faucet and ShelbyUSD
funding instructions, followed by `I'VE FUNDED — RETRY`.

Use this helper instead of dynamic HTML:

```js
function showAptosFundingGate({ code, session, retry }) {
  document.querySelector('#aptos-funding-gate')?.remove();
  const panel = document.createElement('section'); panel.id = 'aptos-funding-gate'; panel.className = 'vessel-glass rounded-vessel p-6 mt-6'; panel.setAttribute('role', 'alert');
  const title = document.createElement('p'); title.className = 'vessel-kicker text-secondary'; title.textContent = code === 'insufficient_apt' ? 'APT REQUIRED FOR GAS' : 'SHELBYUSD REQUIRED FOR STORAGE';
  const detail = document.createElement('p'); detail.className = 'mt-3 text-sm text-on-surface-variant'; detail.textContent = `Fund ${shortMid(session.sourceAddress)} on Aptos Testnet, then retry.`;
  const apt = document.createElement('a'); apt.href = `https://aptos.dev/network/faucet?address=${encodeURIComponent(session.sourceAddress)}`; apt.target = '_blank'; apt.rel = 'noreferrer'; apt.textContent = 'GET TESTNET APT'; apt.className = 'vessel-button vessel-button-secondary';
  const usd = document.createElement('a'); usd.href = 'https://docs.shelby.xyz/apis/faucet/shelbyusd'; usd.target = '_blank'; usd.rel = 'noreferrer'; usd.textContent = 'GET SHELBYUSD'; usd.className = 'vessel-button vessel-button-secondary';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = "I'VE FUNDED — RETRY"; button.className = 'vessel-button vessel-button-primary'; button.addEventListener('click', retry, { once: true });
  const actions = document.createElement('div'); actions.className = 'mt-5 flex flex-wrap gap-3'; actions.append(apt, usd, button);
  panel.append(title, detail, actions); ($('#drop-zone')?.parentElement || document.body).appendChild(panel);
}
```

- [ ] **Step 5: Make identity and upload copy mode-aware**

Change static copy so it describes both valid paths:

```text
Aptos wallets use their own address and pay APT + ShelbyUSD directly.
Solana wallets control a derived Aptos storage account through sponsored DAA.
```

Keep runtime labels:

- `Controlling wallet (Aptos)` and `Native Aptos storage account` for native sessions;
- `Controlling wallet (Solana)` and `Derived Aptos storage account` for DAA sessions.

Update the HTML tests to require both honest payment explanations and remove
Phantom-only assertions.

- [ ] **Step 6: Cover network-required presentation**

Extend `walletPresentation` so `status === 'network_required'` returns:

```js
{
  connected: false,
  headerLabel: 'Switch network',
  headerAria: 'Switch wallet to Aptos Testnet',
  identityLabel: 'SWITCH TO APTOS TESTNET',
  identityDisabled: false,
  chainLabel: 'APTOS',
}
```

The identity button retries `adapter.ensureNetwork()` instead of opening another
connection request.

- [ ] **Step 7: Run all Aptos and UI tests**

Run: `node --test test/aptos-adapter.test.js test/aptos-upload.test.js test/upload-router.test.js test/identity.test.js test/upload.test.js test/wallet-ui.test.js`

Expected: all focused tests pass.

- [ ] **Step 8: Commit routed native UX**

```powershell
git add app/server/client-src/wallets/upload-router.js app/server/client-src/vessel-wallets.js app/server/public/app.js app/server/public/identity.html app/server/public/upload.html app/server/public/wallet-ui.js app/server/public/vessel-wallets.js app/server/test/upload-router.test.js app/server/test/identity.test.js app/server/test/upload.test.js app/server/test/wallet-ui.test.js
git commit -m "feat(aptos): route native wallet uploads"
```

---

### Task 4: Run the native Aptos go/no-go probe and record evidence

**Files:**
- Modify after green probe: `NOTES.md`
- Modify after green probe: `HANDOFF.md`

**Interfaces:**
- Produces recorded Aptos address, transaction hash, Shelby URL, balance deltas, byte count, and byte-equality result.

- [ ] **Step 1: Run the complete automated gate**

Run from `app/server`:

```powershell
npm run check
```

Expected: all tests pass and both bundles build.

- [ ] **Step 2: Start the local app and connect a funded Aptos wallet**

Run: `npm start`

Open Identity and select Petra or another compatible wallet in the Aptos group. Verify
the app requests Testnet when the extension starts on another network and that the
displayed source and storage addresses are identical.

- [ ] **Step 3: Capture before balances and upload a deterministic file**

Use a small non-sensitive fixture with known SHA-256. Record:

```text
Aptos address:
APT before:
ShelbyUSD before:
File SHA-256:
File bytes:
Expiration:
```

Upload through the real UI and approve the wallet transaction.

- [ ] **Step 4: Verify chain registration, namespace, bytes, and fee deltas**

Record:

```text
Transaction hash:
Shelby URL:
HTTP status:
Downloaded bytes:
Downloaded SHA-256:
APT after:
ShelbyUSD after:
```

The gate is green only if:

- the transaction executes successfully;
- the URL namespace exactly equals the connected Aptos address;
- HTTP returns 200;
- byte count and SHA-256 match the input;
- APT decreases; and
- ShelbyUSD decreases according to the network's charge.

- [ ] **Step 5: Record the green result or disable Aptos by configuration**

If green, add a dated `Native Aptos wallet upload` section to `NOTES.md` with the exact
evidence and update `HANDOFF.md` to list the path as live-verified.

If the probe fails, preserve the exact error/transaction evidence in `NOTES.md`, set
the Aptos wallet family to disabled in the public capability configuration, and do not
claim native Aptos support.

- [ ] **Step 6: Commit probe evidence**

For a green run:

```powershell
git add NOTES.md HANDOFF.md
git commit -m "docs(aptos): record native wallet upload proof"
```

For a failed run with Aptos disabled, include the capability configuration and its test
in the same commit with message `fix(aptos): gate unavailable native upload`.

---

## Plan-two completion gate

Run:

```powershell
npm run check
git diff --check
git status --short
```

Required evidence:

- Aptos Wallet Standard discovery and connect are green;
- wrong-network request and manual fallback are tested;
- native Aptos never enters the Solana payment/sponsor routes;
- an Aptos wallet signs the register transaction;
- APT and ShelbyUSD are charged from the user's address;
- the read URL namespace is the same address;
- downloaded bytes match; and
- the live outcome is recorded honestly.

Continue to the Solana adapter and payment-binding plan before production deployment.
