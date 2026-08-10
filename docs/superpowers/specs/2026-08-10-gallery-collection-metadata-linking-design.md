# Gallery Collection Metadata Linking Design

## Objective

Make hosted batch NFT metadata appear inside its source Gallery folder without re-uploading media, re-hosting JSON, or requesting another payment. Existing collection manifests are the authoritative local mapping between each source image and its hosted TokenURI.

## Confirmed production behavior

- `VesselBatchTest` contains two Shelby media artifacts.
- Batch metadata hosting completed with two valid TokenURI JSON files.
- Both TokenURIs return marketplace-compatible JSON and their `image` fields resolve to the correct Shelby media.
- The public proof page resolves both Media URL and TokenURI.
- Gallery shows both metadata artifacts globally, but the open `VesselBatchTest` folder shows no metadata.

## Root cause

Single-item metadata hosting calls `attachTokenUriToArtifact`, which records `sourceArtifactKey` and `sourceArtifactUrl` on the metadata artifact. Batch hosting saves a collection manifest, but the uploaded JSON ledger records only retain their metadata path such as `1.json`. Gallery currently filters folder metadata only when `metadata.sourceArtifactKey` matches a media key in that folder.

The manifest already contains the missing relationship:

- collection id and owner storage address
- source media path and URL
- metadata path and TokenURI URL

The relationship is saved but not applied to Gallery artifacts.

## Selected design

### Manifest hydration

Add a pure ledger helper that hydrates artifact records from saved collection manifests. It receives artifact records and manifests and returns enriched artifact records without performing network requests.

For each manifest row, it will:

1. Require a canonical owner match between the manifest storage address and the artifact account or storage address.
2. Resolve the source media artifact by exact normalized media URL.
3. Resolve the hosted metadata artifact by exact normalized metadata or TokenURI URL.
4. Skip the row when either side is missing or ambiguous. Vessel must not guess ownership relationships.
5. Add the manifest collection id to both records.
6. Add `sourceArtifactKey` and `sourceArtifactUrl` to the metadata record.
7. Add `tokenUri` and `metadataUrl` to the source media record.

Exact existing non-empty relationships remain valid. A newer matching manifest may refresh the same relationship, but it cannot associate artifacts owned by another storage address.

### Historical compatibility

`loadMine()` will hydrate its parsed upload history with the saved manifests before returning it. This makes existing production data work immediately after deployment. Users do not need to host the JSON again.

`rememberCollectionManifest()` will continue to persist the manifest. The next ledger read returns the enriched view, so new batch metadata also appears immediately.

### Gallery behavior

`galleryCollectionId()` will prefer an explicit manifest-derived collection id before inferring a folder from `sourcePath`. Folder-scoped media and metadata queries will accept either:

- a matching explicit collection id, or
- the existing `sourceArtifactKey` relationship.

This keeps old single-metadata behavior working while making batch metadata visible in its collection. Folder-scoped XLSX export and proof actions use the same linked records.

### Approval messaging

Replace promises that a wallet popup will always appear with state-accurate copy:

- Vessel first asks the user to confirm the current quote in the page.
- A wallet signature is requested only when a fresh authorization is required.
- A recoverable or already-hosted item may continue without another wallet prompt or payment.

The cryptographic authorization rules and payment flow do not change in this work.

## Error handling and safety

- Invalid manifests remain ignored instead of corrupting upload history.
- Cross-wallet artifacts are never linked.
- Duplicate URL matches are treated as ambiguous and remain unlinked.
- No Shelby objects, local artifacts, receipts, or manifests are deleted.
- No new network call is added to Gallery startup.

## Tests

1. A failing ledger unit test reproduces the current historical state: two media records, two metadata records, and one saved manifest, with no source keys on metadata.
2. The hydrated result links each JSON to the correct image and collection.
3. Cross-wallet and ambiguous URL cases remain untouched.
4. Gallery tests verify that explicit collection ids participate in folder filtering and exports.
5. Metadata-page tests verify the new conditional approval copy.
6. Run the complete server test suite and client bundle build.
7. On production Chrome, verify that existing `VesselBatchTest` shows two media and two metadata records without re-hosting, TokenURI and proof links open, and fee totals do not increase.

## Non-goals

- Changing NFT metadata schema.
- Changing Shelby retention or pricing.
- Replacing the current batch payment architecture.
- Deleting or rewriting existing testnet data.
- Solving Chrome's automated Blob download restriction in the same change.
