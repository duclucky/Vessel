# Shelby Vault Collection Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Batch Collection computer directory picker with a selector for active image collections already owned by the connected wallet on Shelby.

**Architecture:** A new pure `vault-collections.js` module groups reconciled wallet-owned artifacts by the root of their recorded `sourcePath`. `app.js` owns remote Shelby loading and reconciliation, while `metadata-page.js` renders collection choices and adapts the selected remote artifacts to the existing canonical batch builder, ZIP exporter, and wallet-owned JSON host queue.

**Tech Stack:** Vanilla ES modules, Node test runner, browser DOM APIs, Tailwind utility classes, Shelby wallet controller, Vercel static/server deployment.

## Global Constraints

- Batch artwork must come from a collection already uploaded to Shelby, never from a computer directory picker.
- Only active, written, non-deleted, non-expired image blobs owned by the connected storage address are eligible.
- Original `sourcePath` from the local Vault ledger supplies collection grouping and deterministic item paths.
- Automatic image URIs must reuse existing Shelby read URLs and must not hash or upload the source images again.
- Optional CSV remains a metadata override only.
- Single NFT metadata and the canonical cross-chain schema remain unchanged.
- Local JSON and ZIP export work while Shelby writes are paused; hosting remains gated by `SHELBY_WRITES_ENABLED`.
- Existing unrelated worktree changes must not be staged or modified.

---

## File Structure

- Create `app/server/public/vault-collections.js`: pure validation, filtering, grouping, and deterministic sorting of reconciled Shelby artifacts.
- Create `app/server/test/vault-collections.test.js`: unit coverage for collection discovery and filtering.
- Modify `app/server/public/metadata.html`: replace directory-picker markup with accessible Shelby collection selection and refresh controls.
- Modify `app/server/public/metadata-page.js`: render collection state, select a remote collection, build metadata with existing Shelby URLs, and react to wallet changes.
- Modify `app/server/public/app.js`: list remote artifacts, reconcile them with the Vault ledger, group collections, and supply an async loader to the Metadata page.
- Modify `app/server/test/metadata-page.test.js`: controller and source behavior assertions.
- Modify `app/server/test/latency-and-metadata.test.js`: updated accessible DOM hook assertions.
- Modify `app/server/test/ledger-and-gallery.test.js`: integration assertion for remote collection loading.

### Task 1: Deterministic Shelby Vault Collection Model

**Files:**
- Create: `app/server/public/vault-collections.js`
- Create: `app/server/test/vault-collections.test.js`

**Interfaces:**
- Consumes: reconciled artifacts shaped as `{ key, url, sourcePath, contentType, size, storageAddress, state, isWritten, isDeleted, expiresAt }`.
- Produces: `groupVaultCollections(artifacts, { storageAddress, now }): ReadonlyArray<Collection>` where each collection has `{ id, name, items, itemCount, totalBytes, earliestExpiry }`.

- [ ] **Step 1: Write failing unit tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupVaultCollections } from '../public/vault-collections.js';

const ADDRESS = '0xabc';
const image = (sourcePath, overrides = {}) => ({
  key: `media/${sourcePath.replaceAll('/', '-')}`,
  url: `https://vessel.example/${encodeURIComponent(sourcePath)}`,
  sourcePath,
  contentType: 'image/png',
  size: 10,
  storageAddress: ADDRESS,
  state: 'active',
  isWritten: true,
  isDeleted: false,
  expiresAt: 20_000,
  ...overrides,
});

test('groups active wallet-owned images by source root and sorts naturally', () => {
  const collections = groupVaultCollections([
    image('genesis/images/10.png'),
    image('genesis/images/2.png'),
    image('other/1.png'),
  ], { storageAddress: ADDRESS, now: 10_000 });
  assert.deepEqual(collections.map((entry) => entry.id), ['genesis', 'other']);
  assert.deepEqual(collections[0].items.map((entry) => entry.sourcePath), [
    'genesis/images/2.png',
    'genesis/images/10.png',
  ]);
});

test('filters foreign, expired, deleted, unwritten, non-image, malformed, and duplicate records', () => {
  const valid = image('genesis/1.png');
  const [collection] = groupVaultCollections([
    valid,
    { ...valid },
    image('genesis/2.png', { storageAddress: '0xdef' }),
    image('genesis/3.png', { expiresAt: 9_999 }),
    image('genesis/4.png', { isDeleted: true }),
    image('genesis/5.png', { isWritten: false, state: 'finalizing' }),
    image('genesis/6.json', { contentType: 'application/json' }),
    image('single.png'),
  ], { storageAddress: ADDRESS, now: 10_000 });
  assert.equal(collection.itemCount, 1);
  assert.equal(collection.totalBytes, 10);
  assert.equal(collection.earliestExpiry, 20_000);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd app/server && node --test test/vault-collections.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `public/vault-collections.js`.

- [ ] **Step 3: Implement the pure collection model**

```js
const IMAGE_TYPE = /^image\//i;
const canonical = (value) => String(value || '').toLowerCase().replace(/^0x0+/, '0x');
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function safePath(value) {
  const parts = String(value || '').replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

export function groupVaultCollections(artifacts, { storageAddress, now = Date.now() } = {}) {
  const owner = canonical(storageAddress);
  const groups = new Map();
  const seen = new Set();
  for (const artifact of artifacts || []) {
    const path = safePath(artifact?.sourcePath);
    const key = String(artifact?.key || '');
    if (!path || !key || seen.has(key)) continue;
    if (canonical(artifact.storageAddress || artifact.account) !== owner) continue;
    if (!IMAGE_TYPE.test(String(artifact.contentType || ''))) continue;
    if (artifact.state !== 'active' || artifact.isWritten === false || artifact.isDeleted === true) continue;
    if (!Number.isFinite(Number(artifact.expiresAt)) || Number(artifact.expiresAt) <= now) continue;
    if (!artifact.url) continue;
    seen.add(key);
    const root = path.split('/')[0];
    const id = root.toLowerCase();
    if (!groups.has(id)) groups.set(id, { id, name: root, items: [] });
    groups.get(id).items.push(Object.freeze({ ...artifact, sourcePath: path }));
  }
  return Object.freeze([...groups.values()].map((group) => {
    group.items.sort((a, b) => collator.compare(a.sourcePath, b.sourcePath));
    return Object.freeze({
      id: group.id,
      name: group.name,
      items: Object.freeze(group.items),
      itemCount: group.items.length,
      totalBytes: group.items.reduce((sum, item) => sum + Number(item.size || 0), 0),
      earliestExpiry: Math.min(...group.items.map((item) => Number(item.expiresAt))),
    });
  }).sort((a, b) => collator.compare(a.name, b.name)));
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd app/server && node --test test/vault-collections.test.js`

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Commit the model**

```powershell
git add -- app/server/public/vault-collections.js app/server/test/vault-collections.test.js
git commit -m "feat(metadata): group Shelby Vault collections"
```

### Task 2: Replace the Computer Picker with an Accessible Vault Selector

**Files:**
- Modify: `app/server/public/metadata.html`
- Modify: `app/server/test/latency-and-metadata.test.js`

**Interfaces:**
- Consumes: collection render state from `metadata-page.js`.
- Produces: `#metadata-collection-list`, `#metadata-collection-refresh`, and `#metadata-collection-status` DOM hooks.

- [ ] **Step 1: Change the HTML contract test to fail**

```js
for (const id of [
  'metadata-collection-list', 'metadata-collection-refresh', 'metadata-collection-status',
]) assert.equal(ids.has(id), true, `missing #${id}`);
assert.equal(ids.has('metadata-folder-picker'), false);
assert.equal(ids.has('metadata-folder-input'), false);
assert.doesNotMatch(html, /Select collection folder|webkitdirectory/i);
assert.match(html, /Select a Shelby collection/i);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd app/server && node --test test/latency-and-metadata.test.js`

Expected: FAIL because the Shelby collection hooks do not exist and the directory picker still exists.

- [ ] **Step 3: Replace Step 01 markup**

```html
<section class="metadata-step vessel-glass rounded-vessel p-6 md:p-8" aria-labelledby="batch-collection-title">
  <div class="metadata-step-number" aria-hidden="true">01</div>
  <div>
    <p class="vessel-kicker text-primary-container">Shelby Vault source</p>
    <h2 id="batch-collection-title" class="mt-2 font-display text-2xl font-semibold">Select a Shelby collection</h2>
    <p class="mt-3 max-w-2xl text-sm leading-6 text-on-surface-variant">Choose a folder collection already uploaded by this wallet. Vessel verifies every image against Shelby before creating its JSON.</p>
  </div>
  <div class="mt-6 flex items-center justify-between gap-4">
    <p id="metadata-collection-status" class="text-sm leading-6 text-outline" role="status" aria-live="polite">Connect your wallet to load Shelby collections.</p>
    <button id="metadata-collection-refresh" class="vessel-button vessel-button-secondary shrink-0" type="button"><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Refresh</button>
  </div>
  <div id="metadata-collection-list" class="mt-5 grid gap-3" role="list" aria-label="Shelby collections"></div>
</section>
```

Also change the automatic URI helper copy to `Uses the existing wallet-owned Shelby URL. Source images are never uploaded again.` and the empty batch summary to `Select a Shelby collection to build the collection plan.`

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd app/server && node --test test/latency-and-metadata.test.js`

Expected: metadata DOM tests pass, 0 fail.

- [ ] **Step 5: Commit the markup**

```powershell
git add -- app/server/public/metadata.html app/server/test/latency-and-metadata.test.js
git commit -m "feat(metadata): select collections from Shelby Vault"
```

### Task 3: Load, Select, and Map Existing Shelby Images

**Files:**
- Modify: `app/server/public/metadata-page.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/test/metadata-page.test.js`
- Modify: `app/server/test/ledger-and-gallery.test.js`

**Interfaces:**
- Consumes: `loadCollections(): Promise<ReadonlyArray<Collection>>` supplied by `app.js` and `groupVaultCollections()` from Task 1.
- Produces: `refreshCollections()`, collection selection, and `buildMetadataBatch()` input objects whose URI callback returns the active artifact URL.

- [ ] **Step 1: Write failing controller and integration assertions**

```js
test('batch metadata consumes Shelby collections and removes directory behavior', () => {
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  assert.match(source, /loadCollections/);
  assert.match(source, /refreshCollections/);
  assert.match(source, /artifact\.url/);
  assert.match(source, /previousAddress.*nextAddress/s);
  assert.match(source, /selectedCollectionId = ''/);
  assert.doesNotMatch(source, /collectDirectoryFiles|showDirectoryPicker|metadata-folder-input/);
});

test('Metadata loader reconciles local collection paths with remote Shelby artifacts', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const start = source.indexOf('async function initMetadata()');
  const end = source.indexOf('/* ------------------------------- boot', start);
  const metadata = source.slice(start, end);
  assert.match(metadata, /listArtifacts\(\)/);
  assert.match(metadata, /reconcileArtifacts\(loadMine\(\), remote\)/);
  assert.match(metadata, /groupVaultCollections/);
  assert.match(metadata, /loadCollections/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd app/server && node --test test/metadata-page.test.js test/ledger-and-gallery.test.js`

Expected: FAIL because the page still imports directory behavior and `app.js` does not supply a collection loader.

- [ ] **Step 3: Add the remote loader in `app.js`**

```js
import { groupVaultCollections } from './vault-collections.js';

async function loadMetadataCollections() {
  const controller = walletController();
  const state = controller?.getState?.();
  if (state?.status !== 'ready' || !state.session?.storageAddress) return [];
  const remote = await controller.listArtifacts();
  const reconciled = controller.reconcileArtifacts(loadMine(), remote);
  replaceMine(reconciled);
  return groupVaultCollections(reconciled, {
    storageAddress: state.session.storageAddress,
    now: Date.now(),
  });
}
```

Pass `loadCollections: loadMetadataCollections` into `initMetadataPage()`.

- [ ] **Step 4: Replace local folder state in `metadata-page.js`**

Remove `collectDirectoryFiles`, `createFileHashCache`, `contentAddressedBlobName`, folder elements, `batchFiles`, `pickFolder()`, and `selectFolder()`.

Add the loader option and state:

```js
loadCollections = async () => [],

let collections = [];
let selectedCollectionId = '';
let collectionState = 'idle';

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function selectedCollection() {
  return collections.find((entry) => entry.id === selectedCollectionId) || null;
}

function collectionFiles(collection) {
  return collection.items.map((artifact) => Object.freeze({
    name: artifact.sourcePath.split('/').pop(),
    type: artifact.contentType,
    size: artifact.size,
    vesselRelativePath: artifact.sourcePath,
    url: artifact.url,
    artifact,
  }));
}
```

Render each collection as one unique button with `data-collection-id`, its name, item count, size, and earliest expiry:

```js
function renderCollections(error = null) {
  if (!element.collectionList || !element.collectionStatus) return;
  const messages = {
    wallet: 'Connect your wallet to load Shelby collections.',
    loading: 'Checking your wallet-owned collections on Shelby...',
    ready: collections.length
      ? `${collections.length} active Shelby collection${collections.length === 1 ? '' : 's'} found.`
      : 'No eligible folder collection was found. Upload a folder as a batch first.',
    error: `Unable to load Shelby collections: ${String(error?.message || 'Unknown error')}`,
  };
  element.collectionStatus.textContent = messages[collectionState] || messages.wallet;
  const buttons = collections.map((collection) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'metadata-collection-choice';
    button.dataset.collectionId = collection.id;
    button.setAttribute('aria-pressed', String(collection.id === selectedCollectionId));
    button.textContent = `${collection.name} · ${collection.itemCount} images · ${formatBytes(collection.totalBytes)}`;
    button.addEventListener('click', () => {
      selectedCollectionId = collection.id;
      renderCollections();
      void rebuildBatch();
    });
    return button;
  });
  element.collectionList.replaceChildren(...buttons);
}
```

Implement refresh behavior:

```js
async function refreshCollections() {
  const requestedAddress = currentWallet?.session?.storageAddress || '';
  if (!readyWallet(currentWallet)) {
    collections = [];
    selectedCollectionId = '';
    collectionState = 'wallet';
    renderCollections();
    await rebuildBatch();
    return [];
  }
  collectionState = 'loading';
  renderCollections();
  try {
    const loaded = await loadCollections();
    if (requestedAddress !== (currentWallet?.session?.storageAddress || '')) return [];
    collections = [...loaded];
    if (!collections.some((entry) => entry.id === selectedCollectionId)) selectedCollectionId = '';
    collectionState = 'ready';
    renderCollections();
    await rebuildBatch();
    return collections;
  } catch (error) {
    collections = [];
    selectedCollectionId = '';
    collectionState = 'error';
    renderCollections(error);
    await rebuildBatch();
    throw error;
  }
}
```

Build from the selected collection and existing URI:

```js
const collection = selectedCollection();
const files = collection ? collectionFiles(collection) : [];
batchPlan = await buildMetadataBatch({
  files,
  csvRows,
  defaults: {
    namePrefix: element.batchName?.value || collection?.name,
    description: element.batchDescription?.value,
    externalUrl: element.batchExternalUrl?.value,
    startNumber: Number(element.startNumber?.value || 1),
  },
  uriForImage: async (file, relativePath) => (
    useCustom ? joinMetadataBaseUri(element.baseUri?.value, relativePath) : file.url
  ),
});
```

Wire Refresh to `refreshCollections()`. On a wallet storage-address change, clear the selected collection and reload:

```js
element.collectionRefresh?.addEventListener('click', () => {
  refreshCollections().catch((error) => notify(error.message, 'error'));
});

function refreshWallet(next) {
  const previousAddress = currentWallet?.session?.storageAddress || '';
  const nextAddress = next?.session?.storageAddress || '';
  currentWallet = next || {};
  renderHostingState();
  if (previousAddress !== nextAddress) {
    selectedCollectionId = '';
    collections = [];
    void refreshCollections().catch((error) => notify(error.message, 'error'));
  }
}

return Object.freeze({
  reset,
  refreshWallet,
  refreshHosting,
  refreshCollections,
  hostSingle,
  hostBatch,
  retryFailedBatch,
});
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cd app/server && node --test test/vault-collections.test.js test/metadata-page.test.js test/ledger-and-gallery.test.js test/latency-and-metadata.test.js`

Expected: all focused tests pass, 0 fail.

- [ ] **Step 6: Commit the integration**

```powershell
git add -- app/server/public/app.js app/server/public/metadata-page.js app/server/test/metadata-page.test.js app/server/test/ledger-and-gallery.test.js
git commit -m "feat(metadata): build JSON from Shelby collections"
```

### Task 4: Regression, Production Verification, and Deployment

**Files:**
- Modify only if a failing test reveals an in-scope defect in the files listed above.

**Interfaces:**
- Consumes: completed Tasks 1 through 3.
- Produces: verified production deployment on `https://vessel-sage.vercel.app`.

- [ ] **Step 1: Run the complete automated suite**

Run: `cd app/server && npm test`

Expected: every test passes, 0 fail, 0 skipped.

- [ ] **Step 2: Build browser wallet bundles**

Run: `cd app/server && npm run build:client`

Expected: exit code 0 and bundle output for `vessel-solana.js`, `vessel-wallets.js`, and `clay.wasm`.

- [ ] **Step 3: Review scope and secrets**

Run: `git diff --check HEAD~3..HEAD`

Run: `git status --short`

Expected: no whitespace errors; unrelated pre-existing changes remain unstaged; no private keys, API keys, seed phrases, `.env` files, or generated fixture files are included.

- [ ] **Step 4: Push and deploy production**

Run: `git push origin main`

Run: `cd app/server && npx vercel --prod --yes`

Expected: push succeeds and Vercel returns a Ready production deployment aliased to `https://vessel-sage.vercel.app`.

- [ ] **Step 5: Verify in Chrome**

Open `https://vessel-sage.vercel.app/metadata.html` in the user's Chrome session and confirm:

1. Batch Collection contains no computer directory picker.
2. The connected wallet loads only its active Shelby collections.
3. Selecting a collection creates canonical JSON previews using existing `/api/shelby/blobs/...` image URLs.
4. CSV override changes the matching preview without changing the source image URL.
5. ZIP download completes and contains deterministic `metadata/<relative-path>.json` entries plus its report.
6. `Host Collection on Shelby` is disabled with the paused testnet message while writes are disabled.
7. Wallet disconnect or switching clears the prior collection.
8. Keyboard collection selection, focus states, mobile layout, live status, and text contrast remain usable.

- [ ] **Step 6: Record the final evidence**

Capture the final test count, build result, deployment ID, production alias, and Chrome observations in the task handoff response. Do not claim the correction is complete without this fresh evidence.
