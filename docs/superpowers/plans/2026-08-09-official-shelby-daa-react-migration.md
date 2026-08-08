# Official Shelby DAA React Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Solana and Ethereum wallet-owned Shelby storage flows onto Shelby's official React/browser DAA kit boundary while preserving the current app UI, metadata, batch, gallery, proof, and deployed testnet functionality.

**Architecture:** Add a React island bundle mounted by the existing static app. The island owns official Shelby DAA hook usage and exposes `window.VesselOfficialShelby`; existing vanilla controllers call that interface. Vessel source-chain contracts remain fee settlement only and the UI/server labels them as Vessel fee receipts. Non-Aptos users do not hold APT or ShelbyUSD; Vessel sponsors ShelbyNet gas/storage and recovers those costs through the source-chain Vessel charge.

**Tech Stack:** Vanilla static shell, React island, esbuild IIFE bundles, `@shelby-protocol/solana-kit/react`, `@shelby-protocol/ethereum-kit/react`, `@shelby-protocol/sdk/browser`, Node test runner, Solana Anchor program, EVM Solidity contract, Vercel.

## Global Constraints

- Do not remove Aptos Testnet support or Shelbynet deployment records.
- Do not call Vessel Solana/EVM/Aptos fee contracts "Shelby contracts".
- Do not build NFT minting.
- Do not expose Shelby API keys, gas station keys, quote signer keys, wallet private keys, or recovery secrets to browser bundles.
- Solana and Ethereum DAA/storage must call the official Shelby React hook boundary.
- Vessel fee contracts collect the source-chain Vessel charge and emit fee receipts.
- The source-chain Vessel charge includes Shelby storage cost, sponsored ShelbyNet gas or gas-station cost, and Vessel service fee.
- Solana and EVM users must never be prompted to hold APT or ShelbyUSD.
- Keep existing gallery, metadata designer, folder/batch upload, TokenURI hosting, CSV export, collection detail, and proof pages working.
- Every runtime behavior change needs a failing test before implementation.
- Final verification command is `npm run check` from `D:\Visell\app\server`.

---

## File Structure

- Modify `app/server/package.json` and `app/server/package-lock.json`: add React and official Shelby React dependencies required by the island.
- Modify `app/server/build-client.mjs`: build `client-src/vessel-official-shelby.jsx` to `public/vessel-official-shelby.js`.
- Create `app/server/client-src/official-shelby/bridge.jsx`: React island mount, public `window.VesselOfficialShelby` API, and provider state.
- Create `app/server/client-src/official-shelby/shelby-hooks.jsx`: official hook wrappers for Solana and Ethereum storage accounts.
- Create `app/server/client-src/official-shelby/upload-adapter.js`: adapter that delegates existing paid quote, fee receipt, register, upload, resume, and ledger behavior through the new official DAA session.
- Create `app/server/client-src/vessel-official-shelby.jsx`: island entrypoint.
- Modify `app/server/client-src/vessel-wallets.js`: prefer `window.VesselOfficialShelby` for Solana/EVM DAA while keeping Aptos native path.
- Modify `app/server/public/*.html`: load `vessel-official-shelby.js` before `vessel-wallets.js` on dApp pages.
- Modify `app/server/src/lib/quotes.js`, `app/server/src/lib/settlement/*`, `app/server/public/app.js`, and proof/gallery components only where naming changes from settlement receipt to fee receipt.
- Modify `contracts/solana/vessel-settlement/programs/vessel-settlement/src/*`: introduce fee receipt naming for new IDL/API while preserving existing deployed account compatibility when required.
- Modify `contracts/evm/vessel-settlement/contracts/VesselSettlement.sol`: introduce fee receipt naming and explicit native ETH wei fee semantics.
- Add tests under `app/server/test/official-shelby-*.test.js` and update existing settlement tests.

---

### Task 1: Add the React island bundle without changing runtime behavior

**Files:**
- Modify: `app/server/package.json`
- Modify: `app/server/package-lock.json`
- Modify: `app/server/build-client.mjs`
- Create: `app/server/client-src/vessel-official-shelby.jsx`
- Create: `app/server/client-src/official-shelby/bridge.jsx`
- Test: `app/server/test/official-shelby-bundle.test.js`

**Interfaces:**
- Produces: `window.VesselOfficialShelby` with methods `scanWallets`, `connectWallet`, `disconnect`, `getSession`, `upload`, `resumeUpload`, and `isReady`.
- Consumes: no existing runtime behavior; this task only mounts a no-op bridge.

- [ ] **Step 1: Write the failing bundle test**

Create `app/server/test/official-shelby-bundle.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('official Shelby React island is bundled and loaded before wallet controller', () => {
  const build = readFileSync('build-client.mjs', 'utf8');
  assert.match(build, /client-src\/vessel-official-shelby\.jsx/);
  assert.match(build, /public\/vessel-official-shelby\.js/);

  for (const page of ['identity.html', 'upload.html', 'metadata.html', 'gallery.html']) {
    const html = readFileSync(`public/${page}`, 'utf8');
    const island = html.indexOf('vessel-official-shelby.js');
    const wallets = html.indexOf('vessel-wallets.js');
    assert.ok(island > 0, `${page} loads official Shelby island`);
    assert.ok(wallets > island, `${page} loads wallet controller after official Shelby island`);
  }
});

test('official Shelby island exposes a stable browser API contract', async () => {
  const source = readFileSync('client-src/official-shelby/bridge.jsx', 'utf8');
  for (const method of ['scanWallets', 'connectWallet', 'disconnect', 'getSession', 'upload', 'resumeUpload', 'isReady']) {
    assert.match(source, new RegExp(`${method}\\s*\\(`));
  }
  assert.match(source, /window\.VesselOfficialShelby/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd D:\Visell\app\server
node --test test/official-shelby-bundle.test.js
```

Expected: FAIL because `vessel-official-shelby.jsx`, bridge source, and script tags do not exist.

- [ ] **Step 3: Add dependencies**

Run:

```powershell
cd D:\Visell\app\server
npm install react@19.1.1 react-dom@19.1.1 @tanstack/react-query@5.85.3 @shelby-protocol/react@0.6.0 @solana/react-hooks@1.0.0 viem@2.33.3 --save-exact
```

If `@solana/react-hooks@1.0.0` is unavailable, inspect the version required by Shelby docs/package peer dependencies with:

```powershell
npm view @solana/react-hooks version
```

Then install the exact returned version and record it in the final task note.

- [ ] **Step 4: Implement the no-op island bridge**

Create `app/server/client-src/official-shelby/bridge.jsx`:

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';

let state = {
  ready: false,
  session: null,
  error: '',
};

function notify() {
  window.dispatchEvent(new CustomEvent('vessel:official-shelby-state', {
    detail: { ...state },
  }));
}

function api() {
  return {
    isReady() {
      return state.ready;
    },
    async scanWallets() {
      return [];
    },
    async connectWallet() {
      throw Object.assign(new Error('Official Shelby DAA bridge is not wired yet'), {
        code: 'official_shelby_unavailable',
      });
    },
    async disconnect() {
      state = { ...state, session: null, error: '' };
      notify();
    },
    getSession() {
      return state.session;
    },
    async upload() {
      throw Object.assign(new Error('Official Shelby upload bridge is not wired yet'), {
        code: 'official_shelby_unavailable',
      });
    },
    async resumeUpload() {
      throw Object.assign(new Error('Official Shelby recovery bridge is not wired yet'), {
        code: 'official_shelby_unavailable',
      });
    },
  };
}

function OfficialShelbyBridge() {
  React.useEffect(() => {
    state = { ...state, ready: true };
    window.VesselOfficialShelby = api();
    notify();
  }, []);
  return null;
}

export function mountOfficialShelbyBridge({ document = window.document } = {}) {
  let host = document.getElementById('vessel-official-shelby-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'vessel-official-shelby-root';
    host.hidden = true;
    document.body.appendChild(host);
  }
  createRoot(host).render(<OfficialShelbyBridge />);
  return host;
}
```

Create `app/server/client-src/vessel-official-shelby.jsx`:

```jsx
import { mountOfficialShelbyBridge } from './official-shelby/bridge.jsx';

if (typeof window !== 'undefined') {
  mountOfficialShelbyBridge({ document: window.document });
}
```

- [ ] **Step 5: Add the third bundle**

Modify `app/server/build-client.mjs` so the `Promise.all` includes:

```js
esbuild.build({
  ...sharedBuildOptions,
  entryPoints: ['client-src/vessel-official-shelby.jsx'],
  outfile: 'public/vessel-official-shelby.js',
  loader: { '.jsx': 'jsx' },
}),
```

Add `public/vessel-official-shelby.js` to the post-build whitespace cleanup list.

- [ ] **Step 6: Load the island before wallet controller**

In `app/server/public/identity.html`, `upload.html`, `metadata.html`, and `gallery.html`, add:

```html
<script src="/vessel-official-shelby.js" defer></script>
```

before:

```html
<script src="/vessel-wallets.js" defer></script>
```

- [ ] **Step 7: Verify**

Run:

```powershell
cd D:\Visell\app\server
node --test test/official-shelby-bundle.test.js
npm run build:client
```

Expected: test PASS and build prints `BUNDLE OK` including `vessel-official-shelby.js`.

- [ ] **Step 8: Commit**

```powershell
git add app/server/package.json app/server/package-lock.json app/server/build-client.mjs app/server/client-src/official-shelby app/server/client-src/vessel-official-shelby.jsx app/server/public/*.html app/server/public/vessel-official-shelby.js app/server/test/official-shelby-bundle.test.js
git commit -m "Add official Shelby React island"
```

---

### Task 2: Wrap official Shelby Solana and Ethereum React hooks

**Files:**
- Create: `app/server/client-src/official-shelby/shelby-hooks.jsx`
- Modify: `app/server/client-src/official-shelby/bridge.jsx`
- Test: `app/server/test/official-shelby-hooks.test.js`

**Interfaces:**
- Consumes: bridge API from Task 1.
- Produces: hook-backed session shape `{ chain, mode, sourceNetwork, storageNetwork, sourceAddress, storageAddress, walletName, walletId }`.

- [ ] **Step 1: Write failing hook boundary test**

Create `app/server/test/official-shelby-hooks.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('official hook wrapper imports Shelby Solana and Ethereum React entrypoints', () => {
  const source = readFileSync('client-src/official-shelby/shelby-hooks.jsx', 'utf8');
  assert.match(source, /@shelby-protocol\/solana-kit\/react/);
  assert.match(source, /@shelby-protocol\/ethereum-kit\/react/);
  assert.match(source, /@shelby-protocol\/sdk\/browser/);
});

test('official hook wrapper does not import custom DAA primitives', () => {
  const source = readFileSync('client-src/official-shelby/shelby-hooks.jsx', 'utf8');
  assert.doesNotMatch(source, /derived-wallet-solana/);
  assert.doesNotMatch(source, /derived-wallet-ethereum/);
  assert.doesNotMatch(source, /SolanaDerivedPublicKey/);
  assert.doesNotMatch(source, /EIP1193DerivedPublicKey/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd D:\Visell\app\server
node --test test/official-shelby-hooks.test.js
```

Expected: FAIL because `shelby-hooks.jsx` does not exist.

- [ ] **Step 3: Implement official hook wrapper**

Create `app/server/client-src/official-shelby/shelby-hooks.jsx`:

```jsx
import React from 'react';
import { ShelbyClient } from '@shelby-protocol/sdk/browser';
import {
  Network as ShelbySolanaNetwork,
  useStorageAccount as useSolanaStorageAccount,
} from '@shelby-protocol/solana-kit/react';
import {
  Network as ShelbyEthereumNetwork,
  useStorageAccount as useEthereumStorageAccount,
} from '@shelby-protocol/ethereum-kit/react';

function makeShelbyClient(network) {
  return new ShelbyClient({
    network,
  });
}

export function useOfficialShelbyStorage({ selected }) {
  const solanaClient = React.useMemo(() => makeShelbyClient(ShelbySolanaNetwork.SHELBYNET), []);
  const ethereumClient = React.useMemo(() => makeShelbyClient(ShelbyEthereumNetwork.SHELBYNET), []);
  const solana = useSolanaStorageAccount({
    client: solanaClient,
    wallet: selected?.chain === 'solana' ? selected.wallet : null,
  });
  const ethereum = useEthereumStorageAccount({
    client: ethereumClient,
    wallet: selected?.chain === 'evm' ? selected.wallet : null,
  });

  if (selected?.chain === 'solana') return solana;
  if (selected?.chain === 'evm') return ethereum;
  return {
    storageAccountAddress: null,
    signTransaction: async () => {
      throw new Error('No official Shelby wallet selected');
    },
    submitTransaction: async () => {
      throw new Error('No official Shelby wallet selected');
    },
    signAndSubmitTransaction: async () => {
      throw new Error('No official Shelby wallet selected');
    },
  };
}
```

- [ ] **Step 4: Wire selected wallet state into bridge**

Modify `app/server/client-src/official-shelby/bridge.jsx` to render a component that calls `useOfficialShelbyStorage({ selected })` and stores:

```js
state = {
  ...state,
  storageAccountAddress: storageAccountAddress?.toString?.() || '',
  officialSigner: { signTransaction, submitTransaction, signAndSubmitTransaction },
};
```

The bridge must keep `officialSigner` in module state, not expose it directly through `getSession()`.

- [ ] **Step 5: Verify**

```powershell
cd D:\Visell\app\server
node --test test/official-shelby-hooks.test.js
npm run build:client
```

Expected: test PASS and bundle build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add app/server/client-src/official-shelby app/server/public/vessel-official-shelby.js app/server/test/official-shelby-hooks.test.js
git commit -m "Wrap official Shelby DAA hooks"
```

---

### Task 3: Route Solana DAA through the official Shelby island

**Files:**
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/client-src/official-shelby/bridge.jsx`
- Modify: `app/server/client-src/official-shelby/upload-adapter.js`
- Test: `app/server/test/official-shelby-solana-route.test.js`
- Test: update `app/server/test/wallet-owned-upload.test.js`

**Interfaces:**
- Consumes: `window.VesselOfficialShelby` from Task 1 and official signer from Task 2.
- Produces: Solana session where `storageAddress` comes from official Shelby Solana hook, not `window.VesselSolana.connect`.

- [ ] **Step 1: Write failing route test**

Create `app/server/test/official-shelby-solana-route.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Solana wallet controller prefers official Shelby bridge over legacy DAA client', () => {
  const source = readFileSync('client-src/vessel-wallets.js', 'utf8');
  assert.match(source, /VesselOfficialShelby/);
  assert.doesNotMatch(source, /createSolanaDaaAdapter\(\{/);
});

test('legacy VesselSolana remains only for settlement compatibility and recovery fallback', () => {
  const source = readFileSync('client-src/vessel-wallets.js', 'utf8');
  assert.match(source, /submitContractSettlement/);
  assert.doesNotMatch(source, /daaClient:\s*window\.VesselSolana/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd D:\Visell\app\server
node --test test/official-shelby-solana-route.test.js
```

Expected: FAIL because current controller still creates `createSolanaDaaAdapter({ daaClient: window.VesselSolana })`.

- [ ] **Step 3: Implement Solana provider adapter for official hook**

In `app/server/client-src/official-shelby/bridge.jsx`, normalize selected Solana wallet standard descriptor into the shape required by Shelby Solana Kit React:

```js
function toSolanaKitWallet(descriptor, account) {
  return {
    account: {
      address: {
        toString: () => account.address,
      },
    },
    signMessage: async (message) => {
      const [output] = await descriptor.provider.features['solana:signMessage'].signMessage({
        account,
        message,
      });
      return output.signature;
    },
    signIn: descriptor.provider.features['solana:signIn']?.signIn
      ? (input) => descriptor.provider.features['solana:signIn'].signIn(input)
      : undefined,
  };
}
```

The adapter must only translate wallet shape. It must not derive storage accounts or sign Shelby transactions itself.

- [ ] **Step 4: Implement upload adapter**

Create `app/server/client-src/official-shelby/upload-adapter.js` with functions:

```js
export async function uploadWithOfficialShelby({ file, session, quoteContext, officialSigner }) {
  if (!officialSigner?.signTransaction) {
    throw Object.assign(new Error('Official Shelby signer is not ready'), {
      code: 'official_shelby_unavailable',
    });
  }
  return window.VesselWalletsInternal.uploadPaidWithSigner(file, {
    ...quoteContext,
    session,
    signTransaction: officialSigner.signTransaction,
    submitTransaction: officialSigner.submitTransaction,
    signAndSubmitTransaction: officialSigner.signAndSubmitTransaction,
  });
}
```

If `window.VesselWalletsInternal.uploadPaidWithSigner` does not exist yet, create it by extracting the shared sponsored upload path from `client-src/wallets/evm-upload.js` and `client-src/vessel-solana.js` without changing behavior.

- [ ] **Step 5: Modify wallet controller**

In `app/server/client-src/vessel-wallets.js`:

- remove creation of `createSolanaDaaAdapter`,
- connect Solana through `window.VesselOfficialShelby.connectWallet(wallet.id)`,
- keep `window.VesselSolana.submitContractSettlement` for Solana fee contract submission until Task 6 renames it,
- route Solana upload through `window.VesselOfficialShelby.upload`.

- [ ] **Step 6: Verify**

```powershell
cd D:\Visell\app\server
node --test test/official-shelby-solana-route.test.js test/wallet-owned-upload.test.js test/solana-contract-settlement.test.js
npm run build:client
```

Expected: focused tests PASS and build succeeds.

- [ ] **Step 7: Commit**

```powershell
git add app/server/client-src app/server/public/vessel-wallets.js app/server/public/vessel-official-shelby.js app/server/test/official-shelby-solana-route.test.js app/server/test/wallet-owned-upload.test.js
git commit -m "Route Solana DAA through official Shelby island"
```

---

### Task 4: Route Ethereum DAA through the official Shelby island

**Files:**
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/client-src/official-shelby/bridge.jsx`
- Modify: `app/server/client-src/wallets/evm-adapter.js`
- Test: `app/server/test/official-shelby-ethereum-route.test.js`
- Test: update `app/server/test/evm-daa-adapter.test.js`

**Interfaces:**
- Consumes: official Ethereum hook wrapper from Task 2.
- Produces: Ethereum session where `storageAddress` comes from `@shelby-protocol/ethereum-kit/react`, not direct `EIP1193DerivedPublicKey` usage.

- [ ] **Step 1: Write failing Ethereum route test**

Create `app/server/test/official-shelby-ethereum-route.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Ethereum wallet controller uses official Shelby bridge as primary DAA path', () => {
  const source = readFileSync('client-src/vessel-wallets.js', 'utf8');
  assert.match(source, /VesselOfficialShelby/);
  assert.doesNotMatch(source, /createEvmDaaAdapter\(\{/);
});

test('custom Ethereum DAA primitive is not imported by active wallet controller', () => {
  const source = readFileSync('client-src/vessel-wallets.js', 'utf8');
  assert.doesNotMatch(source, /wallets\/evm-adapter\.js/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd D:\Visell\app\server
node --test test/official-shelby-ethereum-route.test.js
```

Expected: FAIL because current controller imports `createEvmDaaAdapter`.

- [ ] **Step 3: Implement Ethereum wallet adapter for official hook**

In `app/server/client-src/official-shelby/bridge.jsx`, normalize EIP-6963 provider into a viem-compatible wallet client for `@shelby-protocol/ethereum-kit/react`:

```js
import { createWalletClient, custom, sepolia } from 'viem';

function toEthereumKitWallet(provider, account) {
  return createWalletClient({
    account,
    chain: sepolia,
    transport: custom(provider),
  });
}
```

Before selecting Ethereum, ensure chain is Sepolia with:

```js
await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
```

If the wallet does not support switching, return error code `switch_unsupported` with message `Switch your EVM wallet to Sepolia`.

- [ ] **Step 4: Modify wallet controller**

In `app/server/client-src/vessel-wallets.js`:

- remove active import of `createEvmDaaAdapter`,
- connect EVM through `window.VesselOfficialShelby.connectWallet(wallet.id)`,
- keep EVM fee settlement through `submitEvmContractSettlement`,
- upload through `window.VesselOfficialShelby.upload`.

Keep `client-src/wallets/evm-adapter.js` in the repository only as a test/reference fallback if tests still need it. It must not be imported by the active wallet controller.

- [ ] **Step 5: Verify**

```powershell
cd D:\Visell\app\server
node --test test/official-shelby-ethereum-route.test.js test/evm-daa-adapter.test.js test/wallet-owned-upload.test.js
npm run build:client
```

Expected: tests PASS and build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add app/server/client-src app/server/public/vessel-wallets.js app/server/public/vessel-official-shelby.js app/server/test/official-shelby-ethereum-route.test.js app/server/test/evm-daa-adapter.test.js app/server/test/wallet-owned-upload.test.js
git commit -m "Route Ethereum DAA through official Shelby island"
```

---

### Task 5: Rename settlement semantics to Vessel fee receipts in server and UI

**Files:**
- Modify: `app/server/src/lib/settlement/receipt.js`
- Modify: `app/server/src/lib/settlement/adapters.js`
- Modify: `app/server/src/lib/paid-authorizations.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/wallet-owned-upload.js`
- Modify: `app/server/public/gallery.html`
- Modify: `app/server/public/proof.html`
- Test: `app/server/test/fee-receipt-semantics.test.js`

**Interfaces:**
- Consumes: existing settlement adapter normalized receipt.
- Produces: user-visible terminology `Vessel fee receipt` without breaking legacy `settlement` field names in persisted local records.

- [ ] **Step 1: Write failing terminology test**

Create `app/server/test/fee-receipt-semantics.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('user-facing app copy labels source-chain receipts as Vessel fee receipts', () => {
  const files = [
    'public/app.js',
    'public/wallet-owned-upload.js',
    'public/gallery.html',
    'public/proof.html',
  ];
  const text = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.match(text, /Vessel fee receipt/i);
  assert.doesNotMatch(text, /Shelby contract on Solana/i);
  assert.doesNotMatch(text, /Vessel Solana contract is Shelby/i);
});

test('server keeps legacy settlement fields but exports fee receipt terminology', () => {
  const source = readFileSync('src/lib/paid-authorizations.js', 'utf8');
  assert.match(source, /feeReceipt|Vessel fee receipt/);
  assert.match(source, /settlement/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd D:\Visell\app\server
node --test test/fee-receipt-semantics.test.js
```

Expected: FAIL because current copy and server naming still use generic settlement wording.

- [ ] **Step 3: Add non-breaking normalized alias**

In `app/server/src/lib/settlement/receipt.js`, keep the existing object shape but add aliases:

```js
return Object.freeze({
  ...receipt,
  feeReceipt: Object.freeze({
    chain: receipt.chain,
    network: receipt.network,
    deploymentId: receipt.deploymentId,
    quoteId: receipt.quoteId,
    payer: receipt.payer,
    storageAddress: receipt.storageAddress,
    asset: receipt.asset,
    amount: receipt.amount,
    fileHash: receipt.fileHash,
    storageExpirationMicros: receipt.storageExpirationMicros,
    transactionId: receipt.transactionId,
    blockReference: receipt.blockReference,
    finalizedAtMs: receipt.finalizedAtMs,
    configVersion: receipt.configVersion,
  }),
});
```

If `normalizeSettlementReceipt` currently returns directly, refactor it to build `receipt` first, then return with `feeReceipt`.

- [ ] **Step 4: Update UI copy**

Replace user-visible phrases:

- `Settlement receipt` -> `Vessel fee receipt`
- `Contract submitted` -> `Vessel fee submitted`
- `receipt pending` -> `fee receipt pending`
- `settlement evidence` -> `Vessel fee evidence`

Do not rename localStorage keys in this task. Persistent compatibility matters more than internal naming purity.

- [ ] **Step 5: Verify**

```powershell
cd D:\Visell\app\server
node --test test/fee-receipt-semantics.test.js test/paid-authorizations.test.js test/contract-flow.test.js
npm run build:client
```

Expected: tests PASS and build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add app/server/src/lib/settlement app/server/src/lib/paid-authorizations.js app/server/public app/server/test/fee-receipt-semantics.test.js
git commit -m "Label source-chain receipts as Vessel fees"
```

---

### Task 6: Align Solana and EVM contracts with fee-only semantics

**Files:**
- Modify: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/state.rs`
- Modify: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/instructions/settle.rs`
- Modify: `contracts/solana/vessel-settlement/tests/settlement.ts`
- Modify: `contracts/evm/vessel-settlement/contracts/VesselSettlement.sol`
- Modify: `app/server/src/lib/settlement/solana-adapter.js`
- Modify: `app/server/src/lib/settlement/evm-adapter.js`
- Test: `app/server/test/source-chain-fee-contracts.test.js`

**Interfaces:**
- Consumes: quote fields from `ContractQuoteManager`.
- Produces: source-chain contracts that are explicitly fee-settlement-only in names and emitted receipt semantics. The contract amount is the total source-chain Vessel charge, not just the 1% service fee.

- [ ] **Step 1: Write failing source-chain contract semantics test**

Create `app/server/test/source-chain-fee-contracts.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Solana program exposes Vessel fee receipt naming in source', () => {
  const state = readFileSync('../../contracts/solana/vessel-settlement/programs/vessel-settlement/src/state.rs', 'utf8');
  assert.match(state, /VesselFeeReceiptV1/);
  assert.match(state, /VesselFeeReceiptCreatedV1/);
});

test('EVM contract exposes Vessel fee receipt naming and wei payment language', () => {
  const contract = readFileSync('../../contracts/evm/vessel-settlement/contracts/VesselSettlement.sol', 'utf8');
  assert.match(contract, /VesselFeeReceiptV1/);
  assert.match(contract, /sourceChainChargeWei|amountWei|feeWei/);
  assert.doesNotMatch(contract, /SettlementReceiptV1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd D:\Visell\app\server
node --test test/source-chain-fee-contracts.test.js
```

Expected: FAIL because current source names still say `SettlementReceiptV1`.

- [ ] **Step 3: Update Solana source naming**

In `contracts/solana/vessel-settlement/programs/vessel-settlement/src/state.rs`, rename:

```rust
pub struct SettlementReceiptV1
```

to:

```rust
pub struct VesselFeeReceiptV1
```

and:

```rust
pub struct SettlementReceiptCreatedV1
```

to:

```rust
pub struct VesselFeeReceiptCreatedV1
```

Update imports and emit calls in `instructions/settle.rs`. If Anchor discriminator compatibility with the already deployed program is required for the current demo, do not redeploy immediately; instead compile the new program and keep the current deployment manifest pinned until a separate Solana redeploy checkpoint.

- [ ] **Step 4: Update EVM source naming**

In `contracts/evm/vessel-settlement/contracts/VesselSettlement.sol`, rename event:

```solidity
event SettlementReceiptV1(...)
```

to:

```solidity
event VesselFeeReceiptV1(...)
```

Rename quote field local interpretation from `amount` to `feeWei` in comments and emitted event argument names while keeping the ABI tuple compatible if the frontend still sends `amount`.

- [ ] **Step 5: Update adapters for dual event names**

In `app/server/src/lib/settlement/evm-adapter.js`, accept both old and new event names during beta:

```js
.find((event) => ['SettlementReceiptV1', 'VesselFeeReceiptV1'].includes(event?.name));
```

In Solana adapter tests, accept current deployed account struct but expose UI/server terminology as fee receipt.

- [ ] **Step 6: Verify**

```powershell
cd D:\Visell\app\server
node --test test/source-chain-fee-contracts.test.js test/solana-contract-receipt.test.js test/settlement-adapters.test.js test/evm-settlement-contract.test.js
cd D:\Visell\contracts\solana\vessel-settlement
npm test
```

Expected: Node tests PASS. Solana Anchor tests PASS if local toolchain is available; if Anchor CLI is missing, record exact missing command and continue only after `npm run check` still passes.

- [ ] **Step 7: Commit**

```powershell
git add contracts/solana contracts/evm app/server/src/lib/settlement app/server/test/source-chain-fee-contracts.test.js app/server/test/solana-contract-receipt.test.js app/server/test/settlement-adapters.test.js app/server/test/evm-settlement-contract.test.js
git commit -m "Rename source-chain contracts as fee receipts"
```

---

### Task 7: Update product copy, README, and submission wording

**Files:**
- Modify: `app/server/public/index.html`
- Modify: `app/server/public/identity.html`
- Modify: `app/server/public/upload.html`
- Modify: `app/README.md`
- Modify: `README.md` if it exists
- Modify: `docs/notion` files only if they are already tracked or the user explicitly asks to publish Notion copy
- Test: update `app/server/test/landing.test.js`
- Test: update `app/server/test/readme.test.js`

**Interfaces:**
- Consumes: accepted terminology from spec.
- Produces: public copy that says official Shelby DAA/storage and Vessel fee receipt accurately.

- [ ] **Step 1: Write failing copy test**

Add to `app/server/test/landing.test.js`:

```js
test('Landing separates Shelby DAA storage from Vessel fee receipts', () => {
  const html = readFileSync('public/index.html', 'utf8');
  assert.match(html, /Powered by Shelby DAA/i);
  assert.match(html, /Vessel fee receipt/i);
  assert.match(html, /do not need APT or ShelbyUSD/i);
  assert.doesNotMatch(html, /Shelby contract on Solana/i);
});
```

Add to `app/server/test/readme.test.js`:

```js
test('README describes official Shelby DAA and Vessel fee layer separately', () => {
  const readme = readFileSync('../README.md', 'utf8');
  assert.match(readme, /official Shelby DAA/i);
  assert.match(readme, /Vessel fee settlement/i);
  assert.match(readme, /Shelby Storage Account/i);
  assert.match(readme, /Non-Aptos users do not need APT or ShelbyUSD/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd D:\Visell\app\server
node --test test/landing.test.js test/readme.test.js
```

Expected: FAIL until copy is updated.

- [ ] **Step 3: Update landing copy**

Use these exact statements where appropriate:

```text
Powered by Shelby DAA. Live on ShelbyNet with Aptos Testnet retained for maintenance fallback.
```

```text
Your wallet controls a Shelby Storage Account. Vessel contracts only record fee receipts for the service layer.
```

```text
Non-Aptos users do not need APT or ShelbyUSD. Vessel sponsors ShelbyNet gas and storage, then recovers the cost through a source-chain fee receipt.
```

- [ ] **Step 4: Update README architecture section**

Add this paragraph:

```markdown
Vessel separates ownership from payment. Shelby official DAA derives a Shelby Storage Account from the user's Aptos, Solana, or Ethereum wallet, and that storage account owns blobs on ShelbyNet. Non-Aptos users do not need APT or ShelbyUSD. Vessel sponsors ShelbyNet gas and storage, then recovers Shelby storage cost, sponsored gas, and the Vessel service fee through a source-chain fee receipt. Vessel's Aptos, Solana, and EVM contracts are fee settlement layers only: they collect the source-chain Vessel charge into a vault and emit receipts that the server verifies before completing the upload workflow.
```

- [ ] **Step 5: Verify**

```powershell
cd D:\Visell\app\server
node --test test/landing.test.js test/readme.test.js
npm run build:client
```

Expected: tests PASS and build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add app/server/public app/README.md README.md app/server/test/landing.test.js app/server/test/readme.test.js
git commit -m "Clarify Shelby DAA and Vessel fee layer copy"
```

---

### Task 8: Full verification, live smoke, Vercel deploy, and GitHub push

**Files:**
- No planned source edits unless verification exposes a bug.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified production deployment.

- [ ] **Step 1: Run full check**

```powershell
cd D:\Visell\app\server
npm run check
```

Expected: all Node tests pass and client bundles build.

- [ ] **Step 2: Verify production config locally before deploy**

```powershell
cd D:\Visell\app\server
node -e "import('./src/config.js').then(({config})=>console.log(JSON.stringify({shelbyNetwork:config.shelbyNetwork,walletEvmEnabled:config.walletEvmEnabled,contracts:config.settlementContractsEnabled},null,2)))"
```

Expected: no secrets printed, Shelbynet is active, settlement contracts are enabled.

- [ ] **Step 3: Run source-chain live smoke where available**

Run:

```powershell
cd D:\Visell\app\server
node scripts/smoke-evm-settlement.mjs
```

Expected: prints `Verified EVM receipt`.

For Solana, run manual Chrome/Phantom flow because the wallet extension approval is interactive:

1. Open `https://vessel-sage.vercel.app/upload.html` after deploy preview or local server.
2. Connect Phantom on Solana Devnet.
3. Select a small image.
4. Approve Vessel fee transaction.
5. Confirm Gallery shows media URL and proof page.

- [ ] **Step 4: Deploy production**

```powershell
cd D:\Visell
npx vercel --prod --yes
```

Expected: deployment status `READY` and alias `https://vessel-sage.vercel.app`.

- [ ] **Step 5: Verify production public config**

```powershell
node -e "fetch('https://vessel-sage.vercel.app/api/config').then(r=>r.json().then(j=>({ok:r.ok,j}))).then(({ok,j})=>{console.log('ok',ok); console.log('walletFamilies',JSON.stringify(j.walletFamilies)); console.log('shelbyNetwork',j.shelbyNetwork?.displayName); console.log('evmContract',j.settlementContracts?.evm?.contractAddress || 'none');})"
```

Expected:

```text
ok true
walletFamilies {"aptos":true,"solana":true,"evm":true}
shelbyNetwork ShelbyNet
evmContract 0x...
```

- [ ] **Step 6: Push GitHub**

```powershell
cd D:\Visell
git status --short
git push origin main
```

Expected: `main -> main`. Untracked local scratch directories may remain uncommitted if unrelated.
