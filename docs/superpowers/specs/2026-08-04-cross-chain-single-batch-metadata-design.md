# Cross-chain Single and Batch NFT Metadata Design

Date: 2026-08-04
Status: Approved for planning

## Summary

Vessel will replace the current minimal single-item metadata composer with one shared cross-chain metadata system for both `Single NFT` and `Batch Collection` workflows. Both workflows generate the same canonical JSON shape, validate it locally, and can export it without contacting Shelby. Hosting JSON on Shelby remains a first-class feature, but every hosted JSON blob must use the same wallet-owned quote, settlement-contract receipt, registration, and upload pipeline as media uploads.

Shelby testnet currently rejects new uploads. Generation, preview, validation, and local export must therefore remain fully usable while hosting is unavailable. The UI must identify upstream unavailability without presenting a successful TokenURI or requesting repeated payment.

## Goals

- Use one metadata schema and one validator for single and batch generation.
- Produce marketplace-friendly JSON compatible with the ERC-721 metadata core and common Metaplex fields.
- Make the default batch flow usable without NFT expertise.
- Preserve advanced per-item traits when matching JSON files already exist.
- Allow optional CSV import without making CSV mandatory.
- Export one JSON file or a ZIP of matching JSON files entirely in the browser.
- Host single or batch JSON on Shelby under the connected wallet's native or derived Aptos storage address.
- Route all hosting charges through the configured Vessel settlement contract or program.
- Keep JSON generation available when Shelby hosting is paused.

## Non-goals

- Minting NFTs on Aptos, Solana, or EVM chains.
- Deploying an NFT collection contract.
- Computing rarity rankings.
- Editing images or generating artwork.
- Hosting through the legacy server-managed metadata write path.
- Guaranteeing that a future URI resolves before its referenced image and JSON are successfully registered and written.

## Canonical Metadata Schema

Every generated item uses this shape:

```json
{
  "name": "Vessel Genesis #001",
  "description": "A wallet-owned NFT stored through Vessel.",
  "image": "https://storage.example/001.png",
  "external_url": "https://vessel-sage.vercel.app",
  "attributes": [
    {
      "trait_type": "Background",
      "value": "Nebula"
    }
  ],
  "properties": {
    "files": [
      {
        "uri": "https://storage.example/001.png",
        "type": "image/png"
      }
    ],
    "category": "image"
  }
}
```

Rules:

- `name`, `description`, and `image` are required non-empty strings.
- `external_url` is optional and must be an absolute `https`, `ipfs`, or `ar` URI when present.
- `attributes` is always an array. Each entry requires a non-empty `trait_type` and a string or finite numeric `value`.
- `properties.files` contains the primary image with the same URI as `image` and its detected MIME type.
- `properties.category` is derived from the primary media type. The initial release generates image NFT metadata, so the value is `image`.
- Unknown safe fields from an imported matching JSON file may be retained only under an explicit advanced option. Required canonical fields always win.
- JSON serialization uses UTF-8, two-space indentation, stable field ordering, and a trailing newline.

## Shared Architecture

The feature is divided into small modules:

1. `metadata-schema`: canonical model construction, normalization, validation, and stable serialization.
2. `metadata-source-mapper`: matches images, optional JSON files, and optional CSV rows by normalized relative path or filename stem.
3. `metadata-uri`: resolves authoritative Gallery URLs, future Vessel URLs, or a custom base URI.
4. `metadata-batch`: creates item plans, tracks validation results, and produces deterministic output filenames.
5. `metadata-export`: downloads one JSON file or creates a ZIP containing all valid JSON files and an error report when needed.
6. `wallet-owned-upload`: a reusable coordinator extracted from the current upload page so media and metadata use the same quote, settlement, recovery, and Shelby write path.

The page controller renders state and delegates all schema, mapping, export, and upload behavior to these modules.

## Single NFT Experience

The default `Single NFT` tab keeps the existing Gallery selection flow and image preview.

The form contains:

- Name
- Description
- External URL, optional
- Trait rows with `Trait type`, `Value`, add, and remove controls
- Storage duration for hosting

Vessel automatically fills `image`, `properties.files[0].uri`, MIME type, and category from the selected Gallery artifact. The live preview shows the complete canonical JSON.

Primary actions:

- `Download JSON`: always available after local validation.
- `Host TokenURI on Shelby`: available only with a ready wallet, an available source image, and an operational hosting path.

Hosting converts the serialized JSON into an `application/json` `File` and passes it to the wallet-owned upload coordinator. A successful result displays the authoritative Shelby URL as the TokenURI and records it in the wallet-scoped Gallery ledger.

## Batch Collection Experience

The `Batch Collection` tab is a guided four-step flow:

1. Select a collection folder.
2. Confirm collection defaults.
3. Review mapping and validation.
4. Export or host.

### Folder Input

The existing Directory Picker pattern recursively reads:

- Supported image files.
- Optional JSON files with matching filename stems.
- One optional CSV mapping file selected separately in Advanced settings.

Beta limits are 1 GB total selected media and 3,000 image items. The UI states that mainnet limits will be higher. System folders, hidden operating-system files, empty files, and unsupported media are skipped with a visible report.

### Smart Defaults

Required user inputs are limited to:

- Collection name prefix, for example `Vessel Genesis`.
- Shared description.
- Image URI mode.

Optional inputs are:

- External URL.
- Shared traits.
- Start number, default `1`.
- Existing JSON import.
- CSV import.

When no item-specific name exists, Vessel generates zero-padded names such as `Vessel Genesis #001`. Output JSON filenames preserve the image stem, so `images/001.png` maps to `metadata/001.json`.

### Existing JSON and CSV

Matching JSON files are optional. When present, Vessel imports `name`, `description`, `external_url`, and `attributes`, then normalizes the result to the canonical schema. The current image mapping replaces stale `image` and `properties.files` values.

CSV is an Advanced option for large collections. The first column identifies the image using its relative path or filename. Reserved columns are `name`, `description`, and `external_url`. Columns prefixed with `trait:` become attributes, for example `trait:Background`.

Precedence from highest to lowest is CSV item values, matching JSON item values, and collection defaults. Image URI, MIME type, and category are always derived by Vessel.

### Review

The review screen shows:

- Total images, matched JSON files, unmatched files, warnings, and errors.
- A searchable item table with relative path, generated name, image URI, trait count, and status.
- Full JSON preview for the selected item.
- A sample visual preview for the first valid image.

Generation is blocked only for items with errors. Warnings do not block export. Hosting requires every selected item to be valid.

### Export

`Download Metadata ZIP` creates a browser-side ZIP with this structure:

```text
metadata/
  001.json
  002.json
  003.json
metadata-report.json
```

The report contains counts and warnings but no wallet signatures, API keys, paid authorizations, or local absolute paths.

## Image URI Modes

### Authoritative Gallery URL

Single metadata uses the selected wallet-owned artifact URL already returned by Vessel.

### Automatic Vessel URI

For local batch images, the default mode computes the content-addressed blob name from SHA-256 and file extension, then builds the future public read URL under the connected storage address. The UI labels these URLs as pending until the matching image upload is active on Shelby.

Automatic Vessel URI mode requires a ready wallet session. Wallet changes invalidate the generated plans and require URI regeneration.

### Custom Base URI

Advanced users may enter an `https`, `ipfs`, or `ar` base URI. Vessel appends each normalized relative image path with URL-safe encoding. The preview displays the exact resolved URI before export.

## Wallet-owned Shelby Hosting

The first-party UI must not call the legacy `/api/metadata` server-managed write path for hosting.

For a single JSON file:

1. Serialize and hash the canonical JSON.
2. Request a wallet-bound quote using the chosen retention.
3. Validate the signed quote immediately before submission.
4. Settle the Vessel fee through the chain-specific contract or program.
5. Register and write the JSON under the user's storage address.
6. Verify the receipt and return the authoritative TokenURI.

For a batch:

- The chosen retention applies to every JSON file.
- Files run sequentially through the existing retryable queue.
- Every JSON receives its own immutable quote binding and contract receipt because the current settlement contracts bind one blob per receipt.
- Before hosting starts, Vessel shows the item count, the expected number of wallet approvals, and an aggregate estimate. Each JSON remains subject to the configured 2% Vessel fee and $0.01 minimum, while the exact signed quote is refreshed per item.
- Successful items are never repeated.
- A pending receipt pauses the queue and stores recovery state without requesting another payment.
- A rejected approval or upstream failure leaves later files queued.
- The UI explains that beta wallets may request approval per file.

The design does not silently fall back to app-owned storage when a wallet-owned upload cannot proceed.

## Shelby Hosting Pause

Generation and export do not depend on Shelby health.

When Shelby rejects new registrations or uploads:

- Vessel preserves generated JSON and validation state in the current tab.
- The hosting flow stops at the failing item.
- A submitted settlement receipt remains recoverable and is never charged again.
- The message distinguishes upstream hosting unavailability from invalid metadata.
- The user can download the JSON or ZIP and retry hosting when Shelby resumes.
- Vessel does not present a TokenURI until the JSON blob is confirmed active.

## State, Recovery, and Privacy

- Raw selected files remain in browser memory and are not persisted.
- Draft form fields and metadata plans may be stored in session storage, excluding file bytes and wallet authorization material.
- Refreshing requires the user to reselect local files.
- Existing upload recovery records remain wallet scoped and expire after 24 hours.
- Imported JSON and CSV content is parsed locally.
- JSON generation never requires a wallet signature.
- Wallet signatures, seed phrases, API keys, and paid authorizations never appear in exported metadata or reports.

## Error Handling

The UI reports errors at item and collection levels:

- Duplicate normalized image paths or output filenames.
- Missing image URI.
- Invalid or unsupported URI scheme.
- Empty required fields.
- Invalid attribute rows.
- Malformed matching JSON.
- Ambiguous JSON or CSV mapping.
- Unsupported or empty files.
- Exceeded 1 GB or 3,000-item beta limit.
- Wallet or storage-address changes after URI generation.
- Quote expiration or price drift.
- Settlement receipt pending.
- Shelby registration or write unavailable.

Errors use in-page status regions. Browser alerts and confirmation dialogs are not used.

## Accessibility and Visual Requirements

- The two modes use real tabs with keyboard navigation and clear selected state.
- Every form control has a visible label and inline validation message.
- Trait controls meet the 44px minimum target size.
- Batch progress is conveyed with text and a progress element, not color alone.
- JSON previews remain readable at mobile widths and use the existing Vessel contrast palette.
- Motion respects reduced-motion preferences.

## Legacy Migration

- The current single metadata UI moves to the shared canonical schema.
- The first-party UI stops using `/api/metadata` for server-managed hosting.
- The legacy endpoint must be removed, disabled, or restricted so production cannot create app-owned metadata blobs accidentally.
- Existing TokenURI links already stored on Shelby remain readable until their testnet expiration.

## Test Strategy

Unit tests cover:

- Schema normalization, validation, stable ordering, and serialization.
- MIME and category derivation.
- Deterministic name and filename generation.
- Folder, JSON, and CSV mapping precedence.
- URI resolution and encoding.
- ZIP manifest contents.
- Wallet identity invalidation.

Integration tests cover:

- Single Gallery artifact to canonical JSON preview and download.
- Single JSON through wallet-owned quote, settlement, registration, and TokenURI result.
- Folder with images only to generated ZIP.
- Folder with matching JSON to normalized per-item traits.
- Optional CSV overrides.
- Batch hosting pauses and resumes without repeating successful payments.
- Shelby hosting rejection leaves local export available.
- The first-party UI contains no call to the legacy server-managed metadata hosting route.

Browser verification covers Chromium folder selection, mobile layout, keyboard navigation, download behavior, wallet approval transitions, recovery, and readable error states.

## Acceptance Criteria

- Single and batch outputs use the same canonical schema.
- A non-expert can create a valid batch ZIP by selecting a folder and entering only a collection name and description.
- Imported JSON and optional CSV traits are normalized deterministically.
- Every valid item has matching `image` and `properties.files[0].uri` values.
- Local generation and export work while Shelby upload is paused.
- Hosting uses the connected wallet's storage address and settlement-contract receipt.
- No first-party hosting path writes metadata with only Vessel's server credentials.
- A paid or submitted item is recoverable without duplicate payment.
- No browser-native alert or confirm UI is used.
