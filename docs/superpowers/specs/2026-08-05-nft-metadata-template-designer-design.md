# NFT Metadata Template Designer Design

**Date:** 2026-08-05
**Status:** Approved for spec review

## Objective

Vessel's metadata feature must become a real NFT metadata designer, not a thin JSON generator. It should help non-technical NFT creators produce marketplace-compatible JSON for single assets and collections while keeping advanced fields available when needed.

The default output must be conservative and widely compatible across ERC-721 style metadata consumers, OpenSea-style marketplaces, Solana Metaplex JSON, and Aptos Digital Asset `uri` usage.

## Standards Baseline

Vessel should treat these conventions as the baseline:

- ERC-721 metadata defines the core token JSON fields `name`, `description`, and `image`.
- ERC-1155 metadata allows `properties` and URI templates using `{id}`.
- OpenSea-style marketplaces commonly support `external_url`, `animation_url`, `attributes`, `background_color`, `display_type`, and `max_value`.
- Metaplex-style JSON expects `name`, `description`, `image`, `category`, optional `animation_url`, `attributes`, and `properties.files`.
- Aptos Digital Asset tokens point to a `uri`; that URI can resolve to media or an off-chain JSON document. Vessel should generate JSON that can be used as that off-chain URI target.

Vessel will not claim to mint tokens or guarantee marketplace ingestion. It prepares standards-compatible JSON and URLs that downstream NFT tooling can consume.

Reference sources used for this design:

- ERC-721: `https://eips.ethereum.org/EIPS/eip-721`
- ERC-1155: `https://eips.ethereum.org/EIPS/eip-1155`
- OpenSea metadata standards: `https://docs.opensea.io/docs/metadata-standards`
- OpenSea media and traits: `https://docs.opensea.io/docs/media-and-traits`
- Metaplex Core JSON schema: `https://www.metaplex.com/docs/smart-contracts/core/json-schema`
- Aptos token standard: `https://aptos.dev/build/smart-contracts/tokens`
- Aptos Digital Asset standard: `https://aptos.dev/build/smart-contracts/digital-asset`

## Default Template

The default preset is **Marketplace Compatible**.

It produces:

```json
{
  "name": "Collection Name #1",
  "description": "Item description.",
  "image": "https://vessel-sage.vercel.app/api/shelby/blobs/.../1.png",
  "external_url": "https://vessel-sage.vercel.app/preview/collection/item/1",
  "attributes": [
    {
      "trait_type": "Background",
      "value": "Blue"
    }
  ],
  "properties": {
    "category": "image",
    "files": [
      {
        "uri": "https://vessel-sage.vercel.app/api/shelby/blobs/.../1.png",
        "type": "image/png"
      }
    ]
  }
}
```

Rules:

- `name`, `description`, and `image` are required.
- `attributes` is included as an array, even if empty.
- `properties.files` is included for Solana and richer marketplace compatibility.
- `properties.category` is the media category.
- `external_url` is optional and omitted when blank.
- Field order should remain stable for readability and deterministic exports.

## Template Presets

Vessel should offer these user-selectable presets:

### Image NFT

Use when the asset is a still image or GIF.

- Required: `name`, `description`, `image`.
- Category: `image`.
- `properties.files[0]` points to the image.

### Video NFT

Use when the NFT has a preview image and a video asset.

- `image` points to the preview image.
- `animation_url` points to the video.
- Category: `video`.
- `properties.files` includes both preview image and video.

### Audio NFT

Use when the NFT has a cover image and an audio asset.

- `image` points to the cover image.
- `animation_url` points to the audio.
- Category: `audio`.
- `properties.files` includes both cover image and audio.

### HTML or Interactive NFT

Use when `animation_url` points to an HTML experience.

- `image` points to a preview image.
- `animation_url` points to the HTML page.
- Category: `html`.
- Show a warning that marketplaces may sandbox scripts differently.

### Game Item

Use when traits are more important than media complexity.

- Category defaults to `image`.
- Adds common trait suggestions such as `Class`, `Rarity`, `Level`, `Power`, and `Season`.
- Numeric traits should use `display_type: "number"` when appropriate.

## User Controls

Metadata Designer should expose:

- Template preset selector.
- Collection name.
- Collection symbol, optional for export notes but not required in item JSON.
- Item name pattern, default `<Collection Name> #<Number>`.
- Start number, default `1`.
- Description template.
- External URL pattern.
- Background color, optional six-character hex without `#`.
- Media category: `image`, `video`, `audio`, `html`, `vr`.
- Primary image source.
- Animation or rich media source.
- Trait editor.
- CSV import for batch traits and item-level overrides.
- JSON preview.
- Marketplace card preview.
- Validation summary.

The interface should present simple fields first and hide advanced fields behind an Advanced section.

## Naming and Numbering

Batch item names use:

```text
<Collection Name> #<Number>
```

Examples:

```text
Vessel Genesis #1
Vessel Genesis #2
Vessel Genesis #3
```

Rules:

- Numbering starts at `1`.
- Exported JSON filenames default to `1.json`, `2.json`, `3.json`.
- The item `name` field and JSON filename numbering must match.
- Original source filename and path are preserved in `properties.files` or Vessel support metadata when available.
- CSV `name` overrides generated names per item.
- Changing the collection name updates all non-overridden generated names.
- Vessel does not rename local files or Shelby blobs.

## Trait Model

Trait editor supports these attribute types:

- Text: `{ "trait_type": "Background", "value": "Blue" }`.
- Number: `{ "display_type": "number", "trait_type": "Power", "value": 80 }`.
- Number with max: `{ "display_type": "number", "trait_type": "Power", "value": 80, "max_value": 100 }`.
- Date: `{ "display_type": "date", "trait_type": "Birthday", "value": 1546360800 }`.
- Boost number: `{ "display_type": "boost_number", "trait_type": "Speed", "value": 20 }`.
- Boost percentage: `{ "display_type": "boost_percentage", "trait_type": "Luck", "value": 15 }`.
- Generic string: `{ "value": "Special Edition" }`.

Validation rules:

- Text traits require a non-empty `trait_type` unless the user explicitly selects Generic string.
- Number, boost, and date traits require finite numeric values.
- `max_value` is optional but must be finite when present.
- Date values are Unix time in seconds.
- Empty trait rows are ignored before export.

## CSV Import

CSV import remains an override layer, not a second artwork source.

Required column:

- `filename`

Supported item fields:

- `name`
- `description`
- `external_url`
- `background_color`
- `animation_url`

Supported trait columns:

- `trait:Background`
- `trait:Rarity`
- `number:Power`
- `number:Power:max`
- `date:Birthday`
- `boost_number:Speed`
- `boost_percentage:Luck`

CSV matching accepts full relative path or basename. Unmatched rows are warnings, not silent drops.

## Advanced Vessel Proof

Vessel-specific storage and settlement proof should be optional and off by default.

When enabled, add a namespaced field:

```json
{
  "properties": {
    "vessel": {
      "storage_network": "shelby-testnet",
      "storage_address": "0x...",
      "media_url": "https://...",
      "receipt_chain": "aptos-testnet",
      "receipt_hash": "0x...",
      "expires_at": "2026-08-12T00:00:00.000Z"
    }
  }
}
```

This field must not replace marketplace-standard fields. It is only supplemental evidence for reviewers and advanced users.

## Validation

Metadata validation should return actionable issues:

- Missing item name.
- Missing description.
- Missing image.
- Invalid URI scheme.
- HTTP URL used instead of HTTPS, IPFS, or Arweave.
- Invalid `animation_url`.
- Unsupported media category.
- Missing primary file.
- `image` does not match the primary image file when expected.
- Invalid background color.
- Invalid trait display type.
- Invalid trait value.
- Duplicate token number.
- Duplicate output filename.
- Shelby writes disabled for hosted metadata.

Validation should distinguish blocking errors from warnings.

Blocking examples:

- Missing `name`.
- Missing `image`.
- Invalid URL.
- Duplicate output filename.

Warning examples:

- No traits.
- Image is smaller than recommended marketplace dimensions if dimensions are available.
- HTML preset may not render consistently on all marketplaces.
- Vessel proof enabled may be ignored by marketplaces.

## Output Modes

Single NFT:

- Download one JSON file.
- Host JSON on Shelby only when writes are enabled.
- Copy metadata URL after hosting.

Batch collection:

- Download ZIP containing `1.json`, `2.json`, `3.json`.
- Show item preview before export.
- Host collection metadata on Shelby only when writes are enabled.
- Copy base URI only when hosted or when user enters a custom base URI.

ERC-1155 compatibility:

- Offer an advanced URI pattern helper for `{id}`.
- Explain that `{id}` is lowercase hex, 64 characters, no `0x`.
- Do not enable this by default for ordinary ERC-721 style collections.

## Component Boundaries

- `metadata-template-presets`: defines preset defaults and allowed fields.
- `metadata-schema`: builds and validates canonical JSON objects.
- `metadata-traits`: normalizes trait rows and CSV trait columns.
- `metadata-batch`: maps collection items to numbered metadata outputs.
- `metadata-preview`: renders JSON and marketplace-style card previews.
- `metadata-validation`: separates blocking errors and warnings.
- `metadata-hosting`: keeps Shelby hosting behind the write gate.

These modules should be plain JavaScript and testable without wallet extensions.

## Verification

Automated tests should cover:

- Default Marketplace Compatible output.
- Image, video, audio, HTML, and game item presets.
- Stable field order.
- `animation_url` generation for rich media presets.
- `properties.files` with one or multiple media files.
- `background_color` validation.
- Text, number, date, boost number, boost percentage, and generic attributes.
- CSV trait column parsing.
- Auto naming and JSON filename numbering.
- CSV override priority.
- ERC-1155 `{id}` helper formatting.
- Optional Vessel proof namespace.
- Shelby write gate behavior for hosted metadata.

Manual verification should cover:

- A creator can pick a preset without understanding NFT schema details.
- JSON preview updates immediately as fields change.
- Marketplace card preview shows the expected media and traits.
- Batch export creates `1.json`, `2.json`, `3.json`.
- No minting button or NFT contract deployment action appears.

## Non-Goals

- Minting NFTs.
- Deploying NFT contracts.
- Marketplace submission automation.
- Private metadata encryption.
- Mainnet durability claims.
- Forcing Vessel proof into every metadata file.
- Renaming local source files or existing Shelby blobs.
