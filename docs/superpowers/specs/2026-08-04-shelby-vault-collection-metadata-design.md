# Shelby Vault Collection Metadata Design

**Date:** 2026-08-04
**Status:** Approved

## Objective

Batch metadata must use a collection that the connected wallet has already uploaded to Shelby. The Metadata page must not ask the user to select the artwork folder from the computer again.

Single NFT metadata remains unchanged.

## Source of Truth

Shelby stores the uploaded files as content-addressed blobs such as `media/<sha256>.png`. It does not preserve a browsable directory hierarchy in the blob name. Vessel already records each batch item's original `sourcePath` in the local wallet-owned Vault ledger.

The Batch Collection source is therefore the intersection of:

1. Local Vault records that contain an original `sourcePath`.
2. Remote Shelby artifacts owned by the connected storage address.
3. Active, written, non-deleted image blobs that have not expired.

Remote reconciliation proves that the blob still exists on Shelby. The local `sourcePath` restores the collection name, original filename, and relative order needed for deterministic metadata generation.

When the public Shelby API/indexer is explicitly paused and `SHELBY_WRITES_ENABLED=false`, remote reconciliation is unavailable by design. In that state Vessel uses only unexpired records from the connected wallet's local Vault history, labels the source as browser-local history, and keeps JSON/ZIP generation available. It does not claim that the source blobs were freshly verified. Remote reconciliation resumes automatically when the write gate is enabled again.

## Collection Grouping

- The first segment of `sourcePath` is the collection identifier and display name.
- Items without a valid collection-relative `sourcePath` are excluded from Batch Collection, but remain available to Single NFT metadata.
- Only records belonging to the current wallet storage address are eligible.
- Duplicate blob keys are collapsed.
- Items are sorted by normalized relative path using numeric-aware ordering.
- A collection card shows its name, active image count, total size, and earliest expiry.

## User Interface

The existing `Select collection folder` control and hidden directory input are removed.

Batch Collection begins with a `Select a Shelby collection` section:

- A loading state appears while Vessel reconciles the Vault with Shelby.
- Available collections are shown as selectable cards or rows.
- Selecting a collection immediately builds the metadata plan from its active Shelby image URLs.
- The selected collection remains visibly identified while defaults, traits, preview, local ZIP export, and Shelby JSON hosting are used.
- If no eligible collection exists, the empty state links to Upload and explains that the user must first upload a folder as a batch.
- A refresh action re-reads the connected wallet's Shelby artifacts.

An optional CSV file remains available only as a metadata override. It is not an artwork source and does not upload or replace images.

## Metadata Mapping

Each selected Shelby artifact is adapted to the existing batch metadata builder with:

- `sourcePath`: the original path recorded during batch upload.
- `name`: the original filename derived from `sourcePath`.
- `type`: the reconciled image MIME type.
- `size`: the reconciled Shelby blob size.
- `image`: the active wallet-owned Shelby read URL.

Automatic Vessel URI mode uses the artifact's existing Shelby URL directly. It must never hash a new local file or create a pending image URI. Custom base URI mode remains available and replaces only the image URI base while preserving the original relative path.

Generated single and batch JSON continue to use the canonical cross-chain NFT schema already implemented by Vessel.

## Wallet and State Changes

- Connecting or switching wallets clears the selected collection and reloads eligible collections for the new storage address.
- Disconnecting clears all Batch Collection source data.
- Refreshing the Vault invalidates a selected collection if any required source blob is no longer active.
- Local JSON and ZIP generation remain available when Shelby writes are paused.
- `Host Collection on Shelby` remains disabled while `SHELBY_WRITES_ENABLED` is false.

## Failure Handling

- Remote listing failure while Shelby is enabled: show a retryable in-page error without falling back to the computer directory picker.
- Explicit Shelby pause: show browser-local Vault collections with a visible paused/unverified notice and keep hosting disabled.
- No matching local path metadata: explain that older raw blobs cannot be reconstructed into a folder automatically.
- Expired, deleted, or unwritten blob: exclude it and report the skipped count.
- Collection becomes incomplete during refresh: stop hosting and require the user to review the rebuilt plan.
- CSV refers to a missing source path: keep the existing validation warning behavior.

## Component Boundaries

1. `vault-collections.js` groups reconciled artifacts into deterministic collection models.
2. `app.js` loads and reconciles wallet-owned Shelby artifacts, then passes collection models to the Metadata page.
3. `metadata-page.js` renders collection selection and adapts selected remote artifacts to the existing metadata batch builder.
4. `metadata-batch.js`, `metadata-schema.js`, `metadata-export.js`, and the wallet-owned JSON hosting service retain their current responsibilities.

## Verification

- Unit tests cover wallet scoping, remote reconciliation, grouping, sorting, expiry filtering, duplicates, and malformed paths.
- Metadata page tests prove that no directory picker exists and that selecting a Shelby collection builds canonical JSON with existing Shelby image URLs.
- Tests prove wallet switching clears the old selection and refresh failures are retryable.
- Existing schema, ZIP export, quote, receipt, hosting queue, and full server suites remain green.
- Chrome verification confirms collection selection, preview, CSV override, ZIP download, paused hosting state, responsive layout, and accessible keyboard interaction on production.

## Explicit Limitation

Collections uploaded before Vessel recorded `sourcePath` cannot be reconstructed reliably from Shelby's content-addressed blob names alone. A future Shelby-hosted collection manifest can make collection discovery portable across browsers. That manifest is outside this focused correction.
