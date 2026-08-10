# Multichain NFT Launch Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Launch Kit page that converts an existing wallet-scoped Shelby Vault collection into validated NFT handoff files for EVM ERC-721, EVM ERC-1155, Solana Metaplex Core, Solana Token Metadata, and Aptos Digital Asset.

**Architecture:** Keep the feature as a client-side preparation layer over the existing Vault ledger and collection manifest data. Add pure generator and validator modules first, then wire a new `launch.html` page and controller into the existing app shell. Export a ZIP package and individual files without minting NFTs, deploying contracts, calling marketplaces, or re-uploading media.

**Tech Stack:** Browser ESM, vanilla JavaScript, existing Vessel CSS/Tailwind build, Node test runner, local ZIP/XLSX utilities already present in `app/server/public/metadata-export.js`.

## Global Constraints

- Do not mint NFTs.
- Do not deploy ERC-721, ERC-1155, Solana, or Aptos NFT contracts.
- Do not create collections on chain.
- Do not submit marketplace listings.
- Do not call OpenSea, Magic Eden, Tensor, Rarible, or Aptos marketplace APIs.
- Do not refresh marketplace metadata.
- Do not encrypt Shelby media.
- Do not re-upload media as part of launch preparation.
- Do not promise permanent storage or production SLA.
- Use only existing wallet-scoped Vessel Vault data and existing hosted TokenURI metadata.
- Do not ask the user to select a local folder for Launch Kit.
- Label ShelbyNet storage as testnet beta data that can expire or be wiped.
- Exports must not include private keys, API keys, wallet signatures, recovery secrets, or raw authorization payloads.
- CSV files remain plain compatibility files. Rich formatting belongs in XLSX validation reports.
- All UI copy must say Vessel prepares launch data and does not mint NFTs.
- Existing untracked temporary directories must be preserved.

---

## File Structure

Create:

- `app/server/public/launch.html` - Launch Kit page shell using the current Vessel visual system.
- `app/server/public/launch-kit.js` - pure data normalization and chain output generators.
- `app/server/public/launch-kit-validator.js` - pure readiness validation.
- `app/server/public/launch-kit-export.js` - ZIP, manifest, checklist, per-target Blob builders.
- `app/server/public/launch-kit-page.js` - DOM controller for source selection, profile form, previews, downloads.
- `app/server/test/launch-kit.test.js` - generator and validation tests.
- `app/server/test/launch-kit-page.test.js` - static page, navigation, copy, and no-minting tests.

Modify:

- `app/server/public/app.js` - import and initialize `initLaunchKitPage`, add Launch Kit page dispatch, expose collection helper functions only if needed.
- `app/server/public/metadata-export.js` - export a reusable `buildStoredZip(entries, options)` wrapper around the existing private ZIP utilities.
- `app/server/public/index.html`, `identity.html`, `upload.html`, `gallery.html`, `metadata.html`, `collection.html`, `proof.html`, `latency.html` - add Launch Kit navigation link.
- `app/server/public/vessel.css` - small tooltip, preview, and target card styles only if existing utility classes are insufficient.
- `app/server/test/accessibility.test.js`, `ledger-and-gallery.test.js`, `latency-and-metadata.test.js`, `theme-and-landing.test.js` - update nav expectations and page hook assertions.
- `README.md` - add Launch Kit as a completed preparation feature with exact limitations.

No server route is required because Launch Kit uses URLs already stored in Vault and client-side generated exports.

---

### Task 1: Pure Launch Kit generators

**Files:**

- Create: `app/server/public/launch-kit.js`
- Test: `app/server/test/launch-kit.test.js`

**Interfaces:**

- Consumes:
  - Collection object from `groupVaultCollections(artifacts, { storageAddress, now, verification })`
  - Collection manifest from `ledger.loadCollectionManifests(storageAddress)`
- Produces:
  - `DEFAULT_LAUNCH_TARGETS: Readonly<object>`
  - `toErc1155Hex64(tokenId: number | string | bigint): string`
  - `defaultLaunchProfile(collection: object, options?: object): object`
  - `buildLaunchItems(collection: object, manifests?: object[], options?: object): object[]`
  - `buildContractUri(profile: object): object`
  - `buildErc721Rows(profile: object, items: object[]): object[]`
  - `buildErc1155Rows(profile: object, items: object[]): object[]`
  - `buildSolanaCoreRows(profile: object, items: object[]): object[]`
  - `buildSolanaTokenMetadataRows(profile: object, items: object[]): object[]`
  - `buildAptosDigitalAssetRows(profile: object, items: object[]): object[]`
  - `rowsToCsv(rows: object[]): string`

- [ ] **Step 1: Write failing generator tests**

Add these tests to `app/server/test/launch-kit.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAptosDigitalAssetRows,
  buildContractUri,
  buildErc1155Rows,
  buildErc721Rows,
  buildLaunchItems,
  buildSolanaCoreRows,
  buildSolanaTokenMetadataRows,
  defaultLaunchProfile,
  rowsToCsv,
  toErc1155Hex64,
} from '../public/launch-kit.js';

function collectionFixture() {
  return {
    id: 'genesis',
    name: 'Genesis',
    itemCount: 2,
    totalBytes: 3000,
    earliestExpiry: 1_786_000_000,
    verification: 'shelby',
    items: [
      {
        key: 'media/genesis/alpha.png',
        url: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.png',
        sourcePath: 'Genesis/alpha.png',
        contentType: 'image/png',
        size: 1000,
        expiresAt: 1_786_000_000,
        metadataUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.json',
      },
      {
        key: 'media/genesis/beta.svg',
        url: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/beta.svg',
        sourcePath: 'Genesis/beta.svg',
        contentType: 'image/svg+xml',
        size: 2000,
        expiresAt: 1_786_000_000,
        tokenUri: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/beta.json',
      },
    ],
  };
}

function manifestFixture() {
  return [{
    id: 'genesis',
    name: 'Genesis',
    rows: [
      {
        itemName: 'Genesis #1',
        sourcePath: 'Genesis/alpha.png',
        imageUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.png',
        metadataPath: 'metadata/alpha.json',
        metadataUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.json',
      },
      {
        itemName: 'Genesis #2',
        sourcePath: 'Genesis/beta.svg',
        imageUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/beta.svg',
        metadataPath: 'metadata/beta.json',
        metadataUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/beta.json',
      },
    ],
  }];
}

test('ERC-1155 token IDs are lowercase 64-character hex strings', () => {
  assert.equal(
    toErc1155Hex64(255),
    '00000000000000000000000000000000000000000000000000000000000000ff',
  );
});

test('launch items preserve folder filenames and hosted TokenURI relationships', () => {
  const items = buildLaunchItems(collectionFixture(), manifestFixture(), { tokenIdStart: 7 });
  assert.equal(items.length, 2);
  assert.equal(items[0].tokenId, 7);
  assert.equal(items[0].displayName, 'Genesis #1');
  assert.equal(items[0].sourcePath, 'Genesis/alpha.png');
  assert.equal(items[0].mediaUrl, 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.png');
  assert.equal(items[0].tokenUri, 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.json');
  assert.equal(items[1].displayName, 'Genesis #2');
});

test('chain output generators create expected handoff rows', () => {
  const collection = collectionFixture();
  const profile = {
    ...defaultLaunchProfile(collection, { storageAddress: '0xabc' }),
    collectionName: 'Genesis',
    symbol: 'GEN',
    description: 'A Shelby-hosted beta NFT media collection.',
    creatorWallet: '0xabc',
    royaltyPercent: 5,
    externalLink: 'https://vessel-sage.vercel.app',
    avatarImageUrl: collection.items[0].url,
    bannerImageUrl: collection.items[1].url,
    featuredImageUrl: collection.items[0].url,
  };
  const items = buildLaunchItems(collection, manifestFixture(), { tokenIdStart: 1 });

  assert.deepEqual(buildContractUri(profile), {
    name: 'Genesis',
    description: 'A Shelby-hosted beta NFT media collection.',
    image: collection.items[0].url,
    banner_image: collection.items[1].url,
    featured_image: collection.items[0].url,
    external_link: 'https://vessel-sage.vercel.app',
  });
  assert.equal(buildErc721Rows(profile, items)[0].token_id, '1');
  assert.equal(buildErc1155Rows(profile, items)[0].token_id_hex64.endsWith('01'), true);
  assert.equal(buildSolanaCoreRows(profile, items)[0].asset_name, 'Genesis #1');
  assert.equal(buildSolanaTokenMetadataRows(profile, items)[0].seller_fee_basis_points, '500');
  assert.equal(buildAptosDigitalAssetRows(profile, items)[0].collection_name, 'Genesis');
});

test('rowsToCsv quotes commas and line breaks', () => {
  const csv = rowsToCsv([{ name: 'Genesis, One', description: 'Line 1\nLine 2' }]);
  assert.equal(csv, 'name,description\r\n"Genesis, One","Line 1\nLine 2"\r\n');
});
```

- [ ] **Step 2: Run the tests and verify missing module failure**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "ERC-1155|launch items|chain output|rowsToCsv"
```

Expected: FAIL with `Cannot find module '../public/launch-kit.js'`.

- [ ] **Step 3: Implement `launch-kit.js`**

Create `app/server/public/launch-kit.js` with:

```js
const HTTPS_OR_DECENTRALIZED = /^(https:\/\/|ipfs:\/\/|ar:\/\/)/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export const DEFAULT_LAUNCH_TARGETS = Object.freeze({
  evmErc721: true,
  evmErc1155: true,
  solanaCore: true,
  solanaTokenMetadata: true,
  aptosDigitalAsset: true,
});

function text(value) {
  return String(value ?? '').trim();
}

function absoluteUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  return HTTPS_OR_DECENTRALIZED.test(raw) ? raw : '';
}

function basename(value) {
  return text(value).replaceAll('\\', '/').split('/').filter(Boolean).pop() || '';
}

function withoutExtension(value) {
  return text(value).replace(/\.[^.]+$/, '');
}

function sourcePath(item) {
  return text(item?.sourcePath || item?.key || item?.path).replaceAll('\\', '/');
}

function sourceSort(left, right) {
  return collator.compare(sourcePath(left), sourcePath(right));
}

function manifestRowsForCollection(manifests, collection) {
  const collectionId = text(collection?.id).toLowerCase();
  const collectionName = text(collection?.name).toLowerCase();
  const found = (Array.isArray(manifests) ? manifests : []).find((manifest) => {
    const id = text(manifest?.id).toLowerCase();
    const name = text(manifest?.name).toLowerCase();
    return id === collectionId || name === collectionName;
  });
  return Array.isArray(found?.rows) ? found.rows : [];
}

function manifestRowByMediaUrl(rows) {
  const map = new Map();
  for (const row of rows) {
    const mediaUrl = text(row?.imageUrl);
    if (mediaUrl) map.set(mediaUrl, row);
  }
  return map;
}

function cleanTargets(targets) {
  return Object.freeze({
    ...DEFAULT_LAUNCH_TARGETS,
    ...(targets || {}),
  });
}

function inferDisplayName(item, index, collectionName, manifestRow) {
  const manifestName = text(manifestRow?.itemName);
  if (manifestName) return manifestName;
  const stem = withoutExtension(basename(sourcePath(item)));
  if (stem) return stem;
  return `${collectionName || 'Vessel Collection'} #${index + 1}`;
}

function inferAttributes(item, manifestRow) {
  const values = item?.attributes || item?.metadata?.attributes || manifestRow?.attributes;
  return Array.isArray(values)
    ? values.map((entry) => ({
      trait_type: text(entry?.trait_type || entry?.traitType || entry?.name),
      value: entry?.value,
      ...(entry?.display_type ? { display_type: entry.display_type } : {}),
      ...(entry?.max_value !== undefined ? { max_value: entry.max_value } : {}),
    })).filter((entry) => entry.trait_type && entry.value !== undefined)
    : [];
}

export function toErc1155Hex64(tokenId) {
  let bigint;
  try {
    bigint = BigInt(tokenId);
  } catch {
    throw new TypeError('ERC-1155 token ID must be an integer');
  }
  if (bigint < 0n) throw new TypeError('ERC-1155 token ID must be positive');
  const hex = bigint.toString(16);
  if (hex.length > 64) throw new TypeError('ERC-1155 token ID exceeds 256 bits');
  return hex.padStart(64, '0');
}

export function defaultLaunchProfile(collection, options = {}) {
  const firstImage = collection?.items?.find((item) => absoluteUrl(item?.url))?.url || '';
  return Object.freeze({
    collectionId: text(collection?.id),
    collectionName: text(collection?.name || collection?.id || 'Vessel Collection'),
    symbol: '',
    description: 'ShelbyNet beta NFT media prepared by Vessel. Storage is testnet data and can expire or be wiped.',
    creatorWallet: text(options.storageAddress || ''),
    royaltyPercent: null,
    externalLink: text(options.origin || globalThis.location?.origin || ''),
    avatarImageUrl: firstImage,
    bannerImageUrl: '',
    featuredImageUrl: firstImage,
    tokenIdStart: Number.isSafeInteger(Number(options.tokenIdStart)) ? Number(options.tokenIdStart) : 1,
    targets: cleanTargets(options.targets),
  });
}

export function buildLaunchItems(collection, manifests = [], options = {}) {
  const tokenIdStart = Number.isSafeInteger(Number(options.tokenIdStart)) ? Number(options.tokenIdStart) : 1;
  const rows = manifestRowsForCollection(manifests, collection);
  const byMediaUrl = manifestRowByMediaUrl(rows);
  const collectionName = text(collection?.name || collection?.id || 'Vessel Collection');
  return Object.freeze([...(collection?.items || [])].sort(sourceSort).map((item, index) => {
    const mediaUrl = absoluteUrl(item?.url);
    const row = byMediaUrl.get(mediaUrl);
    const tokenId = tokenIdStart + index;
    const tokenUri = absoluteUrl(item?.tokenUri || item?.metadataUrl || row?.metadataUrl);
    return Object.freeze({
      index,
      tokenId,
      tokenIdHex64: toErc1155Hex64(tokenId),
      sourcePath: sourcePath(item),
      displayName: inferDisplayName(item, index, collectionName, row),
      mediaUrl,
      tokenUri,
      metadataKey: text(item?.metadataKey || item?.sourceArtifactKey || row?.metadataPath),
      contentType: text(item?.contentType),
      sizeBytes: Number(item?.size || item?.sizeBytes || 0),
      expiresAt: item?.expiresAt ? new Date(Number(item.expiresAt) * 1000).toISOString() : '',
      attributes: Object.freeze(inferAttributes(item, row)),
    });
  }));
}

export function buildContractUri(profile) {
  return {
    name: text(profile?.collectionName),
    description: text(profile?.description),
    image: absoluteUrl(profile?.avatarImageUrl || profile?.featuredImageUrl),
    banner_image: absoluteUrl(profile?.bannerImageUrl),
    featured_image: absoluteUrl(profile?.featuredImageUrl || profile?.avatarImageUrl),
    external_link: text(profile?.externalLink),
  };
}

export function buildErc721Rows(profile, items) {
  return items.map((item) => ({
    token_id: String(item.tokenId),
    name: item.displayName,
    token_uri: item.tokenUri,
    media_url: item.mediaUrl,
    source_path: item.sourcePath,
    metadata_status: item.tokenUri ? 'hosted' : 'missing',
    expires_at: item.expiresAt,
  }));
}

export function buildErc1155Rows(profile, items) {
  return items.map((item) => ({
    token_id_decimal: String(item.tokenId),
    token_id_hex64: item.tokenIdHex64,
    uri: item.tokenUri,
    uri_template_example: item.tokenUri ? item.tokenUri.replace(/\/[^/]*$/, '/{id}.json') : '',
    name: item.displayName,
    media_url: item.mediaUrl,
    source_path: item.sourcePath,
    metadata_status: item.tokenUri ? 'hosted' : 'missing',
    expires_at: item.expiresAt,
  }));
}

export function buildSolanaCoreRows(profile, items) {
  return items.map((item) => ({
    asset_name: item.displayName,
    collection_name: text(profile?.collectionName),
    uri: item.tokenUri,
    image: item.mediaUrl,
    category: item.contentType.startsWith('video/') ? 'video' : 'image',
    external_url: text(profile?.externalLink),
    royalty_percent: profile?.royaltyPercent ?? '',
    source_path: item.sourcePath,
    expires_at: item.expiresAt,
  }));
}

export function buildSolanaTokenMetadataRows(profile, items) {
  const royalty = profile?.royaltyPercent;
  const basisPoints = Number.isFinite(Number(royalty)) ? String(Math.round(Number(royalty) * 100)) : '';
  return items.map((item) => ({
    name: item.displayName,
    symbol: text(profile?.symbol),
    uri: item.tokenUri,
    seller_fee_basis_points: basisPoints,
    collection_name: text(profile?.collectionName),
    image: item.mediaUrl,
    source_path: item.sourcePath,
    expires_at: item.expiresAt,
  }));
}

export function buildAptosDigitalAssetRows(profile, items) {
  return items.map((item) => ({
    collection_name: text(profile?.collectionName),
    collection_description: text(profile?.description),
    collection_uri: absoluteUrl(profile?.featuredImageUrl || profile?.avatarImageUrl),
    token_name: item.displayName,
    token_description: `${item.displayName} media hosted on ShelbyNet beta through Vessel.`,
    token_uri: item.tokenUri,
    creator_wallet: text(profile?.creatorWallet),
    source_path: item.sourcePath,
    expires_at: item.expiresAt,
  }));
}

export function rowsToCsv(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = [...safeRows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set())];
  const encode = (value) => {
    const raw = String(value ?? '');
    return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  };
  return [
    headers.map(encode).join(','),
    ...safeRows.map((row) => headers.map((header) => encode(row?.[header])).join(',')),
  ].join('\r\n') + '\r\n';
}

export function hasSupportedMediaExtension(item) {
  return IMAGE_EXTENSION.test(sourcePath(item)) || String(item?.contentType || '').startsWith('image/');
}
```

- [ ] **Step 4: Run generator tests**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "ERC-1155|launch items|chain output|rowsToCsv"
```

Expected: PASS for the four new tests.

- [ ] **Step 5: Commit**

Run:

```powershell
Set-Location D:\Visell
git add app/server/public/launch-kit.js app/server/test/launch-kit.test.js
git commit -m "Add multichain launch kit generators"
```

Expected: commit succeeds.

---

### Task 2: Readiness validator

**Files:**

- Create: `app/server/public/launch-kit-validator.js`
- Modify: `app/server/test/launch-kit.test.js`

**Interfaces:**

- Consumes:
  - `LaunchProfile` from `defaultLaunchProfile`
  - `LaunchItem[]` from `buildLaunchItems`
- Produces:
  - `validateLaunchKit({ collection, profile, items, nowMs?: number }): { errors: object[], warnings: object[], notes: object[], targetStatus: object }`
  - issue object shape: `{ severity: 'error' | 'warning' | 'note', code: string, target: string, itemIndex: number | null, field: string, message: string }`

- [ ] **Step 1: Add failing validator tests**

Append to `app/server/test/launch-kit.test.js`:

```js
import { validateLaunchKit } from '../public/launch-kit-validator.js';

test('validator blocks target outputs with missing TokenURI and contract image', () => {
  const collection = collectionFixture();
  const profile = {
    ...defaultLaunchProfile(collection),
    collectionName: 'Genesis',
    description: 'Shelby launch handoff.',
    avatarImageUrl: '',
    featuredImageUrl: '',
  };
  const items = buildLaunchItems({
    ...collection,
    items: collection.items.map((item) => ({ ...item, tokenUri: '', metadataUrl: '' })),
  }, [], { tokenIdStart: 1 });

  const result = validateLaunchKit({ collection, profile, items, nowMs: Date.UTC(2026, 7, 11) });
  assert.equal(result.errors.some((issue) => issue.code === 'token_uri_missing'), true);
  assert.equal(result.errors.some((issue) => issue.code === 'contract_uri_image_missing'), true);
  assert.equal(result.targetStatus.evmErc721.valid, false);
  assert.equal(result.targetStatus.evmErc1155.valid, false);
});

test('validator warns for cache-only collections, short expiry, royalties, and missing traits', () => {
  const collection = { ...collectionFixture(), verification: 'vault-cache' };
  const profile = {
    ...defaultLaunchProfile(collection),
    collectionName: 'Genesis',
    description: 'Short',
    avatarImageUrl: collection.items[0].url,
    royaltyPercent: 12,
  };
  const items = buildLaunchItems(collection, manifestFixture(), { tokenIdStart: 1 });
  const result = validateLaunchKit({ collection, profile, items, nowMs: Date.UTC(2026, 7, 10) });

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.some((issue) => issue.code === 'collection_cache_only'), true);
  assert.equal(result.warnings.some((issue) => issue.code === 'royalty_high'), true);
  assert.equal(result.warnings.some((issue) => issue.code === 'attributes_missing'), true);
  assert.equal(result.notes.some((issue) => issue.code === 'vessel_does_not_mint'), true);
});

test('validator blocks Aptos duplicate token names and ERC-1155 duplicate token IDs', () => {
  const collection = collectionFixture();
  const profile = {
    ...defaultLaunchProfile(collection),
    collectionName: 'Genesis',
    description: 'A Shelby-hosted beta NFT media collection.',
    avatarImageUrl: collection.items[0].url,
  };
  const items = buildLaunchItems(collection, manifestFixture(), { tokenIdStart: 1 })
    .map((item) => ({ ...item, displayName: 'Duplicate', tokenId: 1 }));
  const result = validateLaunchKit({ collection, profile, items, nowMs: Date.UTC(2026, 7, 11) });

  assert.equal(result.errors.some((issue) => issue.code === 'token_id_collision'), true);
  assert.equal(result.errors.some((issue) => issue.code === 'aptos_token_name_collision'), true);
  assert.equal(result.targetStatus.aptosDigitalAsset.valid, false);
});
```

- [ ] **Step 2: Run validator tests and verify failure**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "validator"
```

Expected: FAIL with `Cannot find module '../public/launch-kit-validator.js'`.

- [ ] **Step 3: Implement validator**

Create `app/server/public/launch-kit-validator.js` with:

```js
const URL_PATTERN = /^(https:\/\/|ipfs:\/\/|ar:\/\/)/i;
const TARGETS = Object.freeze(['evmErc721', 'evmErc1155', 'solanaCore', 'solanaTokenMetadata', 'aptosDigitalAsset', 'opensea']);

function text(value) {
  return String(value ?? '').trim();
}

function issue(severity, code, target, message, details = {}) {
  return Object.freeze({
    severity,
    code,
    target,
    itemIndex: Number.isInteger(details.itemIndex) ? details.itemIndex : null,
    field: text(details.field),
    message,
  });
}

function validUrl(value) {
  return URL_PATTERN.test(text(value));
}

function daysUntil(epochSeconds, nowMs) {
  const value = Number(epochSeconds);
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return (value * 1000 - nowMs) / 86_400_000;
}

function targetStatus(errors) {
  const status = Object.fromEntries(TARGETS.map((target) => [target, { valid: true, errorCount: 0 }]));
  for (const entry of errors) {
    const key = TARGETS.includes(entry.target) ? entry.target : 'opensea';
    status[key] = { valid: false, errorCount: status[key].errorCount + 1 };
  }
  return Object.freeze(status);
}

export function validateLaunchKit({ collection, profile, items, nowMs = Date.now() } = {}) {
  const errors = [];
  const warnings = [];
  const notes = [
    issue('note', 'shelbynet_testnet_beta', 'all', 'ShelbyNet is a testnet beta and data can expire or be wiped.'),
    issue('note', 'vessel_does_not_mint', 'all', 'Vessel prepares launch handoff files and does not mint NFTs.'),
    issue('note', 'marketplace_cache', 'all', 'Marketplaces can cache metadata and may require refresh after changes.'),
    issue('note', 'erc4906_available', 'evmErc721', 'EVM contracts that intentionally update metadata can emit ERC-4906 events.'),
  ];
  const safeItems = Array.isArray(items) ? items : [];

  if (!collection) errors.push(issue('error', 'collection_missing', 'all', 'Select a Shelby Vault collection before export.'));
  if (safeItems.length === 0) errors.push(issue('error', 'collection_empty', 'all', 'The selected collection has no media artifacts.'));
  if (!text(profile?.collectionName)) errors.push(issue('error', 'collection_name_missing', 'all', 'Collection name is required.'));
  if (!text(profile?.description)) errors.push(issue('error', 'description_missing', 'all', 'Collection description is required.'));
  if (!validUrl(profile?.avatarImageUrl || profile?.featuredImageUrl)) {
    errors.push(issue('error', 'contract_uri_image_missing', 'opensea', 'OpenSea contractURI requires an HTTPS, IPFS, or Arweave image URL.', { field: 'avatarImageUrl' }));
  }

  const tokenIds = new Set();
  const aptosNames = new Set();
  for (const item of safeItems) {
    if (tokenIds.has(item.tokenId)) {
      errors.push(issue('error', 'token_id_collision', 'evmErc1155', `Token ID ${item.tokenId} is duplicated.`, { itemIndex: item.index, field: 'tokenId' }));
    }
    tokenIds.add(item.tokenId);
    const aptosName = text(item.displayName).toLowerCase();
    if (aptosNames.has(aptosName)) {
      errors.push(issue('error', 'aptos_token_name_collision', 'aptosDigitalAsset', `Aptos token name "${item.displayName}" is duplicated.`, { itemIndex: item.index, field: 'displayName' }));
    }
    aptosNames.add(aptosName);
    if (!validUrl(item.mediaUrl)) {
      errors.push(issue('error', 'media_url_invalid', 'all', `Media URL is missing or unsupported for ${item.sourcePath}.`, { itemIndex: item.index, field: 'mediaUrl' }));
    }
    if (!validUrl(item.tokenUri)) {
      errors.push(issue('error', 'token_uri_missing', 'all', `Hosted TokenURI metadata is required for ${item.sourcePath}.`, { itemIndex: item.index, field: 'tokenUri' }));
    }
    if (!item.attributes?.length) {
      warnings.push(issue('warning', 'attributes_missing', 'all', `${item.sourcePath} has no NFT traits.`, { itemIndex: item.index, field: 'attributes' }));
    }
    if (Number(item.sizeBytes) > 50 * 1024 * 1024) {
      warnings.push(issue('warning', 'media_large', 'all', `${item.sourcePath} is larger than 50 MB.`, { itemIndex: item.index, field: 'sizeBytes' }));
    }
  }

  if (collection?.verification === 'vault-cache') {
    warnings.push(issue('warning', 'collection_cache_only', 'all', 'This collection was reconstructed from browser-local Vault cache.'));
  }
  if (daysUntil(collection?.earliestExpiry, nowMs) < 7) {
    warnings.push(issue('warning', 'expiration_under_7_days', 'all', 'At least one Shelby artifact expires in under 7 days.'));
  }
  if (profile?.royaltyPercent === null || profile?.royaltyPercent === '' || profile?.royaltyPercent === undefined) {
    warnings.push(issue('warning', 'royalty_blank', 'solanaTokenMetadata', 'Royalty percent is blank, so seller fee basis points will be blank.'));
  } else if (Number(profile.royaltyPercent) > 10) {
    warnings.push(issue('warning', 'royalty_high', 'all', 'Royalty percent is greater than 10%.'));
  }
  if (text(profile?.description).length > 0 && text(profile?.description).length < 20) {
    warnings.push(issue('warning', 'description_short', 'all', 'Collection description is short for marketplace display.'));
  }

  return Object.freeze({
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    notes: Object.freeze(notes),
    targetStatus: targetStatus(errors),
  });
}
```

- [ ] **Step 4: Run validator tests**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "validator"
```

Expected: PASS for validator tests.

- [ ] **Step 5: Commit**

Run:

```powershell
Set-Location D:\Visell
git add app/server/public/launch-kit-validator.js app/server/test/launch-kit.test.js
git commit -m "Add launch kit validation rules"
```

Expected: commit succeeds.

---

### Task 3: Reusable ZIP export and package builder

**Files:**

- Modify: `app/server/public/metadata-export.js`
- Create: `app/server/public/launch-kit-export.js`
- Modify: `app/server/test/launch-kit.test.js`

**Interfaces:**

- Consumes:
  - `buildStyledWorkbook(rows, { name })`
  - `rowsToCsv`
  - output row arrays from Task 1
  - validation result from Task 2
- Produces:
  - `buildStoredZip(entries: Array<{ path: string, content: string }>, options?: { type?: string }): Blob`
  - `buildLaunchOutputs(profile: object, items: object[], validation: object, options?: object): object`
  - `buildLaunchPackageZip(outputs: object): Blob`
  - `launchPackageFileName(profile: object): string`

- [ ] **Step 1: Add failing export tests**

Append to `app/server/test/launch-kit.test.js`:

```js
import { buildLaunchOutputs, launchPackageFileName } from '../public/launch-kit-export.js';

test('launch export package includes manifest, checklist, validation report, and chain files', async () => {
  const collection = collectionFixture();
  const profile = {
    ...defaultLaunchProfile(collection, { storageAddress: '0xabc', origin: 'https://vessel-sage.vercel.app' }),
    collectionName: 'Genesis',
    symbol: 'GEN',
    description: 'A Shelby-hosted beta NFT media collection.',
    avatarImageUrl: collection.items[0].url,
    featuredImageUrl: collection.items[0].url,
    royaltyPercent: 1,
  };
  const items = buildLaunchItems(collection, manifestFixture(), { tokenIdStart: 1 });
  const validation = validateLaunchKit({ collection, profile, items, nowMs: Date.UTC(2026, 7, 11) });
  const outputs = buildLaunchOutputs(profile, items, validation, {
    collection,
    vesselOrigin: 'https://vessel-sage.vercel.app',
    storageRuntime: 'shelbynet',
    storageAddress: '0xabc',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });

  assert.equal(outputs.entries.some((entry) => entry.path === 'vessel-launch-kit/manifest.json'), true);
  assert.equal(outputs.entries.some((entry) => entry.path === 'vessel-launch-kit/launch-checklist.md'), true);
  assert.equal(outputs.entries.some((entry) => entry.path === 'vessel-launch-kit/opensea/contractURI.json'), true);
  assert.equal(outputs.entries.some((entry) => entry.path === 'vessel-launch-kit/evm/erc721-tokenuris.csv'), true);
  assert.equal(outputs.entries.some((entry) => entry.path === 'vessel-launch-kit/evm/erc1155-tokenuris.csv'), true);
  assert.equal(outputs.entries.some((entry) => entry.path === 'vessel-launch-kit/solana/metaplex-core-assets.csv'), true);
  assert.equal(outputs.entries.some((entry) => entry.path === 'vessel-launch-kit/solana/token-metadata-assets.csv'), true);
  assert.equal(outputs.entries.some((entry) => entry.path === 'vessel-launch-kit/aptos/digital-asset-tokens.csv'), true);
  assert.equal(outputs.entries.some((entry) => /private|secret|signature/i.test(entry.content)), false);
  assert.equal(outputs.zip.type, 'application/zip');
  assert.equal(outputs.validationWorkbook.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('launch package file name is safe and readable', () => {
  assert.equal(launchPackageFileName({ collectionName: 'Genesis: Alpha/Beta' }), 'genesis-alpha-beta-launch-kit.zip');
});
```

- [ ] **Step 2: Run export tests and verify failure**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "launch export|launch package file"
```

Expected: FAIL with missing `launch-kit-export.js` or missing `buildStoredZip`.

- [ ] **Step 3: Export reusable ZIP helper**

Modify the bottom section of `app/server/public/metadata-export.js` by adding this function before `metadataJsonFile`:

```js
export function buildStoredZip(entries, { type = 'application/zip' } = {}) {
  const safeEntries = (Array.isArray(entries) ? entries : []).map((entry) => makeEntry(entry.path, entry.content));
  return zipEntries(safeEntries, type);
}
```

- [ ] **Step 4: Implement package builder**

Create `app/server/public/launch-kit-export.js` with:

```js
import { buildStoredZip, buildStyledWorkbook } from './metadata-export.js';
import {
  buildAptosDigitalAssetRows,
  buildContractUri,
  buildErc1155Rows,
  buildErc721Rows,
  buildSolanaCoreRows,
  buildSolanaTokenMetadataRows,
  rowsToCsv,
} from './launch-kit.js';

function slug(value) {
  return String(value || 'vessel')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'vessel';
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validationRows(validation) {
  return [
    ['Severity', 'Target', 'Code', 'Item', 'Field', 'Message'],
    ...['errors', 'warnings', 'notes'].flatMap((kind) => (validation?.[kind] || []).map((issue) => [
      issue.severity,
      issue.target,
      issue.code,
      issue.itemIndex === null ? '' : String(issue.itemIndex + 1),
      issue.field,
      issue.message,
    ])),
  ];
}

function checklist(profile, collection, validation) {
  const errorCount = validation?.errors?.length || 0;
  const warningCount = validation?.warnings?.length || 0;
  return [
    `# ${profile.collectionName} Launch Checklist`,
    '',
    'Vessel prepares NFT launch handoff files. It does not mint NFTs or deploy contracts.',
    '',
    `- Collection: ${profile.collectionName}`,
    `- Items: ${collection?.itemCount || 0}`,
    `- Runtime: ShelbyNet testnet beta`,
    `- Validation errors: ${errorCount}`,
    `- Validation warnings: ${warningCount}`,
    '',
    '## Before minting',
    '',
    '- Confirm every TokenURI opens in a browser.',
    '- Confirm every metadata JSON contains an image or animation URL that opens in a browser.',
    '- Confirm ShelbyNet testnet retention is acceptable for the demo.',
    '- Use ERC-721 tokenURI rows for ERC-721 contracts.',
    '- Use ERC-1155 hex rows when a contract uses {id}.json URI substitution.',
    '- Use Solana rows as a developer handoff for Metaplex Core or Token Metadata.',
    '- Use Aptos rows as a developer handoff for Aptos Digital Asset collection and token creation.',
    '',
  ].join('\n');
}

export function launchPackageFileName(profile) {
  return `${slug(profile?.collectionName)}-launch-kit.zip`;
}

export function buildLaunchOutputs(profile, items, validation, options = {}) {
  const collection = options.collection || {};
  const contractUri = buildContractUri(profile);
  const erc721Rows = buildErc721Rows(profile, items);
  const erc1155Rows = buildErc1155Rows(profile, items);
  const solanaCoreRows = buildSolanaCoreRows(profile, items);
  const solanaTokenMetadataRows = buildSolanaTokenMetadataRows(profile, items);
  const aptosRows = buildAptosDigitalAssetRows(profile, items);
  const manifest = {
    version: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    vesselOrigin: String(options.vesselOrigin || globalThis.location?.origin || ''),
    storageRuntime: options.storageRuntime || 'shelbynet',
    storageAddress: String(options.storageAddress || ''),
    collection: {
      id: String(collection.id || profile.collectionId || ''),
      name: String(profile.collectionName || collection.name || ''),
      symbol: String(profile.symbol || ''),
      description: String(profile.description || ''),
      itemCount: items.length,
      earliestExpiry: collection.earliestExpiry ? new Date(Number(collection.earliestExpiry) * 1000).toISOString() : '',
      verification: collection.verification === 'vault-cache' ? 'vault-cache' : 'shelby',
    },
    targets: Object.entries(profile.targets || {}).filter(([, enabled]) => enabled).map(([key]) => key),
    outputs: [
      { kind: 'opensea-contract-uri', path: 'opensea/contractURI.json', valid: validation?.targetStatus?.opensea?.valid !== false },
      { kind: 'evm-erc721', path: 'evm/erc721-tokenuris.csv', rowCount: erc721Rows.length, valid: validation?.targetStatus?.evmErc721?.valid !== false },
      { kind: 'evm-erc1155', path: 'evm/erc1155-tokenuris.csv', rowCount: erc1155Rows.length, valid: validation?.targetStatus?.evmErc1155?.valid !== false },
      { kind: 'solana-core', path: 'solana/metaplex-core-assets.csv', rowCount: solanaCoreRows.length, valid: validation?.targetStatus?.solanaCore?.valid !== false },
      { kind: 'solana-token-metadata', path: 'solana/token-metadata-assets.csv', rowCount: solanaTokenMetadataRows.length, valid: validation?.targetStatus?.solanaTokenMetadata?.valid !== false },
      { kind: 'aptos-digital-asset', path: 'aptos/digital-asset-tokens.csv', rowCount: aptosRows.length, valid: validation?.targetStatus?.aptosDigitalAsset?.valid !== false },
    ],
  };
  const entries = [
    { path: 'vessel-launch-kit/manifest.json', content: json(manifest) },
    { path: 'vessel-launch-kit/launch-checklist.md', content: checklist(profile, collection, validation) },
    { path: 'vessel-launch-kit/opensea/contractURI.json', content: json(contractUri) },
    { path: 'vessel-launch-kit/evm/erc721-tokenuris.csv', content: rowsToCsv(erc721Rows) },
    { path: 'vessel-launch-kit/evm/erc1155-tokenuris.csv', content: rowsToCsv(erc1155Rows) },
    { path: 'vessel-launch-kit/solana/metaplex-core-assets.csv', content: rowsToCsv(solanaCoreRows) },
    { path: 'vessel-launch-kit/solana/token-metadata-assets.csv', content: rowsToCsv(solanaTokenMetadataRows) },
    { path: 'vessel-launch-kit/aptos/digital-asset-tokens.csv', content: rowsToCsv(aptosRows) },
  ];
  const validationWorkbook = buildStyledWorkbook(validationRows(validation), { name: 'Launch Validation' });
  return Object.freeze({
    manifest,
    contractUri,
    rows: Object.freeze({ erc721Rows, erc1155Rows, solanaCoreRows, solanaTokenMetadataRows, aptosRows }),
    entries: Object.freeze(entries),
    validationWorkbook,
    zip: buildStoredZip(entries),
  });
}
```

- [ ] **Step 5: Run export tests**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "launch export|launch package file"
```

Expected: PASS for export tests.

- [ ] **Step 6: Commit**

Run:

```powershell
Set-Location D:\Visell
git add app/server/public/metadata-export.js app/server/public/launch-kit-export.js app/server/test/launch-kit.test.js
git commit -m "Add launch kit export package builder"
```

Expected: commit succeeds.

---

### Task 4: Launch Kit page shell and navigation

**Files:**

- Create: `app/server/public/launch.html`
- Modify: `app/server/public/index.html`
- Modify: `app/server/public/identity.html`
- Modify: `app/server/public/upload.html`
- Modify: `app/server/public/gallery.html`
- Modify: `app/server/public/metadata.html`
- Modify: `app/server/public/collection.html`
- Modify: `app/server/public/proof.html`
- Modify: `app/server/public/latency.html`
- Test: `app/server/test/launch-kit-page.test.js`
- Modify: `app/server/test/accessibility.test.js`
- Modify: `app/server/test/latency-and-metadata.test.js`
- Modify: `app/server/test/theme-and-landing.test.js`

**Interfaces:**

- Consumes:
  - Existing `/tailwind.css`, `/vessel.css`, `/app.js`
  - Existing `.js-connect` wallet button behavior
- Produces:
  - HTML hook IDs:
    - `launch-root`
    - `launch-wallet-status`
    - `launch-storage-address`
    - `launch-collection-list`
    - `launch-profile-form`
    - `launch-targets`
    - `launch-validation`
    - `launch-output-preview`
    - `launch-download-package`
    - `launch-download-contract-uri`
    - `launch-download-erc721`
    - `launch-download-erc1155`
    - `launch-download-solana-core`
    - `launch-download-solana-token-metadata`
    - `launch-download-aptos`

- [ ] **Step 1: Write failing static page tests**

Create `app/server/test/launch-kit-page.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { publicDir, readPage } from './html-test-utils.js';

test('Launch Kit page exposes source, profile, target, validation, and output hooks', () => {
  const html = readPage('launch.html');
  for (const id of [
    'launch-root',
    'launch-wallet-status',
    'launch-storage-address',
    'launch-collection-list',
    'launch-profile-form',
    'launch-targets',
    'launch-validation',
    'launch-output-preview',
    'launch-download-package',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Prepare chain-specific NFT handoff files from a Shelby Vault collection/i);
  assert.match(html, /does not mint NFTs/i);
  assert.match(html, /ShelbyNet testnet beta/i);
});

test('all public pages include Launch Kit navigation', () => {
  for (const file of ['index.html', 'identity.html', 'upload.html', 'gallery.html', 'metadata.html', 'collection.html', 'proof.html', 'latency.html', 'launch.html']) {
    assert.match(readPage(file), /href="\/launch.html"[^>]*>Launch Kit</);
  }
});

test('Launch Kit does not ask for a local folder and does not claim minting', () => {
  const html = readPage('launch.html');
  assert.doesNotMatch(html, /webkitdirectory|type="file"|Select folder|Choose folder/i);
  assert.doesNotMatch(html, /Mint now|Deploy contract|OpenSea API|Magic Eden API/i);
});

test('app dispatch includes launch initializer hook', () => {
  const app = readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /initLaunchKitPage/);
  assert.match(app, /launch:\s*initLaunch/);
});
```

- [ ] **Step 2: Run static tests and verify failure**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "Launch Kit|launch initializer"
```

Expected: FAIL because `launch.html` and initializer are not wired.

- [ ] **Step 3: Create page shell**

Create `app/server/public/launch.html` using the same head assets as existing pages. The main body must include the exact hook IDs listed above. Use these section labels:

```html
<main id="launch-root" data-page="launch" class="mx-auto max-w-[92rem] px-5 pb-20 pt-28 md:px-8">
  <section class="vessel-panel rounded-vessel p-6 md:p-10">
    <p class="vessel-kicker text-primary-container">Launch Kit</p>
    <h1 class="mt-4 font-display text-5xl font-semibold tracking-[-0.06em] text-on-surface md:text-7xl">Multichain NFT handoff</h1>
    <p class="mt-5 max-w-3xl text-lg leading-8 text-on-surface-variant">Prepare chain-specific NFT handoff files from a Shelby Vault collection. Vessel does not mint NFTs or deploy contracts.</p>
    <p class="mt-3 max-w-3xl text-sm leading-6 text-outline">ShelbyNet testnet beta data can expire or be wiped. Use this package for demos, review, and developer handoff.</p>
  </section>

  <section class="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
    <article class="vessel-panel rounded-vessel p-6">
      <p class="vessel-kicker text-primary-container">Source collection</p>
      <div class="mt-5 grid gap-3 text-sm text-on-surface-variant">
        <p id="launch-wallet-status">Connect a wallet to load Shelby Vault collections.</p>
        <p>Storage identity: <span id="launch-storage-address" class="font-mono text-on-surface">Not connected</span></p>
      </div>
      <div id="launch-collection-list" class="mt-6 grid gap-3"></div>
    </article>

    <article class="vessel-panel rounded-vessel p-6">
      <p class="vessel-kicker text-secondary-container">Launch profile</p>
      <form id="launch-profile-form" class="mt-5 grid gap-4">
        <label class="grid gap-2"><span class="vessel-field-label">Collection name <button type="button" class="vessel-help" aria-label="Explain collection name" data-help="This name appears in exported marketplace and chain handoff files.">?</button></span><input name="collectionName" class="vessel-input" autocomplete="off"></label>
        <label class="grid gap-2"><span class="vessel-field-label">Symbol <button type="button" class="vessel-help" aria-label="Explain symbol" data-help="Short ticker used by many NFT contracts, for example GEN.">?</button></span><input name="symbol" class="vessel-input" autocomplete="off"></label>
        <label class="grid gap-2"><span class="vessel-field-label">Description <button type="button" class="vessel-help" aria-label="Explain description" data-help="Public collection description used in contractURI and Aptos handoff files.">?</button></span><textarea name="description" class="vessel-input min-h-28"></textarea></label>
        <label class="grid gap-2"><span class="vessel-field-label">Creator wallet <button type="button" class="vessel-help" aria-label="Explain creator wallet" data-help="Wallet address that your minting engineer can use as creator reference.">?</button></span><input name="creatorWallet" class="vessel-input" autocomplete="off"></label>
        <label class="grid gap-2"><span class="vessel-field-label">Royalty percent <button type="button" class="vessel-help" aria-label="Explain royalty" data-help="Used only for exported handoff files. Vessel does not enforce royalties.">?</button></span><input name="royaltyPercent" class="vessel-input" inputmode="decimal" placeholder="1"></label>
        <label class="grid gap-2"><span class="vessel-field-label">External website <button type="button" class="vessel-help" aria-label="Explain website" data-help="Optional public project link added to marketplace metadata exports.">?</button></span><input name="externalLink" class="vessel-input" autocomplete="off"></label>
        <label class="grid gap-2"><span class="vessel-field-label">Avatar image URL <button type="button" class="vessel-help" aria-label="Explain avatar image" data-help="Collection image for OpenSea contractURI. Select an uploaded image or paste HTTPS, IPFS, or Arweave URL.">?</button></span><input name="avatarImageUrl" class="vessel-input" autocomplete="off"></label>
        <label class="grid gap-2"><span class="vessel-field-label">Banner image URL <button type="button" class="vessel-help" aria-label="Explain banner image" data-help="Optional wide collection banner URL for marketplace profile pages.">?</button></span><input name="bannerImageUrl" class="vessel-input" autocomplete="off"></label>
        <label class="grid gap-2"><span class="vessel-field-label">Featured image URL <button type="button" class="vessel-help" aria-label="Explain featured image" data-help="Optional featured collection image for marketplace cards.">?</button></span><input name="featuredImageUrl" class="vessel-input" autocomplete="off"></label>
        <label class="grid gap-2"><span class="vessel-field-label">Token ID start <button type="button" class="vessel-help" aria-label="Explain token ID start" data-help="First token number for generated handoff rows. Default is 1.">?</button></span><input name="tokenIdStart" class="vessel-input" inputmode="numeric" value="1"></label>
      </form>
    </article>
  </section>

  <section class="mt-8 grid gap-6 lg:grid-cols-3">
    <article class="vessel-panel rounded-vessel p-6 lg:col-span-1">
      <p class="vessel-kicker text-tertiary-container">Targets</p>
      <div id="launch-targets" class="mt-5 grid gap-3"></div>
    </article>
    <article class="vessel-panel rounded-vessel p-6 lg:col-span-2">
      <p class="vessel-kicker text-primary-container">Validation</p>
      <div id="launch-validation" class="mt-5 grid gap-3"></div>
    </article>
  </section>

  <section class="mt-8 vessel-panel rounded-vessel p-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="vessel-kicker text-secondary-container">Output preview</p>
        <h2 class="mt-2 font-display text-3xl font-semibold tracking-[-0.04em]">Download the launch package</h2>
      </div>
      <button id="launch-download-package" type="button" class="vessel-button vessel-button-primary" disabled>Download ZIP</button>
    </div>
    <div id="launch-output-preview" class="mt-6 grid gap-4"></div>
  </section>
</main>
```

- [ ] **Step 4: Add Launch Kit nav link**

In every public HTML navigation block, add `/launch.html` with visible text `Launch Kit` after `Metadata` and before `Latency`. Keep `aria-current="page"` only on `launch.html`.

- [ ] **Step 5: Update static nav tests**

Update existing tests that assert the old five-link navigation to expect six links or to assert exact labels:

```js
assert.deepEqual(labels, ['Identity', 'Upload', 'Gallery', 'Metadata', 'Launch Kit', 'Latency']);
```

- [ ] **Step 6: Run static tests**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "Launch Kit|navigation|page shell"
```

Expected: page hook tests PASS. Old nav tests PASS after expectation updates.

- [ ] **Step 7: Commit**

Run:

```powershell
Set-Location D:\Visell
git add app/server/public/*.html app/server/test/launch-kit-page.test.js app/server/test/accessibility.test.js app/server/test/latency-and-metadata.test.js app/server/test/theme-and-landing.test.js
git commit -m "Add launch kit page shell"
```

Expected: commit succeeds.

---

### Task 5: Launch Kit page controller

**Files:**

- Create: `app/server/public/launch-kit-page.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/test/launch-kit-page.test.js`

**Interfaces:**

- Consumes:
  - `ledger.loadMine()`
  - `ledger.loadCollectionManifests(storageAddress)`
  - `getWalletState(): object`
  - `groupVaultCollections`
  - Task 1 generators
  - Task 2 validator
  - Task 3 export builder
- Produces:
  - `initLaunchKitPage({ document, location, ledger, getWalletState, groupVaultCollections, notify, downloadBlob }): { refresh(): void }`

- [ ] **Step 1: Add controller wiring tests**

Append to `app/server/test/launch-kit-page.test.js`:

```js
test('Launch Kit controller is imported and receives ledger collection dependencies', () => {
  const app = readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /import\s+\{\s*initLaunchKitPage\s*\}\s+from '\.\/launch-kit-page\.js'/);
  assert.match(app, /ledger,\s*getWalletState:\s*\(\)\s*=>\s*state/);
  assert.match(app, /groupVaultCollections/);
  assert.match(app, /downloadBlob/);
});

test('Launch Kit page controller avoids local file APIs', () => {
  const source = readFileSync(path.join(publicDir, 'launch-kit-page.js'), 'utf8');
  assert.doesNotMatch(source, /showOpenFilePicker|webkitdirectory|input\.type\s*=\s*['"]file['"]/);
});
```

- [ ] **Step 2: Run controller tests and verify failure**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "Launch Kit controller"
```

Expected: FAIL because controller file and import do not exist.

- [ ] **Step 3: Implement controller module**

Create `app/server/public/launch-kit-page.js` with these responsibilities:

```js
import { groupVaultCollections as defaultGroupVaultCollections } from './vault-collections.js';
import {
  buildAptosDigitalAssetRows,
  buildContractUri,
  buildErc1155Rows,
  buildErc721Rows,
  buildLaunchItems,
  buildSolanaCoreRows,
  buildSolanaTokenMetadataRows,
  defaultLaunchProfile,
  rowsToCsv,
} from './launch-kit.js';
import { validateLaunchKit } from './launch-kit-validator.js';
import { buildLaunchOutputs, launchPackageFileName } from './launch-kit-export.js';

const TARGETS = Object.freeze([
  ['evmErc721', 'Ethereum ERC-721', 'tokenURI rows for standard ERC-721 contracts'],
  ['evmErc1155', 'Ethereum ERC-1155', 'Decimal and {id} hex URI handoff'],
  ['solanaCore', 'Solana Metaplex Core', 'Asset rows for Core launch tooling'],
  ['solanaTokenMetadata', 'Solana Token Metadata', 'Legacy Metaplex handoff rows'],
  ['aptosDigitalAsset', 'Aptos Digital Asset', 'Collection and token URI rows'],
]);

function byId(document, id) {
  return document.getElementById(id);
}

function text(value) {
  return String(value ?? '').trim();
}

function storageAddressFromState(state) {
  return text(state?.session?.storageAddress || state?.storageAddress || state?.address || '');
}

function formValue(form, name) {
  return text(new FormData(form).get(name));
}

function setValue(form, name, value) {
  const field = form?.elements?.[name];
  if (field && !field.value) field.value = value || '';
}

function targetProfile(form) {
  const royaltyRaw = formValue(form, 'royaltyPercent');
  return {
    collectionName: formValue(form, 'collectionName'),
    symbol: formValue(form, 'symbol'),
    description: formValue(form, 'description'),
    creatorWallet: formValue(form, 'creatorWallet'),
    royaltyPercent: royaltyRaw === '' ? null : Number(royaltyRaw),
    externalLink: formValue(form, 'externalLink'),
    avatarImageUrl: formValue(form, 'avatarImageUrl'),
    bannerImageUrl: formValue(form, 'bannerImageUrl'),
    featuredImageUrl: formValue(form, 'featuredImageUrl'),
    tokenIdStart: Number(formValue(form, 'tokenIdStart') || 1),
  };
}

function button(label, className = 'vessel-button vessel-button-secondary') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
}

function renderIssueList(container, validation) {
  const groups = [
    ['Errors', validation.errors],
    ['Warnings', validation.warnings],
    ['Notes', validation.notes],
  ];
  container.replaceChildren(...groups.map(([label, issues]) => {
    const wrap = document.createElement('div');
    wrap.className = 'rounded-3xl border border-white/10 bg-surface-lowest/35 p-4';
    const title = document.createElement('p');
    title.className = 'vessel-kicker text-outline';
    title.textContent = `${label}: ${issues.length}`;
    const list = document.createElement('ul');
    list.className = 'mt-3 grid gap-2 text-sm text-on-surface-variant';
    for (const item of issues.slice(0, 8)) {
      const row = document.createElement('li');
      row.textContent = item.message;
      list.append(row);
    }
    wrap.append(title, list);
    return wrap;
  }));
}

function previewCard(title, count, sample, download) {
  const wrap = document.createElement('article');
  wrap.className = 'rounded-3xl border border-white/10 bg-surface-lowest/35 p-4';
  const heading = document.createElement('h3');
  heading.className = 'font-display text-xl font-semibold';
  heading.textContent = title;
  const meta = document.createElement('p');
  meta.className = 'mt-2 text-sm text-outline';
  meta.textContent = `${count} row${count === 1 ? '' : 's'}`;
  const code = document.createElement('pre');
  code.className = 'mt-4 max-h-40 overflow-auto rounded-2xl bg-black/30 p-3 text-xs text-on-surface-variant';
  code.textContent = sample;
  wrap.append(heading, meta, code, download);
  return wrap;
}

export function initLaunchKitPage({
  document = globalThis.document,
  location = globalThis.location,
  ledger,
  getWalletState,
  groupVaultCollections = defaultGroupVaultCollections,
  notify = () => {},
  downloadBlob,
} = {}) {
  const walletStatus = byId(document, 'launch-wallet-status');
  const storageAddressEl = byId(document, 'launch-storage-address');
  const collectionList = byId(document, 'launch-collection-list');
  const form = byId(document, 'launch-profile-form');
  const targetsEl = byId(document, 'launch-targets');
  const validationEl = byId(document, 'launch-validation');
  const previewEl = byId(document, 'launch-output-preview');
  const packageButton = byId(document, 'launch-download-package');
  if (!collectionList || !form || !targetsEl || !validationEl || !previewEl || !packageButton) return { refresh() {} };

  let selectedCollectionId = '';
  let collections = [];
  let currentOutputs = null;

  function currentProfile(collection) {
    const defaults = defaultLaunchProfile(collection, {
      storageAddress: storageAddressFromState(getWalletState?.()),
      origin: location?.origin,
    });
    return {
      ...defaults,
      ...targetProfile(form),
      collectionId: collection?.id || defaults.collectionId,
      targets: Object.fromEntries(TARGETS.map(([key]) => {
        const checkbox = document.querySelector(`[data-launch-target="${key}"]`);
        return [key, checkbox ? checkbox.checked : true];
      })),
    };
  }

  function renderTargets() {
    targetsEl.replaceChildren(...TARGETS.map(([key, label, copy]) => {
      const row = document.createElement('label');
      row.className = 'flex items-start gap-3 rounded-2xl border border-white/10 bg-surface-lowest/35 p-4';
      row.innerHTML = `<input class="mt-1" data-launch-target="${key}" type="checkbox" checked><span><span class="block font-display text-base font-semibold">${label}</span><span class="mt-1 block text-sm text-on-surface-variant">${copy}</span></span>`;
      row.querySelector('input').addEventListener('change', renderAll);
      return row;
    }));
  }

  function renderCollections() {
    if (!collections.length) {
      const empty = document.createElement('p');
      empty.className = 'rounded-3xl border border-white/10 bg-surface-lowest/35 p-5 text-sm text-on-surface-variant';
      empty.textContent = 'No launch-ready collection yet. Upload a folder first, then return here to generate chain handoff files.';
      collectionList.replaceChildren(empty);
      return;
    }
    collectionList.replaceChildren(...collections.map((collection) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rounded-3xl border border-white/10 bg-surface-lowest/35 p-5 text-left hover:border-primary-container/40';
      row.dataset.collectionId = collection.id;
      row.innerHTML = `<span class="block vessel-kicker text-primary-container">${collection.verification}</span><span class="mt-2 block font-display text-xl font-semibold">${collection.name}</span><span class="mt-1 block text-sm text-on-surface-variant">${collection.itemCount} item${collection.itemCount === 1 ? '' : 's'}</span>`;
      row.addEventListener('click', () => {
        selectedCollectionId = collection.id;
        const defaults = defaultLaunchProfile(collection, {
          storageAddress: storageAddressFromState(getWalletState?.()),
          origin: location?.origin,
        });
        for (const [name, value] of Object.entries(defaults)) {
          if (name !== 'targets') setValue(form, name, value);
        }
        renderAll();
      });
      return row;
    }));
  }

  function download(name, content, type = 'text/plain') {
    downloadBlob(new Blob([content], { type }), name, document);
  }

  function renderPreviews(outputs) {
    const cards = [];
    const addRows = (title, fileName, rows) => {
      const csv = rowsToCsv(rows);
      const dl = button(`Download ${fileName}`);
      dl.className = 'vessel-button vessel-button-secondary mt-4';
      dl.onclick = () => download(fileName, csv, 'text/csv');
      cards.push(previewCard(title, rows.length, csv.split('\r\n').slice(0, 4).join('\n'), dl));
    };
    const contract = JSON.stringify(outputs.contractUri, null, 2);
    const contractDl = button('Download contractURI.json');
    contractDl.className = 'vessel-button vessel-button-secondary mt-4';
    contractDl.onclick = () => download('contractURI.json', `${contract}\n`, 'application/json');
    cards.push(previewCard('OpenSea contractURI', 1, contract, contractDl));
    addRows('Ethereum ERC-721', 'erc721-tokenuris.csv', outputs.rows.erc721Rows);
    addRows('Ethereum ERC-1155', 'erc1155-tokenuris.csv', outputs.rows.erc1155Rows);
    addRows('Solana Metaplex Core', 'metaplex-core-assets.csv', outputs.rows.solanaCoreRows);
    addRows('Solana Token Metadata', 'token-metadata-assets.csv', outputs.rows.solanaTokenMetadataRows);
    addRows('Aptos Digital Asset', 'digital-asset-tokens.csv', outputs.rows.aptosRows);
    previewEl.replaceChildren(...cards);
  }

  function renderAll() {
    const state = getWalletState?.() || {};
    const storageAddress = storageAddressFromState(state);
    if (walletStatus) walletStatus.textContent = storageAddress ? 'Wallet connected. Vault collections are loaded from this browser and Shelby reconciliation cache.' : 'Connect a wallet to load Shelby Vault collections.';
    if (storageAddressEl) storageAddressEl.textContent = storageAddress || 'Not connected';
    const collection = collections.find((entry) => entry.id === selectedCollectionId) || collections[0];
    selectedCollectionId = collection?.id || '';
    if (!collection) {
      currentOutputs = null;
      renderCollections();
      renderIssueList(validationEl, { errors: [], warnings: [], notes: [] });
      previewEl.replaceChildren();
      packageButton.disabled = true;
      return;
    }
    const manifests = ledger.loadCollectionManifests(storageAddress);
    const profile = currentProfile(collection);
    const items = buildLaunchItems(collection, manifests, { tokenIdStart: profile.tokenIdStart });
    const validation = validateLaunchKit({ collection, profile, items });
    currentOutputs = buildLaunchOutputs(profile, items, validation, {
      collection,
      vesselOrigin: location?.origin,
      storageRuntime: 'shelbynet',
      storageAddress,
    });
    renderCollections();
    renderIssueList(validationEl, validation);
    renderPreviews(currentOutputs);
    packageButton.disabled = validation.errors.length > 0;
    packageButton.onclick = () => downloadBlob(currentOutputs.zip, launchPackageFileName(profile), document);
  }

  function refresh() {
    const state = getWalletState?.() || {};
    const storageAddress = storageAddressFromState(state);
    collections = storageAddress
      ? groupVaultCollections(ledger.loadMine(), { storageAddress, verification: 'vault-cache' })
      : [];
    renderAll();
  }

  renderTargets();
  form.addEventListener('input', renderAll);
  refresh();
  notify('Launch Kit reads existing Shelby Vault collections only', 'info');
  return { refresh };
}
```

- [ ] **Step 4: Wire into `app.js`**

At the import section of `app/server/public/app.js`, add:

```js
import { initLaunchKitPage } from './launch-kit-page.js';
```

Add:

```js
async function initLaunch() {
  return initLaunchKitPage({
    document,
    location,
    ledger,
    getWalletState: () => state,
    groupVaultCollections,
    notify,
    downloadBlob,
  });
}
```

Update the dispatcher object near the bottom:

```js
({ index: initLanding, identity: initIdentity, upload: initUpload, gallery: initGallery, collection: initCollection, proof: initProof, latency: initLatency, metadata: initMetadata, launch: initLaunch }[p] || (() => {}))();
```

- [ ] **Step 5: Run controller tests**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "Launch Kit controller|local file APIs"
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
Set-Location D:\Visell
git add app/server/public/launch-kit-page.js app/server/public/app.js app/server/test/launch-kit-page.test.js
git commit -m "Wire launch kit page controller"
```

Expected: commit succeeds.

---

### Task 6: UX polish, tooltips, and Gallery and Metadata entry points

**Files:**

- Modify: `app/server/public/vessel.css`
- Modify: `app/server/public/gallery.html`
- Modify: `app/server/public/metadata.html`
- Modify: `app/server/public/app.js`
- Modify: `app/server/test/launch-kit-page.test.js`
- Modify: `app/server/test/ledger-and-gallery.test.js`

**Interfaces:**

- Consumes:
  - Existing `.vessel-button`, `.vessel-panel`, `.vessel-input`
  - Existing collection page links
- Produces:
  - `vessel-help` tooltip behavior with hover and focus
  - A visible `Open Launch Kit` CTA from Gallery and Metadata

- [ ] **Step 1: Add failing UX tests**

Append to `app/server/test/launch-kit-page.test.js`:

```js
test('Launch Kit labels include accessible help tooltip buttons', () => {
  const html = readPage('launch.html');
  assert.match(html, /class="vessel-help"/);
  assert.match(html, /data-help="This name appears in exported marketplace and chain handoff files\."/);
  assert.match(html, /aria-label="Explain token ID start"/);
});

test('Gallery and Metadata provide Launch Kit entry points', () => {
  assert.match(readPage('gallery.html'), /Open Launch Kit|Launch Kit/i);
  assert.match(readPage('metadata.html'), /Open Launch Kit|Launch Kit/i);
});
```

- [ ] **Step 2: Run UX tests and verify failure**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "tooltip|entry points"
```

Expected: FAIL for missing entry points or tooltip CSS.

- [ ] **Step 3: Add tooltip CSS**

Append to `app/server/public/vessel.css`:

```css
.vessel-field-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--vessel-outline);
  font-family: var(--vessel-font-mono);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.vessel-help {
  position: relative;
  display: inline-grid;
  width: 1.15rem;
  height: 1.15rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--vessel-primary-container) 45%, transparent);
  border-radius: 999px;
  color: var(--vessel-primary-container);
  font: 700 0.72rem/1 var(--vessel-font-mono);
}

.vessel-help::after {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 0.65rem);
  z-index: 30;
  width: min(18rem, 72vw);
  transform: translateX(-50%) translateY(0.25rem);
  border: 1px solid color-mix(in srgb, var(--vessel-primary-container) 28%, transparent);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--vessel-surface-lowest) 96%, black);
  box-shadow: 0 1.25rem 3rem rgb(0 0 0 / 0.35);
  color: var(--vessel-on-surface);
  content: attr(data-help);
  font: 500 0.8rem/1.5 var(--vessel-font-body);
  letter-spacing: normal;
  opacity: 0;
  padding: 0.8rem 0.9rem;
  pointer-events: none;
  text-transform: none;
  transition: opacity 140ms ease, transform 140ms ease;
}

.vessel-help:hover::after,
.vessel-help:focus-visible::after {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
```

- [ ] **Step 4: Add entry points**

Add a primary or secondary anchor to Gallery and Metadata page hero/action areas:

```html
<a class="vessel-button vessel-button-secondary" href="/launch.html">
  <span class="material-symbols-outlined text-lg" aria-hidden="true">rocket_launch</span>
  Open Launch Kit
</a>
```

- [ ] **Step 5: Run UX tests**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "tooltip|entry points"
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
Set-Location D:\Visell
git add app/server/public/vessel.css app/server/public/gallery.html app/server/public/metadata.html app/server/public/app.js app/server/test/launch-kit-page.test.js app/server/test/ledger-and-gallery.test.js
git commit -m "Polish launch kit entry UX"
```

Expected: commit succeeds.

---

### Task 7: README and landing copy alignment

**Files:**

- Modify: `README.md`
- Modify: `app/server/public/index.html`
- Modify: `app/server/test/theme-and-landing.test.js`

**Interfaces:**

- Consumes:
  - Existing landing page ShelbyNet and Aptos Testnet positioning
- Produces:
  - Landing copy that says Aptos Testnet is supported but maintenance-disabled
  - Landing copy that says ShelbyNet is live in the current demo
  - README section for Launch Kit outputs and limitations

- [ ] **Step 1: Add failing copy tests**

Append to `app/server/test/theme-and-landing.test.js`:

```js
test('landing and README present Launch Kit and current network availability accurately', () => {
  const landing = readPage('index.html');
  const readme = readFileSync(path.resolve(publicDir, '..', '..', 'README.md'), 'utf8');

  assert.match(landing, /ShelbyNet[^<]*(Live|live)/);
  assert.match(landing, /Aptos Testnet[^<]*(maintenance|Maintenance)/);
  assert.match(landing, /Launch Kit/i);
  assert.match(readme, /Multichain NFT Launch Kit/i);
  assert.match(readme, /Vessel does not mint NFTs/i);
  assert.match(readme, /ShelbyNet testnet beta/i);
});
```

- [ ] **Step 2: Run copy test and verify failure**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "Launch Kit and current network"
```

Expected: FAIL until copy is updated.

- [ ] **Step 3: Update landing copy**

Add a landing section or card with this exact content:

```html
<article class="vessel-landing-card vessel-glass rounded-vessel">
  <span class="material-symbols-outlined text-3xl text-primary" aria-hidden="true">rocket_launch</span>
  <h3 class="mt-8 font-display text-xl font-semibold">Multichain NFT Launch Kit</h3>
  <p class="mt-3 leading-6 text-on-surface-variant">Package Shelby-hosted media and TokenURI metadata into EVM, Solana, and Aptos handoff files without minting contracts inside Vessel.</p>
</article>
```

Ensure the network cards state:

```html
<span class="vessel-kicker text-primary-container">ShelbyNet live</span>
<span class="vessel-kicker text-outline">Aptos Testnet maintenance</span>
```

- [ ] **Step 4: Update README**

Add this section to `README.md`:

```md
## Multichain NFT Launch Kit

Vessel can turn a wallet-owned Shelby Vault collection into a launch handoff package for NFT teams.

The Launch Kit exports:

- OpenSea-compatible `contractURI.json`.
- Ethereum ERC-721 TokenURI rows.
- Ethereum ERC-1155 TokenURI rows with 64-character `{id}` hex IDs.
- Solana Metaplex Core handoff rows.
- Solana Token Metadata legacy handoff rows.
- Aptos Digital Asset collection and token URI rows.
- A validation report and launch checklist.

Vessel does not mint NFTs, deploy NFT contracts, call marketplace APIs, or promise permanent storage. ShelbyNet is a testnet beta, so uploaded data can expire or be wiped. Aptos Testnet support remains in the codebase but the public app currently presents ShelbyNet as the live path and Aptos Testnet as maintenance-disabled.
```

- [ ] **Step 5: Run copy test**

Run:

```powershell
Set-Location D:\Visell\app\server
npm test -- --test-name-pattern "Launch Kit and current network"
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
Set-Location D:\Visell
git add README.md app/server/public/index.html app/server/test/theme-and-landing.test.js
git commit -m "Document launch kit positioning"
```

Expected: commit succeeds.

---

### Task 8: Full verification, production build, and smoke checklist

**Files:**

- Modify: `docs/superpowers/specs/2026-08-11-multichain-nft-launch-kit-design.md` only if acceptance criteria wording needs to match the final shipped UI.

**Interfaces:**

- Consumes:
  - All previous tasks
- Produces:
  - Passing automated checks
  - Manual smoke evidence list

- [ ] **Step 1: Run full server check**

Run:

```powershell
Set-Location D:\Visell\app\server
npm run check
```

Expected: `node --test test/*.test.js` passes, CSS build succeeds, client bundle build succeeds.

- [ ] **Step 2: Inspect diff for accidental secrets**

Run:

```powershell
Set-Location D:\Visell
git diff --stat HEAD~7..HEAD
git diff HEAD~7..HEAD -- . ':!*.png' ':!*.jpg' ':!*.jpeg' ':!*.webp' ':!*.svg' | Select-String -Pattern 'aptoslabs_|PRIVATE|SECRET|seed|mnemonic|signature' -CaseSensitive
```

Expected: no added API keys, private keys, seed phrases, mnemonics, or raw signature payloads in tracked changes. Existing public words in copy are acceptable when they are not secret values.

- [ ] **Step 3: Run local browser smoke**

Run:

```powershell
Set-Location D:\Visell\app\server
npm run dev
```

In Chrome:

1. Open `http://localhost:3000/launch.html`.
2. Connect a wallet with existing Vault collection data.
3. Confirm the page loads Vault collections without a file picker.
4. Select a collection.
5. Confirm Collection name, Creator wallet, Avatar image URL, and Token ID start auto-fill.
6. Enable all five targets.
7. Confirm validation shows notes about no minting and ShelbyNet testnet beta.
8. Confirm previews appear for OpenSea, ERC-721, ERC-1155, Solana Core, Solana Token Metadata, and Aptos DA.
9. Download ZIP.
10. Open ZIP and verify this structure exists:

```text
vessel-launch-kit/
  manifest.json
  launch-checklist.md
  opensea/contractURI.json
  evm/erc721-tokenuris.csv
  evm/erc1155-tokenuris.csv
  solana/metaplex-core-assets.csv
  solana/token-metadata-assets.csv
  aptos/digital-asset-tokens.csv
```

Expected: no wallet signature prompts occur during Launch Kit generation or download.

- [ ] **Step 4: Run production smoke after deployment**

After pushing and Vercel deployment completes:

1. Open `https://vessel-sage.vercel.app/`.
2. Confirm landing shows ShelbyNet live and Aptos Testnet maintenance.
3. Open `https://vessel-sage.vercel.app/launch.html`.
4. Confirm Launch Kit nav is visible.
5. Repeat the local browser smoke using existing production Vault data.

Expected: no console errors, no file picker, no wallet signature prompt, no secret values in downloaded package.

- [ ] **Step 5: Commit any verification copy adjustment**

If Step 2 or smoke testing reveals only copy or test expectation mismatches, fix those exact files and run:

```powershell
Set-Location D:\Visell\app\server
npm run check
Set-Location D:\Visell
git add README.md app/server/public app/server/test docs/superpowers/specs/2026-08-11-multichain-nft-launch-kit-design.md
git commit -m "Finalize launch kit verification"
```

Expected: commit succeeds only if a final adjustment was made.

---

## Self-Review

Spec coverage:

- Selecting a wallet-scoped Vault collection is covered by Task 5.
- Launch profile fields are covered by Task 4 and Task 5.
- All five chain targets plus OpenSea contractURI are covered by Task 1 and Task 3.
- Validation errors, warnings, and notes are covered by Task 2.
- ZIP structure, checklist, manifest, CSV, contractURI, and validation workbook are covered by Task 3.
- Navigation, tooltips, and no-local-folder UX are covered by Task 4 through Task 6.
- README and landing page network positioning are covered by Task 7.
- Full automated and manual smoke verification is covered by Task 8.

Placeholder scan:

- The plan contains no placeholder tokens and no deferred implementation instructions.

Type consistency:

- `buildLaunchItems`, `validateLaunchKit`, `buildLaunchOutputs`, and `initLaunchKitPage` signatures are stable across all tasks.
- The task-level output file names match the spec output paths.
- The page hook IDs in Task 4 are the same hooks consumed in Task 5.
