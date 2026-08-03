# Metadata Source Preview and Validation Design

## Objective

Prevent VESSEL from generating NFT metadata that references an unavailable or ambiguous media URL. Metadata Atelier must show the selected image, identify an expired or missing source before submission, and store an absolute HTTPS image URL in every newly generated JSON object.

## Confirmed root cause

The Gallery records wallet-owned Shelby proxy URLs as relative paths such as `/api/shelby/blobs/<account>/<blob>`. Metadata Atelier forwards that value to `POST /api/metadata`. The route currently prefers the submitted value and writes it to JSON without normalization or availability validation. As a result, the API can return a valid TokenURI whose `image` value is relative and whose source returns 404.

## Approved behavior

1. Metadata Atelier renders the selected source image inside the existing selected-artifact card.
2. The preview reports a visible inline error when the source cannot load.
3. Generate TokenURI remains disabled until the selected image has loaded successfully.
4. The server converts trusted relative VESSEL media paths into absolute HTTPS URLs using the configured public base.
5. The server probes the trusted source before storing JSON and returns `metadata_source_unavailable` when the media is missing, expired, not an image, or unreadable.
6. Newly created JSON uses the normalized absolute image URL returned by the server.
7. Existing content-addressed TokenURIs are not mutated. Users must generate a new TokenURI from a live source after deployment.

## Security boundary

Metadata generation accepts only URLs on the configured VESSEL public origin and only paths below `/api/media/` or `/api/shelby/blobs/`. This prevents the availability probe from becoming a server-side request forgery primitive. The probe requests only the first byte with a Range header. The Shelby proxy forwards that bounded Range header upstream.

## Components

### Metadata source module

`app/server/src/lib/metadata-source.js` owns URL normalization, trusted-path validation, source probing, and typed errors. It receives `publicBase` and `fetchImpl` as dependencies so behavior can be tested without network access.

### Metadata API route

`POST /api/metadata` calls the source module before building or storing JSON. It never writes metadata after a failed source probe.

### Metadata Atelier UI

The selected-artifact card gains an image element, fallback icon, loading state, and inline alert. The UI uses image load and error events to control the Generate button. The JSON preview displays the absolute same-origin URL derived from `window.location.origin`.

### Shelby read proxy

The proxy forwards a syntactically valid incoming Range header to Shelby. This keeps the server-side availability probe bounded while preserving normal full-image reads.

## Error handling

- No selected artifact: keep the existing Browse Vault guidance.
- Loading source: show the preview skeleton and disable Generate.
- Missing or expired source: show `Source artifact is unavailable. Choose another artifact from your Vault.` and disable Generate.
- Invalid source URL: return HTTP 400 with `invalid_metadata_source`.
- Unavailable or non-image source: return HTTP 422 with `metadata_source_unavailable`.
- Metadata storage failure: preserve the existing error toast and do not show a result URI.

## Testing

- Unit tests prove relative URLs become absolute, untrusted origins and paths are rejected, live image responses pass, and 404 or non-image responses fail.
- UI regression tests prove the preview, alert, and disabled-state hooks exist and that load and error handlers gate generation.
- Route tests prove normalization and probing occur before `store.put` and that the proxy forwards Range.
- Full `npm test` and `npm run build:client` must pass.
- Production verification must create a new TokenURI from a newly uploaded live image, then confirm both the JSON URL and its absolute `image` URL return HTTP 200.

## Out of scope

- Rewriting existing content-addressed metadata JSON.
- Extending retention or renewing expired source artifacts.
- Batch Collection Upload.
- Changing wallet, payment, quote, or settlement logic.
