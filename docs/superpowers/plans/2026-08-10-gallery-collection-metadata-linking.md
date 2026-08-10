# Gallery Collection Metadata Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link existing and future batch TokenURI artifacts to their source Gallery collection without re-hosting or charging the user again.

**Architecture:** Treat the saved collection manifest as the authoritative local join table. Hydrate ledger artifacts through a pure, owner-scoped URL matcher, then let Gallery prefer the explicit collection relationship while retaining the existing single-artifact source-key fallback. Update approval copy without changing signatures, quotes, settlement, or Shelby upload behavior.

**Tech Stack:** Browser JavaScript ES modules, localStorage ledger, Node.js test runner, Vercel production, Chrome extension testing.

## Global Constraints

- Do not re-upload media or metadata and do not request another payment for historical records.
- Require canonical owner equality before linking any manifest row.
- Skip missing or ambiguous matches instead of guessing.
- Do not delete or rewrite Shelby objects, receipts, manifests, or unrelated local data.
- Keep the current cryptographic authorization and payment architecture unchanged.
- Preserve all untracked user directories.

---

## File structure

- Modify `app/server/public/ledger.js`: pure manifest-to-artifact hydration and historical `loadMine()` integration.
- Modify `app/server/public/app.js`: prefer explicit collection ids, include linked metadata in folder scope, and correct quote copy.
- Modify `app/server/public/metadata-page.js`: correct active and idle batch approval messaging.
- Modify `app/server/test/ledger-and-gallery.test.js`: ledger behavior and Gallery integration regression tests.
- Modify `app/server/test/metadata-page.test.js`: state-accurate approval copy regression test.

### Task 1: Hydrate historical ledger artifacts from collection manifests

**Files:**
- Modify: `app/server/public/ledger.js`
- Test: `app/server/test/ledger-and-gallery.test.js`

**Interfaces:**
- Produces: `linkArtifactsToCollectionManifests(artifacts, manifests) -> Array<object>`
- Consumes: existing `normalizeAptosLikeAddress`, `canonicalWalletAddress`, `LS.mine`, and `LS.collectionManifests`.

- [ ] **Step 1: Write the failing historical-link test**

Add an import for `linkArtifactsToCollectionManifests` and a test with two media records, two JSON records, and a manifest owned by `0xabc`:

```js
test('collection manifests hydrate historical media and TokenURI relationships', () => {
  const artifacts = [
    { key: 'media/1.svg', url: 'https://vessel.example/media/1.svg', contentType: 'image/svg+xml', account: '0xabc' },
    { key: 'media/2.svg', url: 'https://vessel.example/media/2.svg', contentType: 'image/svg+xml', account: '0xabc' },
    { key: 'media/1.json', url: 'https://vessel.example/media/1.json', contentType: 'application/json', account: '0xabc' },
    { key: 'media/2.json', url: 'https://vessel.example/media/2.json', contentType: 'application/json', account: '0xabc' },
  ];
  const manifests = [{
    id: 'VesselBatchTest',
    name: 'VesselBatchTest',
    storageAddress: '0xabc',
    rows: [
      { imageUrl: artifacts[0].url, metadataUrl: artifacts[2].url },
      { imageUrl: artifacts[1].url, metadataUrl: artifacts[3].url },
    ],
  }];

  const linked = linkArtifactsToCollectionManifests(artifacts, manifests);
  assert.equal(linked[0].tokenUri, artifacts[2].url);
  assert.equal(linked[0].collectionId, 'VesselBatchTest');
  assert.equal(linked[2].sourceArtifactKey, artifacts[0].key);
  assert.equal(linked[2].sourceArtifactUrl, artifacts[0].url);
  assert.equal(linked[2].collectionId, 'VesselBatchTest');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test app/server/test/ledger-and-gallery.test.js
```

Expected: FAIL because `linkArtifactsToCollectionManifests` is not exported.

- [ ] **Step 3: Add owner and ambiguity tests while still RED**

Add one test that supplies a foreign-owner manifest and one test with duplicate media URLs. Assert that neither produces `collectionId`, `tokenUri`, or `sourceArtifactKey`.

```js
assert.equal(linkedForeign[0].collectionId, undefined);
assert.equal(linkedAmbiguous.find((item) => item.key === 'media/1.json').sourceArtifactKey, undefined);
```

- [ ] **Step 4: Implement the pure linker**

Add focused helpers before `createLedger`:

```js
function resourceUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try { return new URL(text).href; } catch { return text; }
}

function artifactOwner(item) {
  return canonicalWalletAddress(normalizeAptosLikeAddress(item?.storageAddress || item?.account));
}

export function linkArtifactsToCollectionManifests(artifacts = [], manifests = []) {
  const linked = (Array.isArray(artifacts) ? artifacts : []).map((item) => ({ ...item }));
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    const collectionId = String(manifest?.id || manifest?.name || '').trim();
    const owner = canonicalWalletAddress(normalizeAptosLikeAddress(manifest?.storageAddress));
    if (!collectionId || !owner) continue;
    for (const row of Array.isArray(manifest?.rows) ? manifest.rows : []) {
      const imageUrl = resourceUrl(row?.imageUrl);
      const metadataUrl = resourceUrl(row?.metadataUrl);
      if (!imageUrl || !metadataUrl) continue;
      const mediaMatches = linked.filter((item) => artifactOwner(item) === owner && resourceUrl(item?.url) === imageUrl);
      const metadataMatches = linked.filter((item) => artifactOwner(item) === owner && [item?.url, item?.tokenUri, item?.metadataUrl].map(resourceUrl).includes(metadataUrl));
      if (mediaMatches.length !== 1 || metadataMatches.length !== 1) continue;
      const mediaIndex = linked.findIndex((item) => item.key === mediaMatches[0].key);
      const metadataIndex = linked.findIndex((item) => item.key === metadataMatches[0].key);
      linked[mediaIndex] = { ...linked[mediaIndex], collectionId, collectionName: String(manifest?.name || collectionId), tokenUri: metadataUrl, metadataUrl };
      linked[metadataIndex] = { ...linked[metadataIndex], collectionId, collectionName: String(manifest?.name || collectionId), tokenUri: metadataUrl, metadataUrl, sourceArtifactKey: linked[mediaIndex].key, sourceArtifactUrl: imageUrl };
    }
  }
  return linked;
}
```

- [ ] **Step 5: Hydrate `loadMine()`**

Replace the successful parsed-array return with:

```js
return Array.isArray(value)
  ? linkArtifactsToCollectionManifests(value, loadAllCollectionManifests())
  : [];
```

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```powershell
node --test app/server/test/ledger-and-gallery.test.js
```

Expected: all ledger and Gallery tests PASS.

- [ ] **Step 7: Commit Task 1**

```powershell
git add -- app/server/public/ledger.js app/server/test/ledger-and-gallery.test.js
git commit -m "Link collection manifests to Gallery artifacts"
```

### Task 2: Make Gallery folder scope consume explicit collection links

**Files:**
- Modify: `app/server/public/app.js`
- Test: `app/server/test/ledger-and-gallery.test.js`

**Interfaces:**
- Consumes: hydrated `collectionId`, `sourceArtifactKey`, and `sourceArtifactUrl` from Task 1.
- Produces: folder-scoped media and metadata rendering/export using one collection relationship.

- [ ] **Step 1: Write the failing Gallery source test**

Add assertions requiring explicit collection ids and both metadata association paths:

```js
assert.match(source, /const explicitCollection = String\(it\?\.collectionId \|\| ''\)\.trim\(\)/);
assert.match(source, /galleryCollectionId\(item\) === activeCollection \|\| mediaKeys\.has\(item\.sourceArtifactKey\)/);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test app/server/test/ledger-and-gallery.test.js
```

Expected: FAIL because Gallery currently infers collection only from custom folder or `sourcePath`.

- [ ] **Step 3: Prefer explicit manifest collection ids**

Update the collection resolver:

```js
function galleryCollectionId(it) {
  const explicitCollection = String(it?.collectionId || '').trim();
  const customFolder = String(it?.customFolder || '').trim();
  return explicitCollection || customFolder || folderCollectionId(it);
}
```

- [ ] **Step 4: Include linked metadata in folder scope**

Update `exportItemsForGallery`:

```js
const metadata = (items || []).filter((item) => (
  isMetadataArtifact(item)
  && (galleryCollectionId(item) === activeCollection || mediaKeys.has(item.sourceArtifactKey))
));
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```powershell
node --test app/server/test/ledger-and-gallery.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- app/server/public/app.js app/server/test/ledger-and-gallery.test.js
git commit -m "Show batch TokenURIs inside Gallery folders"
```

### Task 3: Make metadata approval copy reflect conditional wallet prompts

**Files:**
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/metadata-page.js`
- Test: `app/server/test/metadata-page.test.js`

**Interfaces:**
- Consumes: existing quote, recovery, and one-approval states.
- Produces: copy that does not promise a Petra popup when recovery or reuse can continue automatically.

- [ ] **Step 1: Write the failing copy regression test**

Add:

```js
test('metadata hosting explains conditional wallet signatures and recovery', () => {
  const page = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.doesNotMatch(page, /Each JSON receives its own Vessel fee receipt/);
  assert.doesNotMatch(app, /Your connected wallet will approve the Vessel fee receipt/);
  assert.match(page, /A fresh authorization may open your wallet/);
  assert.match(app, /Your wallet signs only when a fresh authorization is required/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test app/server/test/metadata-page.test.js
```

Expected: FAIL on the old unconditional wallet-popup language.

- [ ] **Step 3: Update active and idle batch copy**

Use:

```js
`Confirm item ${summary.completed + 1} of ${summary.total}. A fresh authorization may open your wallet; recoverable items continue automatically.`
```

and:

```js
`${summary.total} TokenURI quotes will be confirmed in Vessel. A fresh authorization may open your wallet; recoverable items continue without another payment.`
```

- [ ] **Step 4: Update quote confirmation copy**

Use:

```js
`${total} total, including Shelby storage cost, testnet DAA gas funding, and the Vessel service fee. Your wallet signs only when a fresh authorization is required; recoverable uploads continue automatically.`
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```powershell
node --test app/server/test/metadata-page.test.js app/server/test/ledger-and-gallery.test.js
```

Expected: all targeted tests PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- app/server/public/app.js app/server/public/metadata-page.js app/server/test/metadata-page.test.js
git commit -m "Clarify metadata wallet approval states"
```

### Task 4: Full verification, deployment, and production Chrome proof

**Files:**
- Verify only: `app/server/package.json`
- Verify only: production `https://vessel-sage.vercel.app`

**Interfaces:**
- Consumes: all changes from Tasks 1 through 3.
- Produces: deploy evidence and live confirmation without another Shelby payment.

- [ ] **Step 1: Run the full suite and build**

Run:

```powershell
npm run check
```

Working directory: `D:\Visell\app\server`

Expected: every Node test passes and all browser bundles report `BUNDLE OK`.

- [ ] **Step 2: Review the final diff and working tree**

Run:

```powershell
git diff --check
git status --short
git log -5 --oneline
```

Expected: no whitespace errors, only intended tracked changes committed, and all existing untracked user directories remain untouched.

- [ ] **Step 3: Push production branch**

```powershell
git push origin main
```

- [ ] **Step 4: Wait for Vercel production readiness**

```powershell
vercel ls vessel --scope team_AAMzTLcSOqJJS18PSwXljq6H
```

Expected: the newest production deployment is `Ready`.

- [ ] **Step 5: Verify historical linking in Chrome**

Open production Gallery in the user's Chrome, wait for the Petra session to restore, and open `VesselBatchTest`.

Expected without hosting again:

- six total artifacts remain
- two media files appear in the folder
- two TokenURI metadata cards appear in the folder
- folder export includes both media and metadata
- fee totals remain `$0.606036` total, `$0.000032` storage, and `$0.006004` service fee

- [ ] **Step 6: Verify TokenURI and proof**

Open one metadata JSON and its proof page.

Expected:

- JSON name is `VesselBatchTest #1` or `VesselBatchTest #2`
- JSON `image` resolves to the paired Shelby SVG
- proof page shows both absolute Media URL and TokenURI

- [ ] **Step 7: Record remaining external limitation**

Do not claim automated XLSX or ZIP download success unless Chrome produces a download event or a real file appears in `C:\Users\TBC\Downloads`. Keep this limitation separate from collection linking.
