# Cross-chain Single and Batch NFT Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vessel's minimal metadata composer with one canonical cross-chain generator for single NFTs and collection batches, including local JSON or ZIP export and wallet-owned Shelby hosting through Vessel settlement contracts.

**Architecture:** Pure browser modules own canonical schema construction, URI derivation, collection mapping, CSV import, and dependency-free ZIP export. A focused metadata page controller renders both modes. The current quote, settlement, registration, recovery, and write logic moves behind a reusable wallet-owned upload service used by both Upload and Metadata pages, with an explicit server-provided Shelby write-availability gate.

**Tech Stack:** Vanilla ES modules, browser File and Blob APIs, File System Access API with file-input fallback, Tailwind utility classes, Express, Node test runner, existing Aptos and Solana wallet adapters, existing Vessel settlement clients.

## Global Constraints

- Single and batch outputs use the same canonical schema.
- Required fields are non-empty `name`, `description`, and `image` strings.
- `attributes` is an array of `{ trait_type, value }` entries.
- `properties.files[0].uri` always equals `image` and includes the detected MIME type.
- `properties.category` is `image` in the initial release.
- JSON uses UTF-8, stable field ordering, two-space indentation, and a trailing newline.
- Batch limits are 1,073,741,824 selected media bytes and 3,000 image items.
- JSON generation, validation, and export require no wallet signature or Shelby request.
- Every hosted JSON uses the connected wallet's storage address and a chain-specific Vessel contract or program receipt.
- The legacy server-managed `/api/metadata` route is not a first-party hosting path.
- The UI must block hosting before payment when Shelby writes are configured as paused.
- Existing user changes in `.gitignore`, storage providers, and the Stitch design folder must remain untouched unless a task names them explicitly.

---

## File Structure

- `app/server/public/metadata-schema.js`: canonical metadata model, normalization, validation, and serialization.
- `app/server/public/content-address.js`: shared SHA-256, content-addressed blob name, and Vessel read-URL helpers.
- `app/server/public/metadata-batch.js`: image, JSON, and CSV mapping plus deterministic item plans.
- `app/server/public/metadata-export.js`: single JSON file and uncompressed ZIP creation.
- `app/server/public/metadata-page.js`: page-specific state and DOM rendering for single and batch modes.
- `app/server/public/wallet-owned-upload.js`: DOM-free quote, settlement, upload, and recovery coordinator.
- `app/server/public/app.js`: page bootstrapping, toasts, and thin Upload page view adapter.
- `app/server/public/metadata.html`: accessible Single NFT and Batch Collection interface.
- `app/server/public/upload.html`: unchanged behavior, consuming the shared upload service through `app.js`.
- `app/server/src/index.js`: public write-availability flag, route defense, and legacy metadata-route shutdown.
- `app/server/test/*.test.js`: focused unit, source-contract, integration, and regression coverage.

---

### Task 1: Canonical metadata schema and shared content addressing

**Files:**
- Create: `app/server/public/metadata-schema.js`
- Create: `app/server/public/content-address.js`
- Create: `app/server/test/metadata-schema.test.js`
- Create: `app/server/test/content-address.test.js`
- Modify: `app/server/public/app.js`

**Interfaces:**
- Produces: `createNftMetadata(input) -> frozen metadata object`.
- Produces: `validateNftMetadata(metadata) -> { valid, errors }`.
- Produces: `serializeNftMetadata(metadata) -> string`.
- Produces: `sha256FileHex(file) -> Promise<string>`.
- Produces: `contentAddressedBlobName(file, hash) -> string`.
- Produces: `vesselBlobUrl({ origin, storageAddress, blobName }) -> string`.

- [ ] **Step 1: Write failing schema tests**

```js
test('canonical metadata includes marketplace fields in stable order', () => {
  const metadata = createNftMetadata({
    name: 'Vessel Genesis #001',
    description: 'Wallet-owned artifact',
    image: 'https://example.com/001.png',
    externalUrl: 'https://vessel-sage.vercel.app',
    attributes: [{ trait_type: 'Background', value: 'Nebula' }],
    mimeType: 'image/png',
  });
  assert.deepEqual(metadata.properties, {
    files: [{ uri: metadata.image, type: 'image/png' }],
    category: 'image',
  });
  assert.equal(validateNftMetadata(metadata).valid, true);
  assert.equal(serializeNftMetadata(metadata).endsWith('\n'), true);
  assert.equal(serializeNftMetadata(metadata).indexOf('"image"'), serializeNftMetadata(metadata).lastIndexOf('"image"'));
});

test('canonical metadata rejects blank fields, invalid URIs, and malformed traits', () => {
  const result = validateNftMetadata({
    name: '', description: '', image: 'javascript:alert(1)',
    attributes: [{ trait_type: '', value: {} }],
    properties: { files: [], category: 'image' },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'name_required', 'description_required', 'image_uri_invalid',
    'attribute_trait_required', 'attribute_value_invalid', 'primary_file_required',
  ]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run from `app/server`:

```powershell
node --test test/metadata-schema.test.js test/content-address.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the two new browser modules.

- [ ] **Step 3: Implement the minimum schema API**

```js
const VALID_URI = /^(https:\/\/|ipfs:\/\/|ar:\/\/)/i;

export function createNftMetadata({ name, description, image, externalUrl, attributes = [], mimeType }) {
  const metadata = {
    name: String(name || '').trim(),
    description: String(description || '').trim(),
    image: String(image || '').trim(),
  };
  if (externalUrl) metadata.external_url = String(externalUrl).trim();
  metadata.attributes = attributes.map(({ trait_type, value }) => ({
    trait_type: String(trait_type || '').trim(), value,
  }));
  metadata.properties = {
    files: [{ uri: metadata.image, type: String(mimeType || 'image/png') }],
    category: 'image',
  };
  return Object.freeze(metadata);
}

export function serializeNftMetadata(metadata) {
  const validation = validateNftMetadata(metadata);
  if (!validation.valid) throw Object.assign(new Error('Invalid NFT metadata'), { errors: validation.errors });
  return `${JSON.stringify(metadata, null, 2)}\n`;
}
```

Implement `validateNftMetadata` with deterministic error order matching the test. Permit only `https://`, `ipfs://`, and `ar://` for media and external URIs.

- [ ] **Step 4: Extract the existing hash and blob-name logic**

Move the private `sha256Hex(file)` and `contentAddressedBlobName(file, fileHash)` behavior from `public/app.js` into `public/content-address.js`. Update `app.js` to import the shared functions without changing upload quote payloads.

- [ ] **Step 5: Run focused and upload regression tests**

```powershell
node --test test/metadata-schema.test.js test/content-address.test.js test/upload.test.js test/contract-settlement-flow.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/server/public/metadata-schema.js app/server/public/content-address.js app/server/public/app.js app/server/test/metadata-schema.test.js app/server/test/content-address.test.js
git commit -m "feat(metadata): add canonical cross-chain schema"
```

---

### Task 2: Batch image, JSON, and CSV mapping

**Files:**
- Create: `app/server/public/metadata-batch.js`
- Create: `app/server/test/metadata-batch.test.js`

**Interfaces:**
- Consumes: `createNftMetadata` and `sha256FileHex` from Task 1.
- Produces: `parseMetadataCsv(text) -> row objects`.
- Produces: `indexMetadataFolder(files, options) -> { images, jsonByStem, warnings }`.
- Produces: `buildMetadataBatch(input) -> Promise<{ items, errors, warnings, totalBytes }>`.
- Each item is `{ id, sourcePath, outputPath, file, metadata, serialized, status, warnings }`.

- [ ] **Step 1: Write failing mapping tests**

```js
test('batch pairs images and JSON by normalized relative stem', async () => {
  const files = [
    asset('001.png', 'collection/images/001.png', 'image/png', pngBytes),
    asset('001.json', 'collection/metadata/001.json', 'application/json', JSON.stringify({
      name: 'Imported #1', attributes: [{ trait_type: 'Sky', value: 'Blue' }],
    })),
  ];
  const result = await buildMetadataBatch({
    files,
    defaults: { namePrefix: 'Genesis', description: 'Collection' },
    uriForImage: async () => 'https://example.com/001.png',
  });
  assert.equal(result.items[0].metadata.name, 'Imported #1');
  assert.deepEqual(result.items[0].metadata.attributes, [{ trait_type: 'Sky', value: 'Blue' }]);
  assert.equal(result.items[0].outputPath, 'metadata/001.json');
});

test('CSV item fields override JSON and collection defaults', async () => {
  const rows = parseMetadataCsv('filename,name,trait:Background\n001.png,CSV Name,Nebula\n');
  const result = await buildMetadataBatch({ files, csvRows: rows, defaults, uriForImage });
  assert.equal(result.items[0].metadata.name, 'CSV Name');
  assert.deepEqual(result.items[0].metadata.attributes, [{ trait_type: 'Background', value: 'Nebula' }]);
});
```

Add tests for images-only numbering, quoted CSV fields, duplicate normalized paths, malformed JSON, unmatched JSON, unsupported files, the 1 GB cap, and the 3,000-image cap.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test test/metadata-batch.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `metadata-batch.js`.

- [ ] **Step 3: Implement deterministic folder indexing**

```js
export const METADATA_BATCH_MAX_BYTES = 1024 * 1024 * 1024;
export const METADATA_BATCH_MAX_ITEMS = 3000;

const stem = (path) => normalizedPath(path)
  .replace(/^(?:images|metadata)\//i, '')
  .replace(/\.[^.\/]+$/, '')
  .toLowerCase();

export function indexMetadataFolder(files, options = {}) {
  // Split supported images and JSON, enforce limits, detect duplicate stems,
  // and return warnings for unmatched or skipped files.
}
```

The real implementation must use the file's `vesselRelativePath`, then `webkitRelativePath`, then `name`, and strip the selected root folder before matching.

- [ ] **Step 4: Implement RFC4180-compatible CSV parsing for the supported subset**

Support commas, CRLF or LF, escaped double quotes, blank optional cells, reserved columns `filename`, `name`, `description`, `external_url`, and any `trait:<name>` columns. Reject missing `filename`, duplicate filenames, and rows with more values than headers.

- [ ] **Step 5: Implement batch precedence and serialization**

Apply values in this order: CSV item, matching JSON item, collection defaults. Always override `image`, `properties.files`, and `properties.category` with the current mapped image and MIME type. Use the image stem for `metadata/<stem>.json` and stable zero-padding based on the item count.

- [ ] **Step 6: Run focused tests**

```powershell
node --test test/metadata-schema.test.js test/metadata-batch.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/server/public/metadata-batch.js app/server/test/metadata-batch.test.js
git commit -m "feat(metadata): map collection files and traits"
```

---

### Task 3: Dependency-free JSON and ZIP export

**Files:**
- Create: `app/server/public/metadata-export.js`
- Create: `app/server/test/metadata-export.test.js`

**Interfaces:**
- Produces: `metadataJsonFile(metadata, fileName) -> File`.
- Produces: `buildMetadataZip(items, report) -> Blob`.
- Produces: `downloadBlob(blob, fileName, document = globalThis.document)`.

- [ ] **Step 1: Write failing export tests**

```js
test('single metadata export creates a UTF-8 JSON file', async () => {
  const file = metadataJsonFile(metadata, '001.json');
  assert.equal(file.type, 'application/json');
  assert.equal(file.name, '001.json');
  assert.equal(await file.text(), `${JSON.stringify(metadata, null, 2)}\n`);
});

test('batch ZIP contains deterministic JSON paths and a redacted report', async () => {
  const zip = await buildMetadataZip([
    { outputPath: 'metadata/001.json', serialized: '{"name":"One"}\n' },
    { outputPath: 'metadata/002.json', serialized: '{"name":"Two"}\n' },
  ], { warnings: [] });
  const entries = readStoredZip(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual([...entries.keys()], [
    'metadata/001.json', 'metadata/002.json', 'metadata-report.json',
  ]);
  assert.doesNotMatch(entries.get('metadata-report.json'), /signature|authorization|C:\\\\/i);
});
```

The test helper `readStoredZip` parses local headers and the central directory so the test validates real ZIP structure, not only byte substrings.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test test/metadata-export.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement stored ZIP output**

Implement CRC32, DOS timestamp fields, local file headers, central directory entries, and end-of-central-directory records with method `0` for uncompressed UTF-8 files. Reject duplicate paths, absolute paths, `..` segments, and more than 65,535 entries. This avoids a new browser dependency and is adequate for small JSON documents.

- [ ] **Step 4: Implement safe browser download**

```js
export function downloadBlob(blob, fileName, document = globalThis.document) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

- [ ] **Step 5: Run focused tests**

```powershell
node --test test/metadata-export.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/server/public/metadata-export.js app/server/test/metadata-export.test.js
git commit -m "feat(metadata): export JSON collection ZIP"
```

---

### Task 4: Accessible Single NFT and Batch Collection interface

**Files:**
- Modify: `app/server/public/metadata.html`
- Create: `app/server/public/metadata-page.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/vessel.css`
- Modify: `app/server/test/latency-and-metadata.test.js`
- Create: `app/server/test/metadata-page.test.js`

**Interfaces:**
- Consumes: schema, batch, content-addressing, and export modules from Tasks 1 to 3.
- Produces: `initMetadataPage(dependencies)`.
- Produces DOM hooks for both modes, trait editing, folder selection, CSV selection, validation summary, item preview, JSON download, and ZIP download.

- [ ] **Step 1: Add failing HTML contract tests**

Require these IDs:

```js
for (const id of [
  'metadata-mode-tabs', 'metadata-single-tab', 'metadata-batch-tab',
  'metadata-single-panel', 'metadata-batch-panel', 'single-traits',
  'single-add-trait', 'single-download-json', 'single-host-shelby',
  'metadata-folder-picker', 'metadata-folder-input', 'batch-name-prefix',
  'batch-description', 'batch-external-url', 'batch-uri-vessel',
  'batch-uri-custom', 'batch-base-uri', 'batch-csv-input',
  'batch-summary', 'batch-item-table', 'batch-json-preview',
  'batch-download-zip', 'batch-host-shelby', 'metadata-hosting-status',
]) assert.equal(ids.has(id), true, id);
```

Assert WAI-ARIA tab roles, `aria-controls`, `aria-selected`, live validation status, visible labels, and no browser `alert()` or `confirm()` calls.

- [ ] **Step 2: Run UI tests and verify RED**

```powershell
node --test test/latency-and-metadata.test.js test/metadata-page.test.js
```

Expected: FAIL for missing controls and module.

- [ ] **Step 3: Replace the current single-purpose layout**

Add a two-tab header with `Single NFT` selected by default. Keep the existing Vessel shell and preview composition. Add reusable trait rows containing labeled inputs and 44px add or remove buttons. Add the four batch sections: folder, defaults, review, actions.

The primary action labels must be:

- `Download JSON`
- `Host TokenURI on Shelby`
- `Download Metadata ZIP`
- `Host Collection on Shelby`

- [ ] **Step 4: Implement the metadata page controller**

```js
export function initMetadataPage({
  document,
  selectedArtifact,
  walletState,
  hostingAvailable,
  hostFiles,
  notify,
}) {
  // Own mode, draft, traits, selected folder, batch plan, selected preview,
  // validation, and export state. Return { reset, refreshWallet, refreshHosting }.
}
```

Use the native Directory Picker when available and the hidden `webkitdirectory` input only as fallback. Reuse `collectDirectoryFiles` from `directory-picker.js`. Automatic Vessel URI mode calls `sha256FileHex`, `contentAddressedBlobName`, and `vesselBlobUrl` with the ready wallet's storage address. Custom mode joins the validated base URI and normalized relative image path.

- [ ] **Step 5: Make `app.js` a thin bootstrap for metadata**

Replace the current `initMetadata` implementation with a call to `initMetadataPage`. Pass `ledger.selected()`, the current wallet state, `api`, `toast`, and a temporary `hostFiles` function that throws `wallet_owned_metadata_host_not_ready`. Do not call `/api/metadata`.

- [ ] **Step 6: Add responsive and accessibility styling**

Use existing Vessel tokens. Ensure selected tabs, invalid rows, progress, and disabled hosting remain readable without color. Add reduced-motion rules for the new tab and batch transitions. Do not add a new visual theme.

- [ ] **Step 7: Run focused UI tests**

```powershell
node --test test/latency-and-metadata.test.js test/metadata-page.test.js test/accessibility.test.js
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```powershell
git add app/server/public/metadata.html app/server/public/metadata-page.js app/server/public/app.js app/server/public/vessel.css app/server/test/latency-and-metadata.test.js app/server/test/metadata-page.test.js
git commit -m "feat(metadata): add single and batch composer"
```

---

### Task 5: Shelby write-availability gate and legacy route shutdown

**Files:**
- Modify: `app/server/src/config.js`
- Modify: `app/server/src/index.js`
- Modify: `app/server/test/config.test.js`
- Modify: `app/server/test/metadata-source.test.js`
- Create: `app/server/test/shelby-write-gate.test.js`

**Interfaces:**
- Produces public config field `shelbyWritesEnabled: boolean`.
- Produces server error `{ code: 'shelby_writes_paused', error: 'Shelby testnet writes are temporarily paused' }` with HTTP 503.
- Changes `/api/metadata` to HTTP 410 with code `wallet_owned_metadata_required`.

- [ ] **Step 1: Write failing configuration and route tests**

```js
test('production exposes an explicit Shelby write gate without secrets', () => {
  assert.equal(parseShelbyWritesEnabled({
    NODE_ENV: 'production',
    SHELBY_WRITES_ENABLED: 'false',
  }), false);
  assert.doesNotMatch(publicConfigRoute, /shelbyApiKey:\s*config\.shelbyApiKey/);
});

test('write routes reject before upstream I/O when Shelby writes are paused', async () => {
  const response = await requestPausedApp('/api/shelby/uploads', paidBody);
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'shelby_writes_paused');
  assert.equal(upstreamCalls, 0);
});
```

Add the same defense assertion for `/api/shelby/register` and multipart part or completion routes.

- [ ] **Step 2: Run focused server tests and verify RED**

```powershell
node --test test/config.test.js test/metadata-source.test.js test/shelby-write-gate.test.js
```

Expected: FAIL because the flag and paused-route behavior do not exist.

- [ ] **Step 3: Add strict environment parsing**

Export `parseShelbyWritesEnabled(env)` from `config.js`. Accept only exact strings `true` and `false` for `SHELBY_WRITES_ENABLED`. In production, require the variable to be present; outside production, default to `true`. Initialize `config.shelbyWritesEnabled` with that function and expose only the resulting boolean through `/api/config`.

- [ ] **Step 4: Add route defense before paid or upstream work**

```js
function requireShelbyWrites(res) {
  if (config.shelbyWritesEnabled) return true;
  send(res, 503, {
    error: 'Shelby testnet writes are temporarily paused',
    code: 'shelby_writes_paused',
  });
  return false;
}
```

Call this at the start of registration and multipart write routes. The browser upload service must also read the public gate before requesting or settling a quote, preventing testnet charges during a known pause.

- [ ] **Step 5: Disable legacy metadata hosting**

Replace the body of `POST /api/metadata` with HTTP 410:

```js
send(res, 410, {
  error: 'Use wallet-owned metadata hosting',
  code: 'wallet_owned_metadata_required',
});
```

Remove first-party tests that expect this route to call `store.put`; replace them with source-contract assertions that it cannot write app-owned metadata.

- [ ] **Step 6: Run focused server tests**

```powershell
node --test test/config.test.js test/metadata-source.test.js test/shelby-write-gate.test.js test/shelby-api-routes.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/server/src/config.js app/server/src/index.js app/server/test/config.test.js app/server/test/metadata-source.test.js app/server/test/shelby-write-gate.test.js
git commit -m "fix(storage): gate paused Shelby writes"
```

---

### Task 6: Reusable wallet-owned upload service

**Files:**
- Create: `app/server/public/wallet-owned-upload.js`
- Create: `app/server/test/wallet-owned-upload.test.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/test/upload.test.js`
- Modify: `app/server/test/contract-settlement-flow.test.js`

**Interfaces:**
- Produces: `createWalletOwnedUploadService(dependencies)`.
- Service methods: `quote(file, { days, signal })`, `validate(quoted, { signal })`, `upload(validated, callbacks)`, and `resume(file, record, callbacks)`.
- Returns structured immutable results and throws typed errors. It has no DOM access.

- [ ] **Step 1: Write failing service tests**

```js
test('service blocks before quote when Shelby writes are paused', async () => {
  const service = createWalletOwnedUploadService(deps({ config: { shelbyWritesEnabled: false } }));
  await assert.rejects(
    () => service.quote(file, { days: 7 }),
    (error) => error.code === 'shelby_writes_paused',
  );
  assert.equal(requests.some((entry) => entry.url.includes('/quotes/upload')), false);
});

test('service settles, registers, and writes one immutable file context', async () => {
  const quoted = await service.quote(file, { days: 30 });
  const validated = await service.validate(quoted);
  const result = await service.upload(validated, { onStep, onCheckpoint });
  assert.equal(result.ownedByYou, true);
  assert.equal(result.account, session.storageAddress);
  assert.equal(settlementCalls, 1);
  assert.equal(walletUploadCalls, 1);
});
```

Add tests for wallet changes, hash changes, quote expiry, price drift requiring confirmation, receipt pending recovery, Aptos native routing, Solana DAA routing, and no duplicate settlement during resume.

- [ ] **Step 2: Run service and flow tests and verify RED**

```powershell
node --test test/wallet-owned-upload.test.js test/contract-settlement-flow.test.js test/upload.test.js
```

Expected: FAIL with missing service module.

- [ ] **Step 3: Move business logic out of `initUpload`**

The constructor receives exact dependencies:

```js
createWalletOwnedUploadService({
  request,
  controller,
  getSolana,
  recovery,
  settleContractQuote,
  createUploadIntent,
  sha256FileHex,
  contentAddressedBlobName,
  now: Date.now,
})
```

Move quote issuance, quote validation, deployment selection, settlement, controller upload, and recovery checkpoint transitions from `app.js`. Keep funding-gate and visual rendering callbacks in `app.js`.

- [ ] **Step 4: Adapt Upload page to the service**

`initUpload` calls service methods and translates typed errors into the existing quote panel, progress view, funding gate, and recovery panel. Preserve all current single-file and folder-batch copy and IDs. The existing 204-test baseline must remain behaviorally compatible.

- [ ] **Step 5: Run focused and full upload tests**

```powershell
node --test test/wallet-owned-upload.test.js test/contract-settlement-flow.test.js test/upload.test.js test/batch-upload.test.js test/recovery-ledger.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/server/public/wallet-owned-upload.js app/server/public/app.js app/server/test/wallet-owned-upload.test.js app/server/test/upload.test.js app/server/test/contract-settlement-flow.test.js
git commit -m "refactor(upload): share wallet-owned hosting service"
```

---

### Task 7: Single metadata wallet-owned hosting

**Files:**
- Modify: `app/server/public/metadata-page.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/test/metadata-page.test.js`
- Modify: `app/server/test/ledger-and-gallery.test.js`

**Interfaces:**
- Consumes: `metadataJsonFile` and `createWalletOwnedUploadService`.
- Produces: one hosted JSON result with authoritative `tokenUri`, receipt evidence, retention, and wallet ownership.

- [ ] **Step 1: Write failing single-host tests**

```js
test('single host serializes canonical JSON and uses wallet-owned upload', async () => {
  await page.hostSingle();
  assert.equal(hostedFiles.length, 1);
  assert.equal(hostedFiles[0].type, 'application/json');
  assert.equal(JSON.parse(await hostedFiles[0].text()).properties.category, 'image');
  assert.equal(requests.some((entry) => entry.url === '/api/metadata'), false);
});

test('single host remains disabled while writes are paused but download stays enabled', () => {
  page.refreshHosting(false);
  assert.equal(hostButton.disabled, true);
  assert.equal(downloadButton.disabled, false);
  assert.match(status.textContent, /temporarily paused/i);
});
```

- [ ] **Step 2: Run focused metadata tests and verify RED**

```powershell
node --test test/metadata-page.test.js test/ledger-and-gallery.test.js
```

Expected: FAIL because `hostSingle` is not connected to the shared service.

- [ ] **Step 3: Connect single hosting**

Pass this callback to `initMetadataPage`:

```js
async function hostFiles(files, { days, onUpdate }) {
  const results = [];
  for (const file of files) {
    const quoted = await walletOwnedUpload.quote(file, { days });
    const validated = await walletOwnedUpload.validate(quoted);
    results.push(await walletOwnedUpload.upload(validated, onUpdate));
  }
  return results;
}
```

Render quote review before settlement. On success, display the returned Shelby JSON URL as `Resulting TokenURI`, provide copy and download controls, and commit the wallet-owned JSON result to the ledger.

- [ ] **Step 4: Run focused tests**

```powershell
node --test test/metadata-page.test.js test/ledger-and-gallery.test.js test/wallet-owned-upload.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add app/server/public/metadata-page.js app/server/public/app.js app/server/test/metadata-page.test.js app/server/test/ledger-and-gallery.test.js
git commit -m "feat(metadata): host wallet-owned TokenURI"
```

---

### Task 8: Batch metadata wallet-owned hosting and recovery

**Files:**
- Modify: `app/server/public/metadata-page.js`
- Modify: `app/server/public/batch-upload.js`
- Modify: `app/server/test/metadata-page.test.js`
- Modify: `app/server/test/batch-upload.test.js`
- Modify: `app/server/test/contract-settlement-flow.test.js`

**Interfaces:**
- Consumes: canonical batch items and shared wallet-owned upload service.
- Produces: sequential JSON hosting with aggregate estimate, progress, pause, retry, and authoritative TokenURI results.

- [ ] **Step 1: Write failing batch-host tests**

```js
test('batch host runs valid JSON files sequentially and never repeats success', async () => {
  failOnceFor.add('002.json');
  const firstRun = await page.hostBatch();
  assert.equal(maxConcurrentHosts, 1);
  assert.deepEqual(hostedNames, ['001.json', '002.json']);
  assert.equal(firstRun.succeeded, 1);
  assert.equal(firstRun.failed, 1);
  await page.retryFailedBatch();
  assert.deepEqual(hostedNames, ['001.json', '002.json', '002.json']);
  assert.equal(page.batchItems[0].status, 'succeeded');
});

test('receipt pending pauses the batch without another settlement', async () => {
  await assert.rejects(() => page.hostBatch(), (error) => error.code === 'receipt_pending');
  await page.resumeBatch();
  assert.equal(settlementCallsForFirstItem, 1);
  assert.equal(secondItem.status, 'queued');
});
```

Add assertions for aggregate estimate copy, expected approval count, $0.01 minimum disclosure, wallet-change invalidation, and disabled hosting when any selected item is invalid.

- [ ] **Step 2: Run focused batch tests and verify RED**

```powershell
node --test test/metadata-page.test.js test/batch-upload.test.js test/contract-settlement-flow.test.js
```

Expected: FAIL because batch hosting handlers do not exist.

- [ ] **Step 3: Reuse the retryable queue for JSON files**

Create a `File` for each serialized item using its output basename and `application/json`. Store `sourcePath` as the JSON output path. Use `runBatchQueue` with a host function that requests and validates a fresh quote immediately before each item.

- [ ] **Step 4: Add batch review and progress behavior**

Before the first approval, render item count, expected approval count, retention, and an aggregate estimate labeled as estimated. During hosting, show current JSON path, successful, failed, queued, and percentage values. If the exact refreshed quote changes more than 5%, pause and require explicit confirmation before continuing.

- [ ] **Step 5: Add recovery behavior**

Use existing recovery records keyed by quote ID. A submitted settlement or paid item must resume from recorded evidence after the user reselects the original collection folder. Match the regenerated JSON by SHA-256 before resuming. Never retry an item whose receipt is pending through `retryFailed()`.

- [ ] **Step 6: Run focused tests**

```powershell
node --test test/metadata-page.test.js test/batch-upload.test.js test/contract-settlement-flow.test.js test/recovery-ledger.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/server/public/metadata-page.js app/server/public/batch-upload.js app/server/test/metadata-page.test.js app/server/test/batch-upload.test.js app/server/test/contract-settlement-flow.test.js
git commit -m "feat(metadata): host collection JSON batch"
```

---

### Task 9: Verification, production configuration, and release

**Files:**
- Review all changed files.
- Modify only if verification exposes a defect.

**Interfaces:**
- Produces a tested production deployment with local metadata generation active and Shelby hosting visibly paused until upstream writes resume.

- [ ] **Step 1: Run the complete automated suite**

```powershell
cd D:\Visell\app\server
npm test
```

Expected: zero failures, zero skipped regression tests.

- [ ] **Step 2: Build browser clients**

```powershell
npm run build:client
```

Expected: `BUNDLE OK` and exit code `0`.

- [ ] **Step 3: Run repository checks**

```powershell
cd D:\Visell
git diff --check
git status --short
```

Expected: no whitespace errors. Only feature files are staged; unrelated user changes remain unstaged.

- [ ] **Step 4: Configure the production write gate**

Set `SHELBY_WRITES_ENABLED=false` in the Vercel production environment while Shelby rejects uploads. Confirm `/api/config` returns `shelbyWritesEnabled: false`. Do not expose or modify the Shelby API key.

- [ ] **Step 5: Verify in Chrome**

Verify:

1. Single mode builds the complete canonical JSON from a Gallery image.
2. Trait add and remove controls work by mouse and keyboard.
3. `Download JSON` produces parseable UTF-8 JSON.
4. Batch folder selection maps images and optional matching JSON.
5. Optional CSV overrides are visible in preview.
6. ZIP contains deterministic metadata paths and the report.
7. Host buttons are disabled with a clear paused message.
8. Wallet changes invalidate automatic Vessel URIs.
9. Mobile layout, focus indicators, live errors, and contrast remain usable.

- [ ] **Step 6: Commit any verification-only fixes**

Use a focused commit only if Step 1 to Step 5 requires a code correction. Do not create an empty commit.

- [ ] **Step 7: Push and verify deployment**

```powershell
git push origin main
npx vercel inspect https://vessel-sage.vercel.app
```

Expected: production status `Ready`, alias `https://vessel-sage.vercel.app`, and the deployed Metadata page exposes both modes.
