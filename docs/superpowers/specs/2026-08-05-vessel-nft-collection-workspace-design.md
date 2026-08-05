# Vessel NFT Collection Workspace Design

**Date:** 2026-08-05
**Status:** Approved for spec review

## Objective

Vessel must feel useful to NFT creators, not only to storage protocol reviewers. The app should become a wallet-native NFT collection preparation workspace that helps a user organize uploaded Shelby media, generate canonical NFT metadata, validate readiness, preview public outputs, and monitor collection health.

The scope explicitly excludes NFT minting, NFT contract deployment, and marketplace listing.

## Product Position

Vessel prepares NFT media and metadata URLs. It does not mint NFTs.

The primary workflow is:

1. Connect an Aptos or Solana wallet.
2. Prepare single media or a collection on Shelby.
3. Build NFT metadata from wallet-owned Shelby assets.
4. Validate marketplace readiness.
5. Copy or download URLs and JSON for an external minting or marketplace tool.

When Shelby writes are paused, Vessel must keep workspace, metadata preview, validation, and local ZIP export usable from eligible Vault history. It must not claim that new assets or generated JSON were freshly hosted on Shelby while `SHELBY_WRITES_ENABLED=false`.

## Major Features

### 1. Collection Workspace

Add a collection-centered workspace view that groups related uploaded artifacts from the connected wallet's Vault.

Each collection shows:

- Collection name.
- Description.
- Creator name or wallet address.
- Intended supply.
- Total stored size.
- Retention duration and earliest expiry.
- Upload status.
- Metadata status.
- Settlement receipt status.
- Public access status.
- Health status.
- Actions to open metadata builder, copy base URI, copy sample token URI, download metadata ZIP, and open public preview.

The workspace must use existing wallet-scoped Vault data. It must not require the user to reselect the original computer folder after media has already been uploaded.

### 2. Automatic NFT Item Naming

When a user enters a collection name, Vessel automatically creates NFT item names using:

```text
<Collection Name> #<Number>
```

Examples:

```text
Shelby Ghosts #1
Shelby Ghosts #2
Shelby Ghosts #3
```

Rules:

- The user-entered collection name is the source of truth for generated item names.
- Numbering starts at `#1` by default.
- Sorting follows the current deterministic collection item order: normalized relative path with numeric-aware ordering.
- The generated item name is written to the metadata `name` field.
- Vessel does not rename files on the user's computer.
- Vessel does not rename already uploaded Shelby blobs.
- Vessel may show the generated item name as the display label in the app.
- The original filename and source path remain preserved in metadata support fields such as `properties.files`, when available.
- If the user imports CSV metadata, CSV item names override automatic names only for matching items.
- If the collection name changes, automatically generated names update immediately for items that have not been manually or CSV overridden.

For exported batch metadata, file names should default to `1.json`, `2.json`, `3.json`, and so on. The JSON file numbering must match the displayed item numbering unless the user selects a later advanced offset option. Advanced offset is out of scope for this pass.

### 3. Metadata Builder Upgrade

Single and batch metadata must use the same canonical NFT schema.

The builder supports:

- Collection name and description.
- Auto-generated item names.
- Item description template.
- Optional external URL.
- Collection fields.
- Trait editor.
- CSV trait import for batch.
- Marketplace-style NFT card preview.
- Validation for missing `name`, `description`, `image`, unsupported media URL, duplicate token number, and empty collection name.
- ZIP export for batch JSON.

The batch builder starts from a collection already recorded in the connected wallet's Vault. It does not ask for the artwork folder again.

### 4. Marketplace Readiness Panel

Add a checklist that explains whether the collection is ready for downstream NFT tooling.

Readiness checks:

- Media URLs exist.
- Media URLs are publicly readable.
- Metadata JSON can be generated.
- Batch ZIP can be exported.
- Hosted metadata is available or correctly blocked by Shelby write pause.
- Token URI format is available.
- Settlement receipt exists when required.
- Retention is active.
- No required metadata fields are missing.
- No broken image or metadata links are detected.

The panel must produce practical messages, for example:

- `Ready for external minting tools`.
- `Metadata can be exported locally, but hosting is paused because Shelby writes are disabled`.
- `3 items are missing image URLs`.
- `2 assets expire within 24 hours`.

### 5. Public Preview Page

Add a public preview route for an artifact or collection.

Artifact preview shows:

- Media preview.
- Metadata JSON, if available.
- Copy media URL.
- Copy metadata URL, if hosted.
- Expiry.
- Chain receipt.

Collection preview shows:

- Collection summary.
- Sample item grid.
- Metadata status.
- Token URI examples.
- Expiry and health warnings.
- Chain receipt summary.

The preview route must not expose secrets or private browser-only state. If the required data exists only in local Vault history, the app should show an in-app preview instead of promising a public remote preview.

### 6. Collection Health

Add health checks for NFT usability:

- Media URL resolves.
- Hosted metadata URL resolves, when hosted.
- Media MIME type is compatible with NFT display.
- Metadata image field points to the expected media URL.
- Item has a generated or explicit name.
- Item has an image URL.
- Item expiry is still active.
- Collection has no duplicate token numbers.

Health checks should be incremental and retryable. A failed check should not erase Vault records.

## Data Model

Use a workspace-level collection model derived from existing Vault records:

```text
CollectionWorkspace
  id
  storageAddress
  source
  collectionName
  description
  creator
  createdAt
  updatedAt
  items[]
  metadataPlan
  readiness
  health
```

Each item includes:

```text
CollectionItem
  tokenNumber
  generatedName
  explicitName
  sourcePath
  originalFilename
  mediaUrl
  mediaType
  sizeBytes
  expiry
  receipt
  traits[]
  validation[]
```

`generatedName` is computed from `collectionName` and `tokenNumber`. `explicitName` is used only when manually edited or imported from CSV.

## UI Flow

The dApp should expose the collection workspace as a first-class navigation item.

Flow:

1. User opens Collections.
2. Vessel loads wallet-scoped collections from Vault history and, when available, remote Shelby reconciliation.
3. User selects or creates a collection workspace from uploaded artifacts.
4. User enters the collection name.
5. Vessel automatically displays names like `<Collection Name> #1`.
6. User reviews previews, traits, and validation.
7. User exports metadata ZIP or hosts metadata when Shelby writes are available.
8. User copies token URI examples for external minting tools.

## Error Handling

- Empty collection name: block metadata export and show a focused validation message.
- Name contains leading or trailing spaces: trim for generated names while preserving the user's visible typed value until blur.
- Duplicate collection names: allow them if the workspace id differs, but show storage address and created date so users can distinguish them.
- Missing source paths: keep the asset in Vault but exclude it from batch collection generation unless the user manually adds it to a workspace.
- Shelby write pause: keep local generation available, disable hosting, and explain the pause.
- Broken media URL: mark item unhealthy and keep retry available.
- CSV mismatch: keep existing warnings and do not silently drop unmatched rows.

## Component Boundaries

- `vault-collections`: derives collection groups and ordering from Vault records.
- `collection-workspace`: stores workspace-level user edits such as collection name, description, creator, and item overrides.
- `metadata-schema`: produces canonical single and batch NFT JSON.
- `metadata-batch`: maps workspace items to numbered JSON outputs.
- `metadata-preview`: renders NFT card and JSON preview.
- `readiness-checks`: computes marketplace readiness messages.
- `health-checks`: probes URLs and metadata consistency.
- `public-preview`: renders shareable artifact or collection pages when data is remotely available.

Existing wallet, settlement, quote, upload, and Shelby provider boundaries remain unchanged.

## Verification

Automated tests should cover:

- Auto naming from collection name.
- Renumbering after deterministic sorting.
- CSV names overriding generated names.
- Changing collection name updates non-overridden item names.
- Batch JSON filenames match token numbering.
- Metadata schema remains valid for single and batch output.
- Readiness states for hosted, local-only, and Shelby-paused modes.
- Health checks for broken media URLs and missing metadata fields.
- Wallet switching clears or reloads workspace state correctly.

Manual browser verification should cover:

- Create or select a collection workspace.
- Enter a collection name and see item names update to `<Collection Name> #1`.
- Generate metadata ZIP.
- Preview NFT cards.
- Confirm no NFT minting action exists.
- Confirm Shelby-paused hosting is disabled but local export remains available.

## Non-Goals

- Minting NFTs.
- Deploying NFT contracts.
- Marketplace listing.
- Private or encrypted storage.
- Permanent storage claims.
- Rewriting or renaming files on the user's computer.
- Renaming already uploaded Shelby blobs.
- Requiring a second local folder selection for batch metadata.
