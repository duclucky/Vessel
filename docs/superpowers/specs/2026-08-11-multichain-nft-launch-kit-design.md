# Multichain NFT Launch Kit Design

**Date:** 2026-08-11
**Status:** Approved for spec review

## Objective

Vessel should become a practical NFT launch preparation workspace for assets already uploaded to Shelby. The Launch Kit turns a wallet-scoped Shelby Vault collection into a chain-specific handoff package that creators, developers, or reviewers can use when minting or listing NFTs elsewhere.

The feature must not mint NFTs, deploy NFT contracts, call marketplace APIs, or claim permanent storage. It prepares validated media URLs, metadata URLs, collection-level metadata, chain-specific mapping files, and a clear launch checklist from data that already exists in Vessel.

## Product Positioning

The Launch Kit answers the creator question: "I uploaded my NFT media and metadata to Shelby. What do I give my contract, marketplace, or minting engineer next?"

The answer should be a clean package:

- Media URLs hosted through the active Shelby runtime.
- Hosted TokenURI JSON URLs when available.
- Collection-level metadata for marketplace pages.
- Chain-specific CSV handoff files.
- A validation report that explains what is ready and what needs attention.
- A human-readable launch checklist.

This makes Vessel useful after upload, without expanding into minting. It also highlights Shelby's role: wallet-owned hot storage becomes the media and metadata layer behind NFT launches on Aptos, Solana, and Ethereum.

## Standards Baseline

Vessel should use one internal collection model and export chain-specific views from it.

Reference sources used for this design:

- OpenSea metadata standards: `https://docs.opensea.io/docs/metadata-standards`
- OpenSea contract-level metadata: `https://docs.opensea.io/docs/contract-level-metadata`
- ERC-1155 metadata URI schema and `{id}` substitution: `https://eips.ethereum.org/EIPS/eip-1155`
- ERC-4906 metadata update event: `https://eips.ethereum.org/EIPS/eip-4906`
- Metaplex Token Metadata overview: `https://www.metaplex.com/docs/smart-contracts/token-metadata`
- Metaplex Core JSON schema: `https://www.metaplex.com/docs/smart-contracts/core/json-schema`
- Aptos Digital Asset standard: `https://aptos.dev/build/smart-contracts/digital-asset`
- Shelby account and blob naming model: `https://docs.shelby.xyz/protocol/architecture/overview`

Important implications:

- OpenSea reads token metadata from ERC-721 `tokenURI(tokenId)` or ERC-1155 `uri(id)`.
- OpenSea contract-level metadata is separate from token metadata and is returned through `contractURI()`.
- ERC-1155 clients replace `{id}` with a lowercase, 64-character, zero-padded hex token ID.
- Metaplex assets point to an off-chain JSON URI. Metaplex Core keeps some fields on chain or in plugins, but the off-chain JSON remains useful for media, description, category, and attributes.
- Aptos Digital Asset collections and tokens each have names, descriptions, and URI fields, with collection names unique under a creator account.
- Shelby has no real directories. Folder-like collection structure is expressed through blob names and Vessel's Vault metadata.

## Scope

### In scope

The Launch Kit will support:

1. Selecting a wallet-scoped Vault collection that already exists in Vessel.
2. Building a collection launch profile.
3. Selecting chain output targets:
   - Ethereum ERC-721
   - Ethereum ERC-1155
   - Solana Metaplex Core
   - Solana Token Metadata legacy handoff
   - Aptos Digital Asset
4. Validating media, metadata, IDs, names, expiration, and chain constraints.
5. Exporting chain-specific files and a checklist.
6. Showing a preview of each generated output before export.

### Out of scope

The Launch Kit will not:

- Mint NFTs.
- Deploy ERC-721, ERC-1155, Solana, or Aptos NFT contracts.
- Create collections on chain.
- Submit marketplace listings.
- Call OpenSea, Magic Eden, Tensor, Rarible, or Aptos marketplace APIs.
- Refresh marketplace metadata.
- Encrypt Shelby media.
- Re-upload media as part of launch preparation.
- Promise permanent storage or production SLA.

## User Flow

### 1. Open Launch Kit

The user navigates to a new `Launch Kit` entry from Gallery and Metadata.

The page starts with a source selector:

- Connected wallet status.
- Active storage identity.
- Available Vault collections.
- Collection item count.
- Earliest expiration date.
- Whether each collection was confirmed from Shelby or restored from browser-local Vault cache.

If no collection is available, show a clear empty state:

> No launch-ready collection yet. Upload a folder first, then return here to generate chain handoff files.

### 2. Select Collection

When a collection is selected, Vessel loads:

- Media artifacts.
- Source paths.
- Hosted TokenURI metadata artifacts, if already generated.
- Existing collection manifest relationships.
- Expiration and fee evidence already stored in the ledger.

The Launch Kit should not ask for a local folder.

### 3. Build Launch Profile

The user fills a collection profile:

- Collection name.
- Symbol.
- Description.
- Creator wallet.
- Royalty percent.
- External website.
- Avatar image URL.
- Banner image URL.
- Featured image URL.
- Token ID start.
- Optional base external URL.

Image fields should allow choosing from uploaded media in the selected collection or pasting a valid HTTPS URL.

The default token ID start is `1`.

### 4. Generate Chain Outputs

Vessel generates previews for each selected chain target:

- ERC-721 tokenURI mapping.
- ERC-1155 URI mapping.
- Solana Metaplex Core asset handoff.
- Solana Token Metadata legacy handoff.
- Aptos Digital Asset handoff.
- OpenSea `contractURI.json`.

Each preview should show a short sample and the number of rows or objects generated.

### 5. Validate

Before export, Vessel runs a launch readiness validator.

Validation produces:

- Blocking errors.
- Warnings.
- Informational notes.

Blocking errors disable export for affected outputs. Warnings allow export but must be visible in the report.

### 6. Export

The user can export:

- A full launch package ZIP.
- Individual chain CSV files.
- `contractURI.json`.
- `collection-manifest.json`.
- `launch-checklist.md`.
- `validation-report.xlsx`.

The full ZIP is preferred for a demo because it shows that Vessel can package the whole NFT launch handoff.

## Data Model

### Launch Profile

```ts
type LaunchProfile = {
  collectionId: string;
  collectionName: string;
  symbol: string;
  description: string;
  creatorWallet: string;
  royaltyPercent: number | null;
  externalLink: string;
  avatarImageUrl: string;
  bannerImageUrl: string;
  featuredImageUrl: string;
  tokenIdStart: number;
  targets: {
    evmErc721: boolean;
    evmErc1155: boolean;
    solanaCore: boolean;
    solanaTokenMetadata: boolean;
    aptosDigitalAsset: boolean;
  };
};
```

### Launch Item

```ts
type LaunchItem = {
  index: number;
  tokenId: number;
  tokenIdHex64: string;
  sourcePath: string;
  displayName: string;
  mediaUrl: string;
  tokenUri: string;
  metadataKey: string;
  contentType: string;
  sizeBytes: number;
  expiresAt: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
    display_type?: 'number' | 'date' | 'boost_number' | 'boost_percentage';
    max_value?: number;
  }>;
};
```

### Launch Package Manifest

```ts
type LaunchPackageManifest = {
  version: 1;
  generatedAt: string;
  vesselOrigin: string;
  storageRuntime: 'shelbynet' | 'testnet';
  storageAddress: string;
  collection: {
    id: string;
    name: string;
    symbol: string;
    description: string;
    itemCount: number;
    earliestExpiry: string;
    verification: 'shelby' | 'vault-cache';
  };
  targets: string[];
  outputs: Array<{
    kind: string;
    path: string;
    rowCount?: number;
    valid: boolean;
  }>;
};
```

## Chain Output Formats

### OpenSea contractURI

Output path: `opensea/contractURI.json`

Fields:

- `name`
- `description`
- `image`
- `banner_image`
- `featured_image`
- `external_link`

Do not include collaborator addresses unless the user explicitly provides them later. The first version should keep this file simple and marketplace-safe.

### Ethereum ERC-721

Output path: `evm/erc721-tokenuris.csv`

Columns:

- `token_id`
- `name`
- `token_uri`
- `media_url`
- `source_path`
- `metadata_status`
- `expires_at`

Assumption: the downstream ERC-721 contract will expose `tokenURI(tokenId)` and map each row's `token_id` to `token_uri`.

### Ethereum ERC-1155

Output path: `evm/erc1155-tokenuris.csv`

Columns:

- `token_id_decimal`
- `token_id_hex64`
- `uri`
- `uri_template_example`
- `name`
- `media_url`
- `source_path`
- `metadata_status`
- `expires_at`

Rules:

- `token_id_hex64` must be lowercase and zero-padded to 64 characters.
- If a base URI template is shown, it should use `{id}.json`.
- The generated per-token URI should still be explicit so non-technical users can verify it.

### Solana Metaplex Core

Output path: `solana/metaplex-core-assets.csv`

Columns:

- `asset_name`
- `collection_name`
- `uri`
- `image`
- `category`
- `external_url`
- `royalty_percent`
- `source_path`
- `expires_at`

Notes:

- This is a handoff file, not a transaction builder.
- Core-specific plugins such as royalties or verified creators are mentioned in the checklist, not encoded as fake JSON fields.

### Solana Token Metadata Legacy

Output path: `solana/token-metadata-assets.csv`

Columns:

- `name`
- `symbol`
- `uri`
- `seller_fee_basis_points`
- `collection_name`
- `image`
- `source_path`
- `expires_at`

Rules:

- `seller_fee_basis_points` is derived from `royaltyPercent * 100`.
- If royalty is blank, leave seller fee blank and emit a warning.
- This output exists because legacy Metaplex Token Metadata is still common, even though Metaplex recommends Core for new projects.

### Aptos Digital Asset

Output path: `aptos/digital-asset-tokens.csv`

Columns:

- `collection_name`
- `collection_description`
- `collection_uri`
- `token_name`
- `token_description`
- `token_uri`
- `creator_wallet`
- `source_path`
- `expires_at`

Rules:

- `collection_uri` should point to the hosted collection profile or `contractURI.json` equivalent when available.
- `token_uri` points to the hosted NFT metadata JSON.
- Warn if collection name or token names are very long. Aptos docs document URI and description length constraints; the first version should enforce conservative limits and surface warnings.

## Validation Rules

### Blocking errors

Export for a target is blocked when:

- No collection is selected.
- The selected collection has zero media items.
- A media item has no usable media URL.
- A required TokenURI is missing for an output that needs hosted metadata.
- A metadata JSON URL is not HTTPS, `ipfs://`, or `ar://`.
- A media URL is not HTTPS, `ipfs://`, or `ar://`.
- Token IDs collide.
- Token names collide within Aptos Digital Asset output.
- ERC-1155 hex ID cannot be generated.
- `contractURI.json` has no name, description, or image.

### Warnings

Export remains available when:

- Shelby expiration is under 7 days.
- The collection was reconstructed from browser-local Vault cache instead of a fresh remote Shelby list.
- Some items have no attributes.
- Royalty percent is blank.
- Royalty percent is greater than 10%.
- Description is short.
- Media file is large.
- File extension and content type do not clearly match.
- The metadata includes Vessel proof fields that some marketplaces may ignore.

### Informational notes

Show notes for:

- ShelbyNet is a testnet beta and can be wiped.
- Vessel prepares launch data but does not mint.
- A marketplace may cache metadata and require refresh after changes.
- ERC-4906 can be useful for EVM contracts that intentionally update metadata after mint.

## UI Design

The page should follow the existing Vessel visual system:

- Dark technical surface.
- Compact neon-accent status chips.
- Large display headings.
- Rounded Vessel panels.
- No new visual language.

Layout:

1. Header
   - Title: `Launch Kit`
   - Copy: `Prepare chain-specific NFT handoff files from a Shelby Vault collection.`
2. Source panel
   - Connected wallet.
   - Storage identity.
   - Collection selector.
   - Item count and earliest expiration.
3. Launch profile panel
   - Collection fields.
   - Image selectors.
   - Token ID start.
4. Target panel
   - Toggle cards for ERC-721, ERC-1155, Metaplex Core, Token Metadata, Aptos DA.
5. Validation panel
   - Errors, warnings, notes.
6. Output panel
   - Per-target previews.
   - Download full package.
   - Download individual files.

All field labels that are not obvious should include help tooltips, following the existing metadata tooltip pattern.

## File Generation

The full ZIP should use this structure:

```text
vessel-launch-kit/
  manifest.json
  launch-checklist.md
  validation-report.xlsx
  opensea/
    contractURI.json
  evm/
    erc721-tokenuris.csv
    erc1155-tokenuris.csv
  solana/
    metaplex-core-assets.csv
    token-metadata-assets.csv
  aptos/
    digital-asset-tokens.csv
```

CSV files should be plain CSV for compatibility. The richer presentation layer belongs in `validation-report.xlsx`, because CSV does not reliably preserve colors, fonts, widths, or formatting across spreadsheet programs.

## Error Handling

- If the wallet disconnects, clear collection-specific previews and show the standard wallet-required state.
- If the collection expires during the session, rerun validation and show the expired item list.
- If a URL probe fails, mark the item with a warning unless the output strictly requires a live URL.
- If ZIP generation fails, keep individual downloads available when possible.
- If one chain output has blocking errors, other valid outputs remain exportable.

## Privacy and Security

- Do not include private keys, API keys, wallet signatures, recovery secrets, or raw authorization payloads in exports.
- Public wallet addresses, transaction IDs, proof URLs, media URLs, and TokenURIs are allowed because they are already user-facing evidence.
- If exporting browser-local Vault cache data, label it as browser-local and not freshly reconciled from Shelby.
- Never imply encrypted media unless encryption is actually implemented.

## Testing Plan

Add tests for:

- Launch page shell, navigation, tooltips, and empty states.
- Collection selection from wallet-scoped Vault history.
- Launch profile validation.
- ERC-721 CSV generation.
- ERC-1155 decimal to 64-character hex mapping.
- Solana Metaplex Core CSV generation.
- Solana Token Metadata seller fee basis point conversion.
- Aptos Digital Asset CSV generation and duplicate token name handling.
- `contractURI.json` generation.
- Validation report classification: error, warning, note.
- ZIP structure and redaction.
- Wallet privacy: no disconnected Vault data visible.
- No minting, deployment, or marketplace API claims in UI copy.

Manual smoke tests:

1. Connect Petra on ShelbyNet.
2. Select an existing collection from Gallery/Vault.
3. Generate Launch Kit outputs for all targets.
4. Verify previews show row counts and sample rows.
5. Download the full package.
6. Inspect ZIP contents and confirm no secrets.
7. Open `contractURI.json`.
8. Open at least one TokenURI.
9. Confirm expired or cache-only data is clearly labeled.

## Rollout Plan

Implementation should be staged:

1. Pure model and export generators with tests.
2. Launch Kit page shell and navigation.
3. Vault collection adapter and Launch Profile form.
4. Validation engine.
5. Output previews and individual downloads.
6. ZIP package export.
7. Manual Chrome smoke test on production after deployment.

## Acceptance Criteria

- User can select a Shelby Vault collection without choosing a local folder.
- User can enter a Launch Profile once and generate all selected chain outputs.
- ERC-721, ERC-1155, Solana Core, Solana Token Metadata, Aptos DA, and OpenSea contract-level outputs are available.
- ERC-1155 IDs include decimal and 64-character padded hex forms.
- The feature blocks export only for outputs with real errors and still allows valid outputs.
- The exported package includes no secrets.
- The UI clearly states that Vessel prepares launch data and does not mint NFTs.
- The UI clearly states that ShelbyNet storage is testnet beta and can expire or be wiped.
- Automated tests cover the generator, validator, page hooks, and export structure.
