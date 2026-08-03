# Batch Folder Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a connected Aptos or Solana user select a folder of assets up to 1 GB and upload its files sequentially through the existing wallet-owned Vessel settlement flow.

**Architecture:** A pure browser module owns file validation, relative-path preservation, aggregate progress, and retryable queue state. The upload page renders that state and invokes the existing single-file quote, settlement, recovery, and Shelby upload pipeline once per queued file. Each file keeps its own signed quote and contract receipt because the current quote contract binds one file hash.

**Tech Stack:** Vanilla ES modules, Tailwind utility classes, Node test runner, existing Vessel wallet and settlement clients.

## Global Constraints

- Batch metadata is excluded.
- Total selected size is at most 1,073,741,824 bytes.
- Each file must satisfy the server-provided per-file upload limit, currently 25 MB.
- Empty files and unsupported file types are rejected before payment.
- One retention duration applies to the whole batch.
- Files upload sequentially. Successful files are never repeated when retrying failures.
- Wallet and contract signatures remain per file.

---

### Task 1: Batch queue model

**Files:**
- Create: `app/server/public/batch-upload.js`
- Create: `app/server/test/batch-upload.test.js`

**Interfaces:**
- Produces: `createBatchQueue(files, options)`, returning a queue with `items`, `totalBytes`, `summary()`, `next()`, `markUploading(id)`, `markSucceeded(id, result)`, `markFailed(id, error)`, and `retryFailed()`.
- Produces: `batchRelativePath(file)` and constants `BATCH_MAX_BYTES`, `BATCH_SUPPORTED_TYPES`.

- [ ] Write tests proving relative paths are retained, unsupported and empty files are rejected, total size over 1 GB is rejected, state transitions update aggregate byte progress, and retry resets only failed files.
- [ ] Run `node --test test/batch-upload.test.js` from `app/server` and confirm the module-not-found failure.
- [ ] Implement the minimum pure queue module.
- [ ] Run `node --test test/batch-upload.test.js` and confirm all focused tests pass.

### Task 2: Folder picker and batch status UI

**Files:**
- Modify: `app/server/public/upload.html`
- Modify: `app/server/test/upload.test.js`

**Interfaces:**
- Consumes: folder input `#folder-input` with `webkitdirectory` and `multiple`.
- Produces: `#batch-summary`, `#batch-file-count`, `#batch-total-size`, `#batch-status`, `#batch-progress`, `#batch-current-file`, `#batch-results`, `#batch-retry`, and `#batch-reset`.

- [ ] Extend the upload HTML test with the exact folder input, accessible live status, progress element, beta 1 GB message, and explicit per-file wallet approval copy.
- [ ] Run `node --test test/upload.test.js` and confirm the new assertions fail.
- [ ] Add the folder picker and responsive batch summary without removing the single-file picker.
- [ ] Run `node --test test/upload.test.js` and confirm the focused test passes.

### Task 3: Sequential orchestration

**Files:**
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/ledger.js`
- Modify: `app/server/test/upload.test.js`
- Modify: `app/server/test/ledger-and-gallery.test.js`

**Interfaces:**
- Consumes: `createBatchQueue` from `batch-upload.js`.
- Produces: a sequential batch runner that requests and validates a fresh quote immediately before each file, invokes the existing `doUpload` path, records `sourcePath`, pauses on wallet rejection or recovery-required failures, and exposes retry/reset actions.

- [ ] Add failing source-contract tests for folder selection, sequential awaiting, per-file quote timing, result recording, retry, and source-path persistence.
- [ ] Run the focused upload and ledger tests and confirm the new assertions fail.
- [ ] Refactor `doUpload` to return a structured result or throw while preserving existing single-file UI and recovery behavior.
- [ ] Implement the batch runner and compact result rendering.
- [ ] Run the focused tests and confirm they pass.

### Task 4: Verification and release

**Files:**
- Review all changed files.

- [ ] Run `npm test` from `app/server`.
- [ ] Run `npm run build:client` from `app/server`.
- [ ] Inspect the upload page in Chrome at desktop and mobile widths, including keyboard focus and empty/error states.
- [ ] Review `git diff --check` and confirm no secrets or unrelated user changes are staged.
- [ ] Commit, push `main`, deploy to Vercel production, and verify the production folder picker and 1 GB beta notice.
