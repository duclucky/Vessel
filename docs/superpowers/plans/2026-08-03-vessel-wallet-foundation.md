# Vessel Wallet Registry and Session Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build standards-based wallet discovery, one shared wallet session, the centered selector dialog, the connected-address menu, and truthful landing CTAs without changing either upload implementation yet.

**Architecture:** A bundled `window.VesselWallets` facade owns discovery and session state. Framework-agnostic Aptos Wallet Standard, Solana Wallet Standard, and EIP-6963 drivers produce normalized descriptors; DOM modules consume the facade and never call providers directly. This plan leaves the current Phantom upload path operational behind its compatibility API while later plans add native Aptos upload and generalized Solana adapters.

**Tech Stack:** Vanilla JavaScript ES modules, esbuild IIFE browser bundles, Node.js `node:test`, Aptos Wallet Standard 0.5.2, Wallet Standard 1.1.1, existing Tailwind CDN and Vessel Ethereal CSS.

## Global Constraints

- Preserve the current `@aptos-labs/ts-sdk` override at exactly `5.2.1`.
- Pin direct discovery dependencies to versions already proven in the installed tree: `@aptos-labs/wallet-standard@0.5.2`, `@wallet-standard/app@1.1.1`, `@wallet-standard/features@1.1.1`, and `@solana/wallet-standard-features@1.4.0`.
- Keep `window.VesselSolana` and the current Phantom upload behavior operational throughout this plan.
- Landing copy is exactly `OPEN DAPP` in the header and `LAUNCH STORAGE APP` in the hero.
- Landing wallet entries only navigate to `/identity.html`; they never scan, connect, or sign.
- Aptos and Solana descriptors are selectable only after their chain adapters register; EVM descriptors always use disabled Beta status.
- Persist only `vessel.wallet.chain` and `vessel.wallet.id`; never persist signatures, payment tokens, providers, or secrets.
- Render provider names with `textContent` and icons through `<img src>`; never interpolate provider-controlled values into `innerHTML`.
- Preserve user-owned changes in `app/server/.gitignore` and `stitch_guideline_compliance_design (1)/`.

---

## File map

- Create `app/server/client-src/wallets/registry.js`: normalized Aptos, Solana, and EVM discovery.
- Create `app/server/client-src/wallets/session.js`: session state machine, persistence hints, subscriptions, restore, and disconnect.
- Create `app/server/client-src/vessel-wallets.js`: composition root and `window.VesselWallets` facade.
- Create `app/server/public/wallet-modal.js`: accessible modal and connected-address menu.
- Modify `app/server/public/wallet-ui.js`: session-aware labels and chain presentation.
- Modify `app/server/public/app.js`: consume the facade and open wallet surfaces.
- Modify `app/server/public/index.html`: truthful navigation CTA copy.
- Modify `app/server/public/identity.html`, `upload.html`, `gallery.html`, `latency.html`, and `metadata.html`: change dApp wallet anchors to buttons and load the new bundle.
- Modify `app/server/public/vessel.css`: modal, popover, mobile sheet, focus, and reduced-motion styles.
- Modify `app/server/build-client.mjs`: build both wallet and legacy Solana bundles.
- Modify `app/server/package.json` and `package-lock.json`: direct dependency ownership.
- Create `app/server/test/wallet-registry.test.js`, `wallet-session.test.js`, and `wallet-modal.test.js`.
- Modify `app/server/test/wallet-ui.test.js`, `theme-and-landing.test.js`, and `accessibility.test.js`.

---

### Task 1: Own discovery dependencies and produce the wallet bundle

**Files:**
- Modify: `app/server/package.json`
- Modify: `app/server/package-lock.json`
- Modify: `app/server/build-client.mjs`
- Create: `app/server/client-src/vessel-wallets.js`
- Test: `app/server/test/accessibility.test.js`

**Interfaces:**
- Produces: browser bundle `public/vessel-wallets.js`.
- Produces: initial `window.VesselWallets` object with `scan()`, `subscribe()`, `getState()`, `connect()`, `restore()`, and `disconnect()` methods that initially throw a clear composition error until Task 3 wires them.

- [ ] **Step 1: Write the failing bundle contract test**

Add to `test/accessibility.test.js`:

```js
test('wallet bundle source is present and every dApp page loads it before app.js', () => {
  assert.equal(fs.existsSync(path.join(publicDir, 'vessel-wallets.js')), true);
  for (const page of ['identity.html', 'upload.html', 'gallery.html', 'latency.html', 'metadata.html']) {
    const html = readPage(page);
    assert.match(html, /<script src="\/vessel-wallets\.js"><\/script>/, page);
    assert.ok(
      html.indexOf('/vessel-wallets.js') < html.indexOf('/app.js'),
      `${page}: wallet bundle must load before app.js`,
    );
  }
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `npm test -- --test-name-pattern="wallet bundle source"`

Expected: FAIL because `public/vessel-wallets.js` and page script tags do not exist.

- [ ] **Step 3: Pin direct dependencies**

Run from `app/server`:

```powershell
npm install --save-exact @aptos-labs/wallet-standard@0.5.2 @wallet-standard/app@1.1.1 @wallet-standard/features@1.1.1 @solana/wallet-standard-features@1.4.0
```

Expected: `package.json` and `package-lock.json` change; `npm ls` resolves each package once without peer errors.

- [ ] **Step 4: Add the bundle composition entry**

Create `client-src/vessel-wallets.js`:

```js
const notReady = () => { throw new Error('Vessel wallet controller is not initialized'); };

window.VesselWallets = {
  scan: async () => [],
  subscribe: () => () => {},
  getState: () => ({ status: 'disconnected', session: null, wallets: [] }),
  connect: notReady,
  restore: async () => null,
  disconnect: async () => {},
  open: () => window.dispatchEvent(new CustomEvent('vessel:wallet-open')),
};
```

Replace the single build call in `build-client.mjs` with:

```js
const shared = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
    'import.meta.url': 'globalThis.__vesselBase',
  },
  banner: {
    js: 'globalThis.__vesselBase = (typeof location !== "undefined" ? location.origin + "/" : "file:///");',
  },
  plugins: [NodeModulesPolyfillPlugin(), NodeGlobalsPolyfillPlugin({ buffer: true, process: true })],
  logLevel: 'error',
  legalComments: 'none',
};

await Promise.all([
  esbuild.build({ ...shared, entryPoints: ['client-src/vessel-solana.js'], outfile: 'public/vessel-solana.js' }),
  esbuild.build({ ...shared, entryPoints: ['client-src/vessel-wallets.js'], outfile: 'public/vessel-wallets.js' }),
]);
```

Update the success log so it reports both bundle sizes.

- [ ] **Step 5: Add the wallet bundle tag to every dApp page**

Place this after `/vessel-solana.js` where present and immediately before `/app.js` on every non-landing page:

```html
<script src="/vessel-wallets.js"></script>
```

- [ ] **Step 6: Build and run the focused test**

Run: `npm run build:client && npm test -- --test-name-pattern="wallet bundle source"`

Expected: build prints both bundle sizes and the focused test passes.

- [ ] **Step 7: Commit the bundle boundary**

```powershell
git add app/server/package.json app/server/package-lock.json app/server/build-client.mjs app/server/client-src/vessel-wallets.js app/server/public/vessel-wallets.js app/server/public/identity.html app/server/public/upload.html app/server/public/gallery.html app/server/public/latency.html app/server/public/metadata.html app/server/test/accessibility.test.js
git commit -m "build(wallet): add standards registry bundle"
```

---

### Task 2: Discover and normalize Aptos, Solana, and EVM wallets

**Files:**
- Create: `app/server/client-src/wallets/registry.js`
- Create: `app/server/test/wallet-registry.test.js`
- Modify: `app/server/client-src/vessel-wallets.js`

**Interfaces:**
- Consumes: `getAptosWallets()` from `@aptos-labs/wallet-standard` and `getWallets()` from `@wallet-standard/app`.
- Produces: `createWalletRegistry({ aptosSource, standardSource, eventTarget })`.
- Produces: `registry.scan(): Promise<WalletDescriptor[]>` and `registry.subscribe(listener): () => void`.
- Produces descriptor fields `{ id, name, icon, chain, installed, enabled, status, capabilities, provider }`.

- [ ] **Step 1: Write failing normalization and multi-chain tests**

Create `test/wallet-registry.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletRegistry } from '../client-src/wallets/registry.js';

const aptosFeatures = {
  'aptos:account': {}, 'aptos:connect': {}, 'aptos:disconnect': {}, 'aptos:network': {},
  'aptos:onAccountChange': {}, 'aptos:onNetworkChange': {}, 'aptos:signMessage': {},
  'aptos:signTransaction': {}, 'aptos:signAndSubmitTransaction': {},
};
const solanaFeatures = {
  'standard:connect': {}, 'standard:events': {},
  'solana:signMessage': {}, 'solana:signAndSendTransaction': {},
};

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    dispatchEvent: (event) => listeners.get(event.type)?.(event),
  };
}

test('a multi-chain extension appears once in Aptos and once in Solana', async () => {
  const wallet = {
    name: 'Nightly', icon: 'data:image/png;base64,AA==', version: '1.0.0',
    chains: ['aptos:testnet', 'solana:devnet'], features: { ...aptosFeatures, ...solanaFeatures }, accounts: [],
  };
  const registry = createWalletRegistry({
    aptosSource: { get: () => [wallet], on: () => () => {} },
    standardSource: { get: () => [wallet], on: () => () => {} },
    eventTarget: eventTarget(),
  });
  const rows = await registry.scan();
  assert.deepEqual(rows.map(({ chain, name }) => ({ chain, name })), [
    { chain: 'aptos', name: 'Nightly' },
    { chain: 'solana', name: 'Nightly' },
  ]);
});

test('EIP-6963 providers are visible but disabled Beta', async () => {
  const target = eventTarget();
  const registry = createWalletRegistry({
    aptosSource: { get: () => [], on: () => () => {} },
    standardSource: { get: () => [], on: () => () => {} },
    eventTarget: target,
  });
  target.dispatchEvent({ type: 'eip6963:announceProvider', detail: {
    info: { uuid: '2c40a1f7-9df0-4592-87bf-70f50bb6f36e', name: 'MetaMask', icon: 'data:image/png;base64,AA==', rdns: 'io.metamask' },
    provider: { request: async () => [] },
  } });
  const rows = await registry.scan();
  assert.equal(rows[0].chain, 'evm');
  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].status, 'beta');
});
```

- [ ] **Step 2: Run the registry test and confirm it fails**

Run: `node --test test/wallet-registry.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `client-src/wallets/registry.js`.

- [ ] **Step 3: Implement the registry**

Create `client-src/wallets/registry.js` with these exported rules:

```js
const SOLANA_REQUIRED = ['standard:connect', 'standard:events', 'solana:signMessage', 'solana:signAndSendTransaction'];
const APTOS_REQUIRED = ['aptos:connect', 'aptos:disconnect', 'aptos:network', 'aptos:onAccountChange', 'aptos:onNetworkChange', 'aptos:signAndSubmitTransaction'];

const hasAll = (wallet, names) => names.every((name) => name in (wallet.features || {}));
const idFor = (chain, wallet) => `${chain}:${wallet.name}:${wallet.version || '1'}`.toLowerCase();

export function createWalletRegistry({ aptosSource, standardSource, eventTarget }) {
  const evm = new Map();
  const listeners = new Set();
  const announce = (event) => {
    const { info, provider } = event.detail || {};
    if (!info?.uuid || !provider) return;
    evm.set(info.uuid, { info, provider });
    listeners.forEach((listener) => listener());
  };
  eventTarget.addEventListener('eip6963:announceProvider', announce);
  eventTarget.dispatchEvent(new Event('eip6963:requestProvider'));

  const scan = async () => {
    const aptos = aptosSource.get().filter((wallet) => hasAll(wallet, APTOS_REQUIRED)).map((wallet) => ({
      id: idFor('aptos', wallet), name: wallet.name, icon: wallet.icon, chain: 'aptos', installed: true,
      enabled: true, status: 'ready', capabilities: APTOS_REQUIRED, provider: wallet,
    }));
    const solana = standardSource.get()
      .filter((wallet) => wallet.chains?.some((chain) => String(chain).startsWith('solana:')))
      .map((wallet) => ({
        id: idFor('solana', wallet), name: wallet.name, icon: wallet.icon, chain: 'solana', installed: true,
        enabled: hasAll(wallet, SOLANA_REQUIRED), status: hasAll(wallet, SOLANA_REQUIRED) ? 'ready' : 'incompatible',
        capabilities: SOLANA_REQUIRED.filter((name) => name in (wallet.features || {})), provider: wallet,
      }));
    const ethereum = [...evm.values()].map(({ info, provider }) => ({
      id: `evm:${info.uuid}`, name: info.name, icon: info.icon, chain: 'evm', installed: true,
      enabled: false, status: 'beta', capabilities: [], provider,
    }));
    return [...aptos, ...solana, ...ethereum].filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index);
  };

  const offAptos = aptosSource.on('register', () => listeners.forEach((listener) => listener()));
  const offStandard = standardSource.on('register', () => listeners.forEach((listener) => listener()));
  return {
    scan,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { offAptos?.(); offStandard?.(); eventTarget.removeEventListener('eip6963:announceProvider', announce); },
  };
}
```

When composing the real sources in `vessel-wallets.js`, make Aptos discovery dynamic:

```js
const standardSource = getWallets();
const aptosSource = {
  get: () => getAptosWallets().aptosWallets,
  on: standardSource.on.bind(standardSource),
};
```

After each scan, the composition root must set `enabled` to `false` and status to
`unavailable` unless an adapter is registered for that descriptor ID. During this plan,
register only a temporary Phantom compatibility adapter; plan two enables Aptos rows and
plan three enables the remaining compatible Solana rows. EVM remains Beta regardless.

- [ ] **Step 4: Run registry tests and rebuild**

Run: `node --test test/wallet-registry.test.js && npm run build:client`

Expected: two registry tests pass and both bundles build.

- [ ] **Step 5: Commit discovery**

```powershell
git add app/server/client-src/wallets/registry.js app/server/client-src/vessel-wallets.js app/server/public/vessel-wallets.js app/server/test/wallet-registry.test.js
git commit -m "feat(wallet): discover installed wallet standards"
```

---

### Task 3: Implement the shared session state machine

**Files:**
- Create: `app/server/client-src/wallets/session.js`
- Create: `app/server/test/wallet-session.test.js`
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/public/wallet-ui.js`
- Modify: `app/server/test/wallet-ui.test.js`

**Interfaces:**
- Consumes: registry descriptors and `resolveAdapter(descriptor)`.
- Produces: `createWalletController({ registry, resolveAdapter, storage })`.
- Produces state `{ status, wallets, session, error }` and session `{ chain, walletId, walletName, sourceAddress, sourceNetwork, storageAddress, mode }`.
- Produces adapter contract `{ connect({ silent }), disconnect(), subscribe(listener) }`, where listener events have shape `{ session, status?, error? }`.

- [ ] **Step 1: Write failing session tests**

Create `test/wallet-session.test.js` with tests that prove:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletController } from '../client-src/wallets/session.js';

function storage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
}

test('connect persists only wallet id and chain and publishes one session', async () => {
  const store = storage();
  const descriptor = { id: 'solana:phantom:1', chain: 'solana', enabled: true };
  const registry = { scan: async () => [descriptor], subscribe: () => () => {} };
  const controller = createWalletController({
    registry, storage: store,
    resolveAdapter: () => ({
      connect: async () => ({ chain: 'solana', walletId: descriptor.id, walletName: 'Phantom', sourceAddress: 'SOL', sourceNetwork: 'devnet', storageAddress: '0xDAA', mode: 'daa' }),
      disconnect: async () => {}, subscribe: () => () => {},
    }),
  });
  await controller.scan();
  await controller.connect(descriptor.id);
  assert.equal(controller.getState().session.storageAddress, '0xDAA');
  assert.equal(store.getItem('vessel.wallet.id'), descriptor.id);
  assert.equal(store.getItem('vessel.wallet.chain'), 'solana');
  assert.equal(store.getItem('vessel.wallet.session'), null);
});

test('restore uses silent connection and disconnect clears hints', async () => {
  const store = storage();
  store.setItem('vessel.wallet.id', 'aptos:petra:1'); store.setItem('vessel.wallet.chain', 'aptos');
  let silent;
  const descriptor = { id: 'aptos:petra:1', chain: 'aptos', enabled: true };
  const controller = createWalletController({
    registry: { scan: async () => [descriptor], subscribe: () => () => {} }, storage: store,
    resolveAdapter: () => ({ connect: async (input) => { silent = input.silent; return null; }, disconnect: async () => {}, subscribe: () => () => {} }),
  });
  await controller.restore();
  assert.equal(silent, true);
  assert.equal(controller.getState().status, 'disconnected');
  await controller.disconnect();
  assert.equal(store.getItem('vessel.wallet.id'), null);
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run: `node --test test/wallet-session.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `createWalletController`**

The implementation must:

```js
const KEYS = { id: 'vessel.wallet.id', chain: 'vessel.wallet.chain' };

export function createWalletController({ registry, resolveAdapter, storage }) {
  let state = { status: 'disconnected', wallets: [], session: null, error: '' };
  let activeAdapter = null;
  let offAdapter = null;
  const listeners = new Set();
  const publish = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn(state)); };
  const scan = async () => { publish({ status: 'scanning' }); const wallets = await registry.scan(); publish({ wallets, status: state.session ? 'ready' : 'disconnected' }); return wallets; };
  const connect = async (walletId, { silent = false } = {}) => {
    const descriptor = state.wallets.find((wallet) => wallet.id === walletId);
    if (!descriptor?.enabled) throw new Error('Wallet is not available for connection');
    publish({ status: 'connecting', error: '' });
    try {
      activeAdapter = resolveAdapter(descriptor);
      const session = await activeAdapter.connect({ silent });
      if (!session) { publish({ status: 'disconnected', session: null }); return null; }
      storage.setItem(KEYS.id, descriptor.id); storage.setItem(KEYS.chain, descriptor.chain);
      offAdapter?.();
      offAdapter = activeAdapter.subscribe((event) => {
        if (event?.status === 'network_required') return publish({ status: 'network_required', session: event.session || state.session, error: event.error || '' });
        if (event?.session) return publish({ session: event.session, status: 'ready', error: '' });
        return disconnect();
      });
      publish({ session, status: 'ready' });
      return session;
    } catch (error) {
      const networkRequired = ['wrong_network', 'switch_unsupported'].includes(error?.code);
      publish({ status: networkRequired ? 'network_required' : 'error', session: null, error: error?.message || String(error) });
      throw error;
    }
  };
  const restore = async () => { await scan(); const id = storage.getItem(KEYS.id); if (!id) return null; try { return await connect(id, { silent: true }); } catch { if (state.status !== 'network_required') publish({ status: 'disconnected', session: null }); return null; } };
  const disconnect = async () => { offAdapter?.(); offAdapter = null; await activeAdapter?.disconnect?.(); activeAdapter = null; storage.removeItem(KEYS.id); storage.removeItem(KEYS.chain); publish({ status: 'disconnected', session: null, error: '' }); };
  return { scan, connect, restore, disconnect, getState: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
```

Wire it into `vessel-wallets.js` with a temporary `resolveAdapter` that returns a clear
`Wallet adapter for <chain> is not active` error. Plans two and three replace that
resolver with native adapters.

- [ ] **Step 4: Make wallet presentation session-aware**

Change the public presentation API to:

```js
export function walletPresentation({ status = 'disconnected', session = null } = {}) {
  const connected = status === 'ready' && Boolean(session?.sourceAddress);
  const shortAddress = shortWallet(session?.sourceAddress || '');
  const chainLabel = session?.mode === 'daa' ? 'SOLANA DAA' : 'APTOS';
  return {
    connected,
    headerLabel: connected ? shortAddress : 'Connect',
    headerAria: connected ? `Wallet ${shortAddress} connected on ${chainLabel}` : 'Connect wallet',
    identityLabel: connected ? 'CONNECTED — STORAGE READY' : 'CONNECT WALLET — OWN YOUR STORAGE',
    identityDisabled: connected,
    chainLabel: connected ? chainLabel : '',
  };
}
```

Update `wallet-ui.test.js` fixtures from `{ address, verified }` to `{ status, session }`
and assert the Aptos and Solana labels separately.

- [ ] **Step 5: Run session and presentation tests**

Run: `node --test test/wallet-session.test.js test/wallet-ui.test.js`

Expected: all focused tests pass.

- [ ] **Step 6: Commit session state**

```powershell
git add app/server/client-src/wallets/session.js app/server/client-src/vessel-wallets.js app/server/public/wallet-ui.js app/server/public/vessel-wallets.js app/server/test/wallet-session.test.js app/server/test/wallet-ui.test.js
git commit -m "feat(wallet): centralize wallet session state"
```

---

### Task 4: Build the accessible wallet dialog and address menu

**Files:**
- Create: `app/server/public/wallet-modal.js`
- Create: `app/server/test/wallet-modal.test.js`
- Modify: `app/server/public/vessel.css`
- Modify: `app/server/public/app.js`

**Interfaces:**
- Consumes: `window.VesselWallets` facade.
- Produces: `mountWalletUi({ controller, document })` and `openWalletDialog()`.
- Produces DOM hooks `#wallet-dialog`, `#wallet-dialog-error`, `#wallet-groups`, and `#wallet-account-menu`.

- [ ] **Step 1: Write failing static accessibility contracts**

Create `test/wallet-modal.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicDir } from './html-test-utils.js';

test('wallet UI declares dialog, live error, safe icons, switch, and disconnect contracts', () => {
  const source = fs.readFileSync(path.join(publicDir, 'wallet-modal.js'), 'utf8');
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /SWITCH WALLET/);
  assert.match(source, /DISCONNECT/);
  assert.match(source, /document\.createElement\('img'\)/);
  assert.doesNotMatch(source, /row\.innerHTML/);
});
```

- [ ] **Step 2: Run and confirm the missing-file failure**

Run: `node --test test/wallet-modal.test.js`

Expected: FAIL with `ENOENT` for `public/wallet-modal.js`.

- [ ] **Step 3: Implement modal shell and safe wallet rows**

Create `public/wallet-modal.js` with a static, app-owned shell and provider-controlled
values assigned only through DOM properties:

```js
const GROUP_LABELS = { aptos: 'APTOS', solana: 'SOLANA', evm: 'EVM · BETA' };

export function mountWalletUi({ controller, document }) {
  const host = document.createElement('div');
  host.innerHTML = `<div id="wallet-backdrop" class="wallet-backdrop hidden">
    <section id="wallet-dialog" class="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title">
      <header class="wallet-dialog-header"><div><p class="vessel-kicker text-primary">Wallet identity</p><h2 id="wallet-dialog-title">Connect a wallet</h2></div><button type="button" data-wallet-close aria-label="Close wallet dialog">×</button></header>
      <p id="wallet-dialog-error" class="wallet-dialog-error" aria-live="polite"></p>
      <div id="wallet-groups"></div>
      <button type="button" data-wallet-rescan class="vessel-button vessel-button-secondary">SCAN AGAIN</button>
    </section></div>
    <section id="wallet-account-menu" class="wallet-account-menu hidden" aria-label="Connected wallet menu"></section>`;
  document.body.appendChild(host);
  const backdrop = host.querySelector('#wallet-backdrop');
  const groups = host.querySelector('#wallet-groups');
  let opener = null;

  const renderRows = (wallets) => {
    groups.replaceChildren();
    for (const chain of ['aptos', 'solana', 'evm']) {
      const section = document.createElement('section');
      const title = document.createElement('h3'); title.textContent = GROUP_LABELS[chain]; section.appendChild(title);
      for (const wallet of wallets.filter((item) => item.chain === chain)) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'wallet-row'; row.disabled = !wallet.enabled;
        const icon = document.createElement('img'); icon.src = wallet.icon; icon.alt = '';
        const name = document.createElement('span'); name.textContent = wallet.name;
        const status = document.createElement('span'); status.textContent = wallet.status === 'beta' ? 'BETA' : wallet.status.toUpperCase();
        row.append(icon, name, status); row.addEventListener('click', () => controller.connect(wallet.id)); section.appendChild(row);
      }
      groups.appendChild(section);
    }
  };
  const open = async (button) => { opener = button || document.activeElement; backdrop.classList.remove('hidden'); renderRows(await controller.scan()); host.querySelector('[data-wallet-close]').focus(); };
  const close = () => { backdrop.classList.add('hidden'); opener?.focus?.(); };
  host.querySelector('[data-wallet-close]').addEventListener('click', close);
  host.querySelector('[data-wallet-rescan]').addEventListener('click', async () => renderRows(await controller.scan()));
  return { open, close, renderRows };
}
```

Extend this same module before committing so it:

- traps `Tab` inside visible dialog focusables;
- closes on `Escape` only when controller status is not `connecting`;
- renders the account menu with wallet name, source address, storage address, copy
  buttons, `SWITCH WALLET`, and `DISCONNECT`;
- writes errors with `textContent` into `#wallet-dialog-error`; and
- returns focus to the opener on close.

Use these concrete helpers:

```js
const focusable = (root) => [...root.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
function trapTab(event, root) {
  if (event.key !== 'Tab') return;
  const items = focusable(root); if (!items.length) return;
  const first = items[0]; const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function appendCopyRow(document, menu, label, value) {
  const row = document.createElement('div'); row.className = 'wallet-account-row';
  const text = document.createElement('div');
  const title = document.createElement('span'); title.className = 'vessel-kicker'; title.textContent = label;
  const address = document.createElement('code'); address.textContent = value;
  const copy = document.createElement('button'); copy.type = 'button'; copy.setAttribute('aria-label', `Copy ${label.toLowerCase()}`); copy.textContent = 'COPY';
  copy.addEventListener('click', () => navigator.clipboard.writeText(value));
  text.append(title, address); row.append(text, copy); menu.appendChild(row);
}

function renderAccountMenu(document, menu, session, controller, openDialog) {
  menu.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = `${session.walletName} · ${session.mode === 'daa' ? 'SOLANA DAA' : 'APTOS'}`;
  menu.appendChild(heading);
  appendCopyRow(document, menu, 'Wallet address', session.sourceAddress);
  appendCopyRow(document, menu, 'Shelby storage address', session.storageAddress);
  const switchButton = document.createElement('button'); switchButton.type = 'button'; switchButton.textContent = 'SWITCH WALLET';
  const disconnectButton = document.createElement('button'); disconnectButton.type = 'button'; disconnectButton.textContent = 'DISCONNECT';
  switchButton.addEventListener('click', () => { menu.classList.add('hidden'); openDialog(switchButton); });
  disconnectButton.addEventListener('click', async () => { await controller.disconnect(); menu.classList.add('hidden'); });
  menu.append(switchButton, disconnectButton);
}
```

Bind `keydown` on the dialog to `trapTab`, and handle `Escape` by reading
`controller.getState().status`. If no enabled Aptos or Solana row exists, append an
app-owned empty state with links to `https://petra.app/` and
`https://phantom.com/download`; provider values are not used to construct those links.

- [ ] **Step 4: Add responsive Ethereal styles**

Add named classes to `vessel.css` for `.wallet-backdrop`, `.wallet-dialog`,
`.wallet-row`, `.wallet-account-menu`, focus-visible rings, a desktop popover, a mobile
bottom sheet below 640px, internal `max-height: calc(100dvh - 32px)` scrolling, and a
`prefers-reduced-motion` override. Keep every row at least 56px high.

Add this concrete baseline and extend only with existing semantic Vessel tokens:

```css
.wallet-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 16px; background: rgb(3 5 10 / .78); backdrop-filter: blur(16px); }
.wallet-backdrop.hidden, .wallet-account-menu.hidden { display: none; }
.wallet-dialog { width: min(560px, 100%); max-height: calc(100dvh - 32px); overflow: auto; border: 1px solid rgb(255 255 255 / .1); border-radius: 28px; background: rgb(17 19 24 / .96); padding: 24px; box-shadow: 0 32px 96px rgb(0 0 0 / .55); }
.wallet-dialog-header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.wallet-dialog-error { min-height: 24px; color: #ffb4ab; }
.wallet-row { display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: 12px; width: 100%; min-height: 56px; margin-top: 8px; padding: 8px 12px; border: 1px solid rgb(255 255 255 / .08); border-radius: 16px; text-align: left; }
.wallet-row img { width: 40px; height: 40px; border-radius: 12px; object-fit: cover; }
.wallet-row:disabled { cursor: not-allowed; opacity: .48; }
.wallet-row:focus-visible, .wallet-dialog button:focus-visible, .wallet-account-menu button:focus-visible { outline: 2px solid #5ee6ff; outline-offset: 3px; }
.wallet-account-menu { position: fixed; z-index: 10001; top: 112px; right: 32px; width: min(420px, calc(100vw - 32px)); border: 1px solid rgb(255 255 255 / .1); border-radius: 24px; background: rgb(17 19 24 / .98); padding: 20px; box-shadow: 0 24px 72px rgb(0 0 0 / .5); }
.wallet-account-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; }
.wallet-account-row code { display: block; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 639px) { .wallet-account-menu { inset: auto 0 0; width: 100%; border-radius: 24px 24px 0 0; padding-bottom: calc(20px + env(safe-area-inset-bottom)); } }
@media (prefers-reduced-motion: reduce) { .wallet-backdrop, .wallet-dialog, .wallet-row, .wallet-account-menu { scroll-behavior: auto; transition: none !important; } }
```

- [ ] **Step 5: Mount the wallet UI from `app.js`**

Import and mount once:

```js
import { mountWalletUi } from './wallet-modal.js';

let walletUi;
function walletController() { return window.VesselWallets; }

document.addEventListener('DOMContentLoaded', async () => {
  walletUi = mountWalletUi({ controller: walletController(), document });
  window.addEventListener('vessel:wallet-open', (event) => walletUi.open(event.detail?.opener));
  await walletController().restore();
  walletController().subscribe(() => renderWallet());
  renderWallet();
  const p = page();
  ({ index: initLanding, identity: initIdentity, upload: initUpload, gallery: initGallery, latency: initLatency, metadata: initMetadata }[p] || (() => {}))();
});
```

- [ ] **Step 6: Run modal, parse, and accessibility tests**

Run: `node --test test/wallet-modal.test.js test/accessibility.test.js`

Expected: all focused tests pass and `node --check public/wallet-modal.js` succeeds.

- [ ] **Step 7: Commit wallet surfaces**

```powershell
git add app/server/public/wallet-modal.js app/server/public/vessel.css app/server/public/app.js app/server/test/wallet-modal.test.js app/server/test/accessibility.test.js
git commit -m "feat(wallet): add accessible wallet selector"
```

---

### Task 5: Make landing navigation truthful and wire dApp wallet actions

**Files:**
- Modify: `app/server/public/index.html`
- Modify: `app/server/public/identity.html`
- Modify: `app/server/public/upload.html`
- Modify: `app/server/public/gallery.html`
- Modify: `app/server/public/latency.html`
- Modify: `app/server/public/metadata.html`
- Modify: `app/server/public/app.js`
- Modify: `app/server/test/theme-and-landing.test.js`
- Modify: `app/server/test/accessibility.test.js`

**Interfaces:**
- Consumes: `walletUi.open(button)` and session-aware `renderWallet()`.
- Produces: `.js-connect` dApp buttons that open the dialog when disconnected and the account menu when connected.

- [ ] **Step 1: Tighten the landing and dApp-button tests**

Replace the landing wallet-entry test with assertions that both links still point to
Identity and have the exact labels:

```js
test('Landing CTAs describe navigation and route to Identity', () => {
  const entries = getLinks(readPage('index.html')).filter((link) => /data-dapp-entry/.test(link.attrs));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((link) => link.href), ['/identity.html', '/identity.html']);
  assert.deepEqual(entries.map((link) => link.text.toUpperCase()), ['OPEN DAPP', 'LAUNCH STORAGE APP']);
  assert.doesNotMatch(readPage('index.html'), /data-wallet-summary|connect wallet to start/i);
});
```

Add an accessibility assertion that each non-landing page contains a real button with
`data-wallet-summary` and not an anchor to `#sign-btn`.

- [ ] **Step 2: Run the tests and confirm old copy fails**

Run: `node --test test/theme-and-landing.test.js test/accessibility.test.js`

Expected: FAIL because landing still says Connect and dApp headers still use anchors.

- [ ] **Step 3: Change the landing CTAs**

Use exactly:

```html
<a class="vessel-button vessel-button-secondary px-4 md:px-6" data-dapp-entry href="/identity.html" aria-label="Open dApp"><span class="material-symbols-outlined text-lg" aria-hidden="true">apps</span><span class="hidden sm:inline">OPEN DAPP</span></a>
```

and:

```html
<a class="vessel-button vessel-button-primary mt-10 px-7 py-4 sm:px-9" data-dapp-entry href="/identity.html"><span class="material-symbols-outlined text-xl" aria-hidden="true">rocket_launch</span>LAUNCH STORAGE APP</a>
```

- [ ] **Step 4: Change wallet anchors to buttons on all dApp pages**

Use this shared contract while preserving per-page visual classes:

```html
<button type="button" class="js-connect vessel-button vessel-button-secondary px-4 md:px-6" data-wallet-summary aria-label="Connect wallet"><span class="material-symbols-outlined text-lg" aria-hidden="true">account_balance_wallet</span><span class="hidden sm:inline" data-wallet-label>Connect</span></button>
```

In `renderWallet()`, attach one click handler that opens the selector when no session is
ready and opens the connected-address menu otherwise. Remove the old MetaMask
`connectWallet()` and `proveOwnership()` path from `app.js` and from `window.Vessel`.
Replace the old Identity branch with this session-only rendering so no deleted function
remains referenced:

```js
function renderIdentitySession(session) {
  const origin = $('#origin-wallet');
  const storage = $('#derived-account');
  if (origin) origin.textContent = session ? shortMid(session.sourceAddress) : '—';
  if (storage) storage.textContent = session ? shortMid(session.storageAddress) : '(connect wallet)';
  const status = $('#auth-status');
  if (status) status.textContent = session ? 'Wallet connected · storage identity ready' : 'Choose an Aptos or Solana wallet';
  window.__storageSolana = session?.chain === 'solana' ? session.sourceAddress : '';
  window.__storageAcct = session?.storageAddress || '';
}

async function initIdentity() {
  renderIdentitySession(walletController().getState().session);
  walletController().subscribe((next) => renderIdentitySession(next.session));
  const signButton = $('#sign-btn');
  if (signButton) signButton.onclick = (event) => {
    event.preventDefault();
    if (!walletController().getState().session) walletUi.open(signButton);
  };
  $$('.js-copy-origin').forEach((button) => { button.onclick = () => copy(walletController().getState().session?.sourceAddress || ''); });
  $$('.js-copy-derived').forEach((button) => { button.onclick = () => copy(walletController().getState().session?.storageAddress || ''); });
}
```

Register a temporary Phantom compatibility adapter in `vessel-wallets.js` only when the
descriptor is Solana, its name is Phantom, and `window.VesselSolana.available()` is true.
It calls the existing `window.VesselSolana.connect()` and returns a DAA session. All
other provider rows stay visible but unavailable until their dedicated plans execute.

- [ ] **Step 5: Run the full foundation verification**

Run: `npm run check`

Expected: all tests pass and both browser bundles build.

- [ ] **Step 6: Perform local browser smoke checks**

Run: `npm start`

Verify at `http://localhost:8787`:

1. Landing header and hero navigate without a provider prompt.
2. Identity header opens the centered dialog.
3. Aptos, Solana, and EVM providers appear in separate groups.
4. EVM rows are disabled Beta.
5. Escape closes and restores focus; Tab stays inside the dialog.
6. At 375px width, the account surface uses the bottom-sheet layout.

- [ ] **Step 7: Commit the truthful navigation and dApp wiring**

```powershell
git add app/server/public/index.html app/server/public/identity.html app/server/public/upload.html app/server/public/gallery.html app/server/public/latency.html app/server/public/metadata.html app/server/public/app.js app/server/test/theme-and-landing.test.js app/server/test/accessibility.test.js
git commit -m "feat(wallet): route wallet actions through selector"
```

---

## Plan-one completion gate

Run from `app/server`:

```powershell
npm run check
git diff --check
git status --short
```

Expected:

- the full test suite passes;
- both bundles build;
- landing navigation never opens a wallet;
- the selector accurately groups detected providers;
- EVM is disabled Beta;
- no secret or payment state is persisted; and
- only the known user-owned `.gitignore` and Stitch-directory changes remain outside
  the plan's commits.

Do not deploy after this plan alone. Continue with the native Aptos plan, then the
Solana/payment-hardening plan, and deploy only after the combined live acceptance matrix
is green.
