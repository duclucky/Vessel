# NFT Metadata Template Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Vessel metadata generation from a basic image JSON form into a standards-aware NFT Metadata Designer with presets, richer traits, stable batch numbering, CSV overrides, previews, and Shelby-gated hosting.

**Architecture:** Keep metadata logic in plain browser-safe JavaScript modules under `app/server/public/`, with tests under `app/server/test/`. Add focused modules for template presets and trait normalization, expand the canonical schema builder, then wire the existing metadata page to those interfaces without changing wallet, settlement, upload, or Shelby provider boundaries.

**Tech Stack:** Vanilla JavaScript ES modules, Node `node:test`, browser `File` and `Blob`, existing Tailwind/static HTML, existing Express static serving.

## Global Constraints

- Do not add NFT minting, NFT contract deployment, or marketplace submission automation.
- Do not rename files on the user's computer.
- Do not rename already uploaded Shelby blobs.
- `SHELBY_WRITES_ENABLED=false` must keep local JSON and ZIP export usable while disabling hosted metadata.
- Default output is Marketplace Compatible JSON.
- Default item names use `<Collection Name> #<Number>`.
- Batch JSON filenames default to `1.json`, `2.json`, `3.json`.
- `name`, `description`, and `image` are required for exported metadata.
- `external_url`, `animation_url`, `background_color`, and Vessel proof are optional.
- Vessel proof must be namespaced under `properties.vessel` and off by default.
- Supported URI schemes are HTTPS, IPFS, and Arweave.
- Metadata modules must be testable without wallet extensions.
- Keep edits scoped to metadata files and tests unless an app shell link is required.

---

## File Structure

- Create `app/server/public/metadata-template-presets.js`
  - Defines metadata presets, supported media categories, URI helpers, and JSON filename helpers.
- Create `app/server/public/metadata-traits.js`
  - Normalizes trait rows, parses advanced CSV trait headers, and validates trait values.
- Modify `app/server/public/metadata-schema.js`
  - Builds canonical metadata for image, video, audio, HTML, and game item presets.
  - Validates fields as blocking errors and warnings.
- Modify `app/server/public/metadata-batch.js`
  - Uses sequential token numbers and `1.json` style output paths.
  - Supports advanced CSV columns.
- Modify `app/server/public/metadata-page.js`
  - Wires preset selection, advanced single fields, marketplace preview state, and batch defaults.
- Modify `app/server/public/metadata.html`
  - Adds simple preset controls and advanced metadata fields without changing wallet controls.
- Modify `app/server/public/vessel.css`
  - Adds compact controls for metadata designer preview and validation states if existing utility classes are insufficient.
- Modify `app/server/test/metadata-schema.test.js`
  - Covers presets, validation, and Vessel proof.
- Modify `app/server/test/metadata-batch.test.js`
  - Covers numbering, output paths, CSV overrides, and advanced traits.
- Create `app/server/test/metadata-traits.test.js`
  - Covers trait normalization and CSV header parsing.
- Modify `app/server/test/latency-and-metadata.test.js`
  - Covers presence of new UI controls and absence of folder picker or minting controls.
- Modify `app/server/test/metadata-page.test.js`
  - Covers page wiring that can be tested without wallet extensions.

---

### Task 1: Template Presets And Trait Normalization

**Files:**
- Create: `app/server/public/metadata-template-presets.js`
- Create: `app/server/public/metadata-traits.js`
- Create: `app/server/test/metadata-traits.test.js`
- Modify: `app/server/test/metadata-schema.test.js`

**Interfaces:**
- Produces: `METADATA_PRESETS: Record<string, MetadataPreset>`
- Produces: `SUPPORTED_METADATA_CATEGORIES: string[]`
- Produces: `metadataOutputPathForNumber(number: number): string`
- Produces: `formatItemName(pattern: string, collectionName: string, tokenNumber: number): string`
- Produces: `normalizeTrait(input: object): { trait_type?: string, value: string|number, display_type?: string, max_value?: number } | null`
- Produces: `parseCsvTraitColumn(header: string): { kind: string, trait_type: string, max?: boolean } | null`
- Produces: `normalizeCsvTraitValue(column: object, rawValue: string): object | null`
- Consumes: no new internal interfaces.

- [ ] **Step 1: Write failing tests for traits and template helpers**

Add `app/server/test/metadata-traits.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTrait,
  parseCsvTraitColumn,
  normalizeCsvTraitValue,
} from '../public/metadata-traits.js';
import {
  METADATA_PRESETS,
  formatItemName,
  metadataOutputPathForNumber,
} from '../public/metadata-template-presets.js';

test('metadata presets expose marketplace-compatible NFT modes', () => {
  assert.deepEqual(Object.keys(METADATA_PRESETS), [
    'marketplace',
    'image',
    'video',
    'audio',
    'html',
    'game',
  ]);
  assert.equal(METADATA_PRESETS.marketplace.category, 'image');
  assert.equal(METADATA_PRESETS.video.requiresAnimationUrl, true);
  assert.equal(METADATA_PRESETS.audio.requiresAnimationUrl, true);
  assert.equal(METADATA_PRESETS.html.category, 'html');
});

test('item names and JSON output paths use creator-friendly numbering', () => {
  assert.equal(formatItemName('<Collection Name> #<Number>', 'Vessel Genesis', 1), 'Vessel Genesis #1');
  assert.equal(formatItemName('<Collection Name> #<Number>', 'Vessel Genesis', 12), 'Vessel Genesis #12');
  assert.equal(metadataOutputPathForNumber(1), '1.json');
  assert.equal(metadataOutputPathForNumber(12), '12.json');
});

test('trait normalization supports text, number, date, boost, and generic string', () => {
  assert.deepEqual(normalizeTrait({ trait_type: 'Background', value: 'Blue' }), {
    trait_type: 'Background',
    value: 'Blue',
  });
  assert.deepEqual(normalizeTrait({ display_type: 'number', trait_type: 'Power', value: '80', max_value: '100' }), {
    display_type: 'number',
    trait_type: 'Power',
    value: 80,
    max_value: 100,
  });
  assert.deepEqual(normalizeTrait({ display_type: 'date', trait_type: 'Birthday', value: '1546360800' }), {
    display_type: 'date',
    trait_type: 'Birthday',
    value: 1546360800,
  });
  assert.deepEqual(normalizeTrait({ display_type: 'boost_percentage', trait_type: 'Luck', value: '15' }), {
    display_type: 'boost_percentage',
    trait_type: 'Luck',
    value: 15,
  });
  assert.deepEqual(normalizeTrait({ value: 'Special Edition', generic: true }), {
    value: 'Special Edition',
  });
  assert.equal(normalizeTrait({ trait_type: '', value: '' }), null);
});

test('CSV trait headers map to normalized attributes', () => {
  assert.deepEqual(parseCsvTraitColumn('trait:Background'), {
    kind: 'text',
    trait_type: 'Background',
    max: false,
  });
  assert.deepEqual(parseCsvTraitColumn('number:Power'), {
    kind: 'number',
    trait_type: 'Power',
    max: false,
  });
  assert.deepEqual(parseCsvTraitColumn('number:Power:max'), {
    kind: 'number',
    trait_type: 'Power',
    max: true,
  });
  assert.deepEqual(parseCsvTraitColumn('date:Birthday'), {
    kind: 'date',
    trait_type: 'Birthday',
    max: false,
  });
  assert.deepEqual(normalizeCsvTraitValue(parseCsvTraitColumn('number:Power'), '80'), {
    display_type: 'number',
    trait_type: 'Power',
    value: 80,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
Set-Location app/server
npm test -- test/metadata-traits.test.js
```

Expected: FAIL with module not found for `metadata-traits.js` or `metadata-template-presets.js`.

- [ ] **Step 3: Create preset and trait modules**

Create `app/server/public/metadata-template-presets.js`:

```js
export const SUPPORTED_METADATA_CATEGORIES = Object.freeze(['image', 'video', 'audio', 'html', 'vr']);

export const METADATA_PRESETS = Object.freeze({
  marketplace: Object.freeze({
    id: 'marketplace',
    label: 'Marketplace Compatible',
    category: 'image',
    requiresAnimationUrl: false,
    suggestedTraits: Object.freeze([]),
  }),
  image: Object.freeze({
    id: 'image',
    label: 'Image NFT',
    category: 'image',
    requiresAnimationUrl: false,
    suggestedTraits: Object.freeze([]),
  }),
  video: Object.freeze({
    id: 'video',
    label: 'Video NFT',
    category: 'video',
    requiresAnimationUrl: true,
    suggestedTraits: Object.freeze([]),
  }),
  audio: Object.freeze({
    id: 'audio',
    label: 'Audio NFT',
    category: 'audio',
    requiresAnimationUrl: true,
    suggestedTraits: Object.freeze([]),
  }),
  html: Object.freeze({
    id: 'html',
    label: 'HTML or Interactive NFT',
    category: 'html',
    requiresAnimationUrl: true,
    suggestedTraits: Object.freeze([]),
  }),
  game: Object.freeze({
    id: 'game',
    label: 'Game Item',
    category: 'image',
    requiresAnimationUrl: false,
    suggestedTraits: Object.freeze(['Class', 'Rarity', 'Level', 'Power', 'Season']),
  }),
});

export function metadataOutputPathForNumber(number) {
  const value = Number(number);
  if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new Error('Token number must be a non-negative integer'), {
    code: 'metadata_token_number_invalid',
  });
  return `${value}.json`;
}

export function formatItemName(pattern, collectionName, tokenNumber) {
  const source = String(pattern || '<Collection Name> #<Number>');
  const name = String(collectionName || '').trim();
  const number = Number(tokenNumber);
  return source
    .replaceAll('<Collection Name>', name)
    .replaceAll('<Number>', Number.isFinite(number) ? String(number) : '');
}
```

Create `app/server/public/metadata-traits.js`:

```js
const NUMERIC_DISPLAY_TYPES = new Set(['number', 'date', 'boost_number', 'boost_percentage']);

function clean(value) {
  return String(value ?? '').trim();
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = clean(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function normalizeTrait(input = {}) {
  const traitType = clean(input.trait_type);
  const displayType = clean(input.display_type);
  const generic = Boolean(input.generic) || (!traitType && !displayType);
  const rawValue = input.value;
  if (rawValue == null || clean(rawValue) === '') return null;

  if (generic) return Object.freeze({ value: clean(rawValue) });

  if (!traitType) {
    return Object.freeze({ trait_type: '', value: rawValue });
  }

  if (!displayType) {
    return Object.freeze({ trait_type: traitType, value: typeof rawValue === 'number' ? rawValue : clean(rawValue) });
  }

  const number = finiteNumber(rawValue);
  const output = {
    display_type: displayType,
    trait_type: traitType,
    value: NUMERIC_DISPLAY_TYPES.has(displayType) ? number : clean(rawValue),
  };
  if (input.max_value != null && clean(input.max_value) !== '') output.max_value = finiteNumber(input.max_value);
  return Object.freeze(output);
}

export function parseCsvTraitColumn(header) {
  const source = clean(header);
  const parts = source.split(':').map(clean);
  const [kind, ...rest] = parts;
  if (!['trait', 'number', 'date', 'boost_number', 'boost_percentage'].includes(kind)) return null;
  const max = rest.at(-1)?.toLowerCase() === 'max';
  const traitParts = max ? rest.slice(0, -1) : rest;
  const traitType = traitParts.join(':').trim();
  if (!traitType) return null;
  return Object.freeze({
    kind,
    trait_type: traitType,
    max,
  });
}

export function normalizeCsvTraitValue(column, rawValue) {
  if (!column || column.max) return null;
  const value = clean(rawValue);
  if (!value) return null;
  const displayType = column.kind === 'trait' ? '' : column.kind;
  return normalizeTrait({
    trait_type: column.trait_type,
    display_type: displayType,
    value,
  });
}

export function mergeTraitMaxValues(traits, maxColumns = new Map()) {
  return traits.map((trait) => {
    const key = String(trait.trait_type || '').toLowerCase();
    if (!key || !maxColumns.has(key)) return trait;
    return Object.freeze({ ...trait, max_value: maxColumns.get(key) });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
Set-Location app/server
npm test -- test/metadata-traits.test.js
```

Expected: PASS for `metadata-traits.test.js`.

- [ ] **Step 5: Commit**

```powershell
git add app/server/public/metadata-template-presets.js app/server/public/metadata-traits.js app/server/test/metadata-traits.test.js
git commit -m "feat(metadata): add nft template presets and traits"
```

---

### Task 2: Canonical Metadata Schema Builder

**Files:**
- Modify: `app/server/public/metadata-schema.js`
- Modify: `app/server/test/metadata-schema.test.js`

**Interfaces:**
- Consumes: `METADATA_PRESETS`, `SUPPORTED_METADATA_CATEGORIES` from `metadata-template-presets.js`
- Consumes: `normalizeTrait(input)` from `metadata-traits.js`
- Produces: `createNftMetadata(options): object`
- Produces: `validateNftMetadata(metadata): { valid: boolean, errors: Issue[], warnings: Issue[] }`
- Produces: `serializeNftMetadata(metadata): string`

- [ ] **Step 1: Add failing schema tests for presets and optional proof**

Append to `app/server/test/metadata-schema.test.js`:

```js
test('canonical metadata supports video preset with animation_url and multiple files', () => {
  const metadata = createNftMetadata({
    preset: 'video',
    name: 'Vessel Film #1',
    description: 'A video NFT.',
    image: 'https://example.com/cover.png',
    animationUrl: 'https://example.com/movie.mp4',
    mimeType: 'image/png',
    animationMimeType: 'video/mp4',
    attributes: [{ display_type: 'number', trait_type: 'Power', value: 80, max_value: 100 }],
  });

  assert.equal(metadata.animation_url, 'https://example.com/movie.mp4');
  assert.equal(metadata.properties.category, 'video');
  assert.deepEqual(metadata.properties.files, [
    { uri: 'https://example.com/cover.png', type: 'image/png' },
    { uri: 'https://example.com/movie.mp4', type: 'video/mp4' },
  ]);
  assert.equal(validateNftMetadata(metadata).valid, true);
});

test('canonical metadata supports background color and optional Vessel proof namespace', () => {
  const metadata = createNftMetadata({
    name: 'Vessel Genesis #1',
    description: 'Wallet-owned artifact.',
    image: 'https://example.com/1.png',
    backgroundColor: '00ffee',
    vesselProof: {
      storage_network: 'shelby-testnet',
      storage_address: '0xabc',
      media_url: 'https://example.com/1.png',
      receipt_chain: 'aptos-testnet',
      receipt_hash: '0x123',
      expires_at: '2026-08-12T00:00:00.000Z',
    },
  });

  assert.equal(metadata.background_color, '00ffee');
  assert.equal(metadata.properties.vessel.storage_network, 'shelby-testnet');
  assert.equal(validateNftMetadata(metadata).valid, true);
});

test('metadata validation separates warnings from blocking errors', () => {
  const result = validateNftMetadata({
    name: '',
    description: 'Missing image',
    image: '',
    attributes: [],
    properties: { category: 'space', files: [] },
    background_color: '#bad',
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'name_required',
    'image_uri_invalid',
    'background_color_invalid',
    'primary_file_required',
  ]);
  assert.equal(result.warnings.some((warning) => warning.code === 'metadata_no_traits'), true);
  assert.equal(result.warnings.some((warning) => warning.code === 'category_unsupported'), true);
});
```

- [ ] **Step 2: Run schema test to verify it fails**

Run:

```powershell
Set-Location app/server
npm test -- test/metadata-schema.test.js
```

Expected: FAIL because `preset`, `animationUrl`, `backgroundColor`, `vesselProof`, and `warnings` are not implemented.

- [ ] **Step 3: Expand `metadata-schema.js`**

Replace `app/server/public/metadata-schema.js` with:

```js
import {
  METADATA_PRESETS,
  SUPPORTED_METADATA_CATEGORIES,
} from './metadata-template-presets.js';
import { normalizeTrait } from './metadata-traits.js';

const SUPPORTED_URI = /^(?:https:\/\/|ipfs:\/\/|ar:\/\/)[^\s]+$/i;
const BACKGROUND_COLOR = /^[0-9a-f]{6}$/i;
const VALID_DISPLAY_TYPES = new Set(['number', 'date', 'boost_number', 'boost_percentage']);

function issue(code, field, severity = 'error') {
  return Object.freeze({ code, field, severity });
}

function isSupportedUri(value) {
  if (typeof value !== 'string' || !SUPPORTED_URI.test(value)) return false;
  if (!value.toLowerCase().startsWith('https://')) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizedMime(value, fallback) {
  return String(value || '').trim() || fallback;
}

function normalizedCategory(preset, explicitCategory) {
  const presetEntry = METADATA_PRESETS[preset] || METADATA_PRESETS.marketplace;
  const category = String(explicitCategory || presetEntry.category || 'image').trim().toLowerCase();
  return category || 'image';
}

function freezeMetadata(metadata) {
  for (const attribute of metadata.attributes) Object.freeze(attribute);
  Object.freeze(metadata.attributes);
  for (const file of metadata.properties.files) Object.freeze(file);
  Object.freeze(metadata.properties.files);
  if (metadata.properties.vessel) Object.freeze(metadata.properties.vessel);
  Object.freeze(metadata.properties);
  return Object.freeze(metadata);
}

function normalizedAttributes(attributes) {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((attribute) => normalizeTrait(attribute))
    .filter(Boolean);
}

function cleanOptionalUrl(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function createNftMetadata({
  preset = 'marketplace',
  name,
  description,
  image,
  externalUrl,
  animationUrl,
  attributes = [],
  mimeType = 'image/png',
  animationMimeType = '',
  backgroundColor,
  category,
  vesselProof,
} = {}) {
  const normalizedImage = String(image || '').trim();
  const normalizedAnimationUrl = cleanOptionalUrl(animationUrl);
  const normalizedExternalUrl = cleanOptionalUrl(externalUrl);
  const metadata = {
    name: String(name || '').trim(),
    description: String(description || '').trim(),
    image: normalizedImage,
  };
  if (normalizedAnimationUrl) metadata.animation_url = normalizedAnimationUrl;
  if (normalizedExternalUrl) metadata.external_url = normalizedExternalUrl;
  const normalizedBackground = String(backgroundColor || '').trim().replace(/^#/, '');
  if (normalizedBackground) metadata.background_color = normalizedBackground;
  metadata.attributes = normalizedAttributes(attributes);
  const files = [{ uri: normalizedImage, type: normalizedMime(mimeType, 'image/png') }];
  if (normalizedAnimationUrl) {
    files.push({
      uri: normalizedAnimationUrl,
      type: normalizedMime(animationMimeType, 'application/octet-stream'),
    });
  }
  metadata.properties = {
    category: normalizedCategory(preset, category),
    files,
  };
  if (vesselProof && typeof vesselProof === 'object' && !Array.isArray(vesselProof)) {
    metadata.properties.vessel = Object.freeze({
      storage_network: String(vesselProof.storage_network || '').trim(),
      storage_address: String(vesselProof.storage_address || '').trim(),
      media_url: String(vesselProof.media_url || '').trim(),
      receipt_chain: String(vesselProof.receipt_chain || '').trim(),
      receipt_hash: String(vesselProof.receipt_hash || '').trim(),
      expires_at: String(vesselProof.expires_at || '').trim(),
    });
  }
  return freezeMetadata(metadata);
}

export function validateNftMetadata(metadata) {
  const errors = [];
  const warnings = [];
  if (typeof metadata?.name !== 'string' || !metadata.name.trim()) {
    errors.push(issue('name_required', 'name'));
  }
  if (typeof metadata?.description !== 'string' || !metadata.description.trim()) {
    errors.push(issue('description_required', 'description'));
  }
  if (!isSupportedUri(metadata?.image)) {
    errors.push(issue('image_uri_invalid', 'image'));
  }
  if (metadata?.external_url != null && metadata.external_url !== '' && !isSupportedUri(metadata.external_url)) {
    errors.push(issue('external_uri_invalid', 'external_url'));
  }
  if (metadata?.animation_url != null && metadata.animation_url !== '' && !isSupportedUri(metadata.animation_url)) {
    errors.push(issue('animation_uri_invalid', 'animation_url'));
  }
  if (metadata?.background_color != null && metadata.background_color !== '' && !BACKGROUND_COLOR.test(metadata.background_color)) {
    errors.push(issue('background_color_invalid', 'background_color'));
  }
  if (!SUPPORTED_METADATA_CATEGORIES.includes(String(metadata?.properties?.category || '').toLowerCase())) {
    warnings.push(issue('category_unsupported', 'properties.category', 'warning'));
  }
  if (!Array.isArray(metadata?.attributes)) {
    errors.push(issue('attributes_invalid', 'attributes'));
  } else {
    if (!metadata.attributes.length) warnings.push(issue('metadata_no_traits', 'attributes', 'warning'));
    metadata.attributes.forEach((attribute, index) => {
      const traitType = attribute?.trait_type;
      const generic = traitType == null && typeof attribute?.value === 'string';
      if (!generic && (typeof traitType !== 'string' || !traitType.trim())) {
        errors.push(issue('attribute_trait_required', `attributes.${index}.trait_type`));
      }
      const displayType = attribute?.display_type;
      if (displayType != null && !VALID_DISPLAY_TYPES.has(String(displayType))) {
        errors.push(issue('attribute_display_type_invalid', `attributes.${index}.display_type`));
      }
      const value = attribute?.value;
      const numeric = displayType != null;
      if (numeric && !(typeof value === 'number' && Number.isFinite(value))) {
        errors.push(issue('attribute_value_invalid', `attributes.${index}.value`));
      }
      if (!numeric && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
        errors.push(issue('attribute_value_invalid', `attributes.${index}.value`));
      }
      if (attribute?.max_value != null && !(typeof attribute.max_value === 'number' && Number.isFinite(attribute.max_value))) {
        errors.push(issue('attribute_max_value_invalid', `attributes.${index}.max_value`));
      }
    });
  }

  const primary = metadata?.properties?.files?.[0];
  if (!primary || typeof primary.uri !== 'string' || !primary.uri || typeof primary.type !== 'string' || !primary.type) {
    errors.push(issue('primary_file_required', 'properties.files.0'));
  } else {
    if (primary.uri !== metadata.image) errors.push(issue('primary_file_uri_mismatch', 'properties.files.0.uri'));
  }
  for (const [index, file] of [...(metadata?.properties?.files || [])].entries()) {
    if (!isSupportedUri(file?.uri)) errors.push(issue('file_uri_invalid', `properties.files.${index}.uri`));
    if (typeof file?.type !== 'string' || !file.type.trim()) errors.push(issue('file_type_required', `properties.files.${index}.type`));
  }
  if (metadata?.properties?.vessel) {
    warnings.push(issue('vessel_proof_marketplace_ignored', 'properties.vessel', 'warning'));
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
}

export function serializeNftMetadata(metadata) {
  const validation = validateNftMetadata(metadata);
  if (!validation.valid) {
    throw Object.assign(new Error('Invalid NFT metadata'), {
      code: 'metadata_invalid',
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }
  return `${JSON.stringify(metadata, null, 2)}\n`;
}
```

- [ ] **Step 4: Run schema tests**

Run:

```powershell
Set-Location app/server
npm test -- test/metadata-schema.test.js
```

Expected: PASS for `metadata-schema.test.js`.

- [ ] **Step 5: Commit**

```powershell
git add app/server/public/metadata-schema.js app/server/test/metadata-schema.test.js
git commit -m "feat(metadata): support marketplace metadata schema"
```

---

### Task 3: Batch Numbering, CSV Overrides, And ZIP Names

**Files:**
- Modify: `app/server/public/metadata-batch.js`
- Modify: `app/server/test/metadata-batch.test.js`
- Modify: `app/server/test/metadata-export.test.js`

**Interfaces:**
- Consumes: `createNftMetadata(options)` from `metadata-schema.js`
- Consumes: `formatItemName(pattern, collectionName, tokenNumber)` and `metadataOutputPathForNumber(number)` from `metadata-template-presets.js`
- Consumes: `parseCsvTraitColumn`, `normalizeCsvTraitValue`, `mergeTraitMaxValues` from `metadata-traits.js`
- Produces: `parseMetadataCsv(text): CsvRow[]` with advanced fields and traits.
- Produces: `buildMetadataBatch(options)` whose item `outputPath` is `1.json`, `2.json`, `3.json`.

- [ ] **Step 1: Add failing tests for sequential metadata names and advanced CSV**

Modify `app/server/test/metadata-batch.test.js`:

```js
test('batch output names use token numbering instead of source filenames', async () => {
  const result = await buildMetadataBatch({
    files: [
      asset('alpha.png', 'collection/art/alpha.png', 'image/png'),
      asset('beta.webp', 'collection/art/beta.webp', 'image/webp'),
    ],
    defaults: {
      collectionName: 'Shelby Ghosts',
      itemNamePattern: '<Collection Name> #<Number>',
      description: 'Wallet-owned collection',
      startNumber: 1,
    },
    uriForImage: async (_file, relativePath) => `https://example.com/${relativePath}`,
  });

  assert.deepEqual(result.items.map((item) => item.metadata.name), [
    'Shelby Ghosts #1',
    'Shelby Ghosts #2',
  ]);
  assert.deepEqual(result.items.map((item) => item.outputPath), [
    '1.json',
    '2.json',
  ]);
});

test('advanced CSV columns override metadata fields and trait display types', async () => {
  const rows = parseMetadataCsv([
    'filename,name,description,external_url,background_color,animation_url,trait:Background,number:Power,number:Power:max,date:Birthday,boost_percentage:Luck',
    'alpha.png,CSV Name,CSV Description,https://example.com/item,00ffee,https://example.com/alpha.mp4,Blue,80,100,1546360800,15',
  ].join('\n'));
  const result = await buildMetadataBatch({
    files: [asset('alpha.png', 'collection/art/alpha.png', 'image/png')],
    csvRows: rows,
    defaults: {
      preset: 'video',
      collectionName: 'Shelby Ghosts',
      itemNamePattern: '<Collection Name> #<Number>',
      description: 'Default description',
    },
    uriForImage: async () => 'https://example.com/alpha.png',
  });

  const metadata = result.items[0].metadata;
  assert.equal(metadata.name, 'CSV Name');
  assert.equal(metadata.description, 'CSV Description');
  assert.equal(metadata.external_url, 'https://example.com/item');
  assert.equal(metadata.background_color, '00ffee');
  assert.equal(metadata.animation_url, 'https://example.com/alpha.mp4');
  assert.deepEqual(metadata.attributes, [
    { trait_type: 'Background', value: 'Blue' },
    { display_type: 'number', trait_type: 'Power', value: 80, max_value: 100 },
    { display_type: 'date', trait_type: 'Birthday', value: 1546360800 },
    { display_type: 'boost_percentage', trait_type: 'Luck', value: 15 },
  ]);
});
```

- [ ] **Step 2: Run batch tests to verify they fail**

Run:

```powershell
Set-Location app/server
npm test -- test/metadata-batch.test.js
```

Expected: FAIL because `collectionName`, `itemNamePattern`, sequential `1.json`, and advanced CSV columns are not wired.

- [ ] **Step 3: Update CSV parser and batch builder**

Modify `app/server/public/metadata-batch.js`:

```js
import {
  createNftMetadata,
  serializeNftMetadata,
  validateNftMetadata,
} from './metadata-schema.js';
import {
  formatItemName,
  metadataOutputPathForNumber,
} from './metadata-template-presets.js';
import {
  mergeTraitMaxValues,
  normalizeCsvTraitValue,
  parseCsvTraitColumn,
} from './metadata-traits.js';
```

Inside `parseMetadataCsv`, replace the row initialization and header handling with:

```js
const row = {
  filename,
  name: '',
  description: '',
  external_url: '',
  background_color: '',
  animation_url: '',
  attributes: [],
};
const maxColumns = new Map();
for (let index = 0; index < headers.length; index += 1) {
  const header = normalizedHeaders[index];
  const originalHeader = headers[index];
  const cell = values[index].trim();
  if (['name', 'description', 'external_url', 'background_color', 'animation_url'].includes(header)) row[header] = cell;
  const traitColumn = parseCsvTraitColumn(originalHeader);
  if (traitColumn?.max) {
    const numericMax = Number(cell);
    if (cell !== '' && Number.isFinite(numericMax)) maxColumns.set(traitColumn.trait_type.toLowerCase(), numericMax);
    continue;
  }
  const attribute = normalizeCsvTraitValue(traitColumn, cell);
  if (attribute) row.attributes.push(attribute);
}
row.attributes = mergeTraitMaxValues(row.attributes, maxColumns);
```

Inside `buildMetadataBatch`, replace token name and output path generation:

```js
const startNumber = Number.isSafeInteger(Number(defaults.startNumber)) && Number(defaults.startNumber) >= 0
  ? Number(defaults.startNumber)
  : 1;
```

Use this inside the image loop:

```js
const tokenNumber = startNumber + index;
const collectionName = String(defaults.collectionName || defaults.namePrefix || '').trim();
const itemNamePattern = String(defaults.itemNamePattern || '<Collection Name> #<Number>');
const generatedName = formatItemName(itemNamePattern, collectionName, tokenNumber);
const metadata = createNftMetadata({
  preset: defaults.preset || 'marketplace',
  name: nonBlank(csv?.name, imported.name, generatedName),
  description: nonBlank(csv?.description, imported.description, String(defaults.description || '')),
  image: imageUri,
  externalUrl: nonBlank(csv?.external_url, imported.external_url, String(defaults.externalUrl || '')),
  animationUrl: nonBlank(csv?.animation_url, imported.animation_url, String(defaults.animationUrl || '')),
  backgroundColor: nonBlank(csv?.background_color, imported.background_color, String(defaults.backgroundColor || '')),
  attributes: mergeAttributes(defaults.attributes, imported.attributes, csv?.attributes),
  mimeType: image.mimeType,
  animationMimeType: String(defaults.animationMimeType || 'application/octet-stream'),
  category: defaults.category,
});
const outputPath = metadataOutputPathForNumber(tokenNumber);
```

Update duplicate output checks to use token numbers:

```js
const outputPath = metadataOutputPathForNumber(startNumber + index);
```

- [ ] **Step 4: Run batch and export tests**

Run:

```powershell
Set-Location app/server
npm test -- test/metadata-batch.test.js test/metadata-export.test.js
```

Expected: PASS for both files.

- [ ] **Step 5: Commit**

```powershell
git add app/server/public/metadata-batch.js app/server/test/metadata-batch.test.js app/server/test/metadata-export.test.js
git commit -m "feat(metadata): generate numbered collection metadata"
```

---

### Task 4: Metadata Designer UI Wiring

**Files:**
- Modify: `app/server/public/metadata.html`
- Modify: `app/server/public/metadata-page.js`
- Modify: `app/server/public/vessel.css`
- Modify: `app/server/test/latency-and-metadata.test.js`
- Modify: `app/server/test/metadata-page.test.js`

**Interfaces:**
- Consumes: `METADATA_PRESETS` from `metadata-template-presets.js`
- Consumes: expanded `createNftMetadata(options)` and `validateNftMetadata(metadata)`
- Produces: UI controls with IDs listed below.

Required IDs:

- `metadata-preset`
- `nft-animation-url`
- `nft-background-color`
- `nft-category`
- `nft-vessel-proof`
- `metadata-card-preview`
- `batch-preset`
- `batch-item-name-pattern`
- `batch-background-color`
- `batch-animation-url`
- `batch-erc1155-helper`

- [ ] **Step 1: Add failing UI presence tests**

Append to `app/server/test/latency-and-metadata.test.js`:

```js
test('metadata designer exposes presets and advanced NFT fields without minting controls', () => {
  const html = readPage('metadata.html');
  for (const id of [
    'metadata-preset',
    'nft-animation-url',
    'nft-background-color',
    'nft-category',
    'nft-vessel-proof',
    'metadata-card-preview',
    'batch-preset',
    'batch-item-name-pattern',
    'batch-background-color',
    'batch-animation-url',
    'batch-erc1155-helper',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /mint nft|deploy nft contract|marketplace listing/i);
});
```

Add to `app/server/test/metadata-page.test.js`:

```js
test('metadata page sends selected preset fields to schema preview', async () => {
  const dom = await loadMetadataDom();
  dom.window.document.querySelector('#nft-name').value = 'Video Artifact #1';
  dom.window.document.querySelector('#nft-desc').value = 'Video metadata';
  dom.window.document.querySelector('#metadata-preset').value = 'video';
  dom.window.document.querySelector('#nft-animation-url').value = 'https://example.com/video.mp4';
  dom.window.document.querySelector('#nft-background-color').value = '00ffee';
  dom.window.document.querySelector('#metadata-preset').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.querySelector('#nft-animation-url').dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  const preview = dom.window.document.querySelector('#json-preview').textContent;
  assert.match(preview, /"animation_url": "https:\/\/example\.com\/video\.mp4"/);
  assert.match(preview, /"background_color": "00ffee"/);
  assert.match(preview, /"category": "video"/);
});
```

If `metadata-page.test.js` uses a different DOM helper name, adapt the test to the existing helper in that file while keeping the same assertions and IDs.

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```powershell
Set-Location app/server
npm test -- test/latency-and-metadata.test.js test/metadata-page.test.js
```

Expected: FAIL because the new controls are absent.

- [ ] **Step 3: Add metadata controls to HTML**

In `app/server/public/metadata.html`, add these controls inside the single NFT field section before `Name`:

```html
<div>
  <label class="vessel-technical mb-2 block text-xs text-on-surface-variant" for="metadata-preset">Template preset</label>
  <select id="metadata-preset" class="vessel-input">
    <option value="marketplace">Marketplace Compatible</option>
    <option value="image">Image NFT</option>
    <option value="video">Video NFT</option>
    <option value="audio">Audio NFT</option>
    <option value="html">HTML or Interactive NFT</option>
    <option value="game">Game Item</option>
  </select>
</div>
```

Add these controls inside the existing single advanced area:

```html
<details class="mt-7 rounded-2xl border border-white/10 bg-surface-lowest/35 p-5">
  <summary class="vessel-technical min-h-11 list-none text-xs text-tertiary-container">Advanced metadata fields</summary>
  <div class="mt-5 grid gap-5 md:grid-cols-2">
    <div><label class="vessel-technical mb-2 block text-xs text-on-surface-variant" for="nft-animation-url">Animation or rich media URL</label><input id="nft-animation-url" class="vessel-input" type="url" inputmode="url" placeholder="https://example.com/video.mp4"></div>
    <div><label class="vessel-technical mb-2 block text-xs text-on-surface-variant" for="nft-background-color">Background color</label><input id="nft-background-color" class="vessel-input" type="text" maxlength="7" placeholder="00ffee"></div>
    <div><label class="vessel-technical mb-2 block text-xs text-on-surface-variant" for="nft-category">Media category</label><select id="nft-category" class="vessel-input"><option value="image">image</option><option value="video">video</option><option value="audio">audio</option><option value="html">html</option><option value="vr">vr</option></select></div>
    <label class="metadata-choice"><input id="nft-vessel-proof" type="checkbox"><span><strong>Include Vessel proof</strong><small>Add storage and receipt evidence under properties.vessel.</small></span></label>
  </div>
</details>
```

Add a preview card near JSON preview:

```html
<aside id="metadata-card-preview" class="metadata-card-preview" aria-label="Marketplace card preview">
  <div class="metadata-card-media"><span class="material-symbols-outlined" aria-hidden="true">image</span></div>
  <strong data-preview-name>Untitled NFT</strong>
  <small data-preview-description>No description yet.</small>
</aside>
```

Add batch controls near batch defaults:

```html
<div><label class="vessel-technical mb-2 block text-xs text-on-surface-variant" for="batch-preset">Template preset</label><select id="batch-preset" class="vessel-input"><option value="marketplace">Marketplace Compatible</option><option value="image">Image NFT</option><option value="video">Video NFT</option><option value="audio">Audio NFT</option><option value="html">HTML or Interactive NFT</option><option value="game">Game Item</option></select></div>
<div><label class="vessel-technical mb-2 block text-xs text-on-surface-variant" for="batch-item-name-pattern">Item name pattern</label><input id="batch-item-name-pattern" class="vessel-input" type="text" value="&lt;Collection Name&gt; #&lt;Number&gt;"></div>
<div><label class="vessel-technical mb-2 block text-xs text-on-surface-variant" for="batch-background-color">Background color</label><input id="batch-background-color" class="vessel-input" type="text" maxlength="7" placeholder="00ffee"></div>
<div><label class="vessel-technical mb-2 block text-xs text-on-surface-variant" for="batch-animation-url">Animation URL pattern</label><input id="batch-animation-url" class="vessel-input" type="url" inputmode="url" placeholder="https://example.com/rich-media"></div>
<p id="batch-erc1155-helper" class="text-xs leading-5 text-outline">Advanced ERC-1155 URI mode can use {id}, resolved as lowercase hex padded to 64 characters.</p>
```

- [ ] **Step 4: Wire controls in `metadata-page.js`**

Add imports:

```js
import { METADATA_PRESETS } from './metadata-template-presets.js';
```

Add elements:

```js
preset: byId('metadata-preset'),
animationUrl: byId('nft-animation-url'),
backgroundColor: byId('nft-background-color'),
category: byId('nft-category'),
vesselProof: byId('nft-vessel-proof'),
cardPreview: byId('metadata-card-preview'),
batchPreset: byId('batch-preset'),
batchItemNamePattern: byId('batch-item-name-pattern'),
batchBackgroundColor: byId('batch-background-color'),
batchAnimationUrl: byId('batch-animation-url'),
```

Update `currentSingleMetadata()`:

```js
return createNftMetadata({
  preset: element.preset?.value || 'marketplace',
  name: element.name?.value,
  description: element.description?.value,
  image: artifactUrl,
  externalUrl: element.externalUrl?.value,
  animationUrl: element.animationUrl?.value,
  backgroundColor: element.backgroundColor?.value,
  category: element.category?.value,
  attributes: traitValues(),
  mimeType: metadataImageMimeType(artifactFile),
  animationMimeType: 'application/octet-stream',
  vesselProof: element.vesselProof?.checked ? {
    storage_network: 'shelby-testnet',
    storage_address: currentWallet?.session?.storageAddress || '',
    media_url: artifactUrl,
    receipt_chain: currentWallet?.session?.chain || '',
    receipt_hash: selectedArtifact?.receiptHash || '',
    expires_at: selectedArtifact?.expiresAt || '',
  } : null,
});
```

Update `rebuildBatch()` defaults:

```js
defaults: {
  preset: element.batchPreset?.value || 'marketplace',
  collectionName: element.batchName?.value || collection.name,
  itemNamePattern: element.batchItemNamePattern?.value || '<Collection Name> #<Number>',
  description: element.batchDescription?.value,
  externalUrl: element.batchExternalUrl?.value,
  animationUrl: element.batchAnimationUrl?.value,
  backgroundColor: element.batchBackgroundColor?.value,
  startNumber: Number(element.startNumber?.value || 1),
},
```

Add `renderCardPreview(metadata)`:

```js
function renderCardPreview(metadata) {
  if (!element.cardPreview) return;
  const name = element.cardPreview.querySelector('[data-preview-name]');
  const description = element.cardPreview.querySelector('[data-preview-description]');
  if (name) name.textContent = metadata.name || 'Untitled NFT';
  if (description) description.textContent = metadata.description || 'No description yet.';
  element.cardPreview.dataset.preset = element.preset?.value || 'marketplace';
}
```

Call `renderCardPreview(metadata)` inside `renderSingle()`.

Update event wiring:

```js
[element.name, element.description, element.externalUrl, element.preset, element.animationUrl, element.backgroundColor, element.category, element.vesselProof].forEach((input) => {
  input?.addEventListener('input', renderSingle);
  input?.addEventListener('change', renderSingle);
});
[element.batchName, element.batchDescription, element.batchExternalUrl, element.baseUri, element.startNumber, element.batchPreset, element.batchItemNamePattern, element.batchBackgroundColor, element.batchAnimationUrl].forEach((input) => {
  input?.addEventListener('input', scheduleBatchRebuild);
  input?.addEventListener('change', scheduleBatchRebuild);
});
```

- [ ] **Step 5: Add compact CSS if needed**

Append to `app/server/public/vessel.css` only if no equivalent classes exist:

```css
.metadata-card-preview {
  border-top: 1px solid rgba(255,255,255,.06);
  display: grid;
  gap: .75rem;
  padding: 1.25rem 1.5rem;
}

.metadata-card-media {
  align-items: center;
  aspect-ratio: 1;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 1rem;
  display: flex;
  justify-content: center;
  max-width: 9rem;
}
```

- [ ] **Step 6: Run UI tests**

Run:

```powershell
Set-Location app/server
npm test -- test/latency-and-metadata.test.js test/metadata-page.test.js
```

Expected: PASS for both files.

- [ ] **Step 7: Commit**

```powershell
git add app/server/public/metadata.html app/server/public/metadata-page.js app/server/public/vessel.css app/server/test/latency-and-metadata.test.js app/server/test/metadata-page.test.js
git commit -m "feat(metadata): add nft metadata designer UI"
```

---

### Task 5: Full Verification, Build, And Documentation Touch-Up

**Files:**
- Modify: `README.md`
- Modify: `docs/notion/vessel-product-page.md` if present and already tracked by the current branch.

**Interfaces:**
- Consumes: completed metadata designer behavior from Tasks 1-4.
- Produces: updated documentation text that accurately describes Metadata Designer.

- [ ] **Step 1: Add README metadata summary**

In `README.md`, update the metadata section so it states:

```markdown
Single and collection exports use one marketplace-compatible NFT metadata model. The Metadata Designer supports image, video, audio, HTML or interactive, and game item presets. Generated JSON can include `name`, `description`, `image`, `animation_url`, `external_url`, `background_color`, `attributes`, `properties.category`, and `properties.files`.

Batch collection names default to `<Collection Name> #<Number>`, and batch JSON files default to `1.json`, `2.json`, `3.json`. CSV overrides can update names, descriptions, external URLs, background colors, animation URLs, and text, number, date, boost number, or boost percentage traits.

Optional Vessel proof can be added under `properties.vessel`, but it is off by default so marketplace-facing JSON stays clean.
```

- [ ] **Step 2: Run full app test suite**

Run:

```powershell
Set-Location app/server
npm test
```

Expected: PASS across all `test/*.test.js`.

- [ ] **Step 3: Rebuild browser bundles**

Run:

```powershell
Set-Location app/server
npm run build:client
```

Expected: build completes without errors and updates only expected bundled files.

- [ ] **Step 4: Run combined check**

Run:

```powershell
Set-Location app/server
npm run check
```

Expected: PASS. This re-runs tests and client build.

- [ ] **Step 5: Inspect final diff**

Run:

```powershell
git diff --stat
git diff -- app/server/public/metadata-schema.js app/server/public/metadata-batch.js app/server/public/metadata-page.js app/server/public/metadata.html README.md
```

Expected:

- Metadata changes are scoped to designer behavior.
- No wallet private keys, API keys, `.env` contents, or generated secrets appear.
- No minting language appears as an implemented app action.
- `SHELBY_WRITES_ENABLED=false` behavior remains documented.

- [ ] **Step 6: Commit final docs and build outputs**

Stage only files intentionally changed by Tasks 1-5:

```powershell
git add README.md app/server/public app/server/test
git status --short
git commit -m "docs: document nft metadata designer"
```

Expected: commit succeeds. If `npm run build:client` generated bundled wallet files, include them only if this repo normally commits those generated public bundles.

---

## Self-Review

Spec coverage:

- Marketplace Compatible default: Task 2.
- Image, video, audio, HTML, game presets: Tasks 1, 2, 4.
- Auto naming and `1.json` output: Task 3.
- Trait editor data model: Tasks 1, 2, 4.
- Advanced CSV trait columns: Task 3.
- Optional Vessel proof: Task 2 and Task 4.
- Validation errors and warnings: Task 2.
- Shelby write gate for hosted metadata: Task 4 preserves existing hosting gate; Task 5 verifies full suite.
- No minting: Task 4 UI test and Task 5 diff review.

Placeholder scan:

- This plan intentionally avoids placeholder steps and includes concrete files, commands, and code snippets.

Type consistency:

- `metadata-template-presets.js` exports are consumed by schema, batch, and page tasks.
- `metadata-traits.js` exports are consumed by schema and batch tasks.
- `createNftMetadata` remains the central builder used by single and batch flows.
- `validateNftMetadata` keeps the existing `.valid` and `.errors` contract while adding `.warnings`.
