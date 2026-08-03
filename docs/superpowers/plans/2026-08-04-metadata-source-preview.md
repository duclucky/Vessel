# Metadata Source Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every newly generated VESSEL TokenURI references a visible, currently available image through an absolute HTTPS URL.

**Architecture:** A focused server module normalizes and validates trusted VESSEL media URLs before metadata storage. Metadata Atelier previews the selected image and gates submission on the image load state. The existing Shelby proxy forwards a one-byte Range probe so validation does not download the full artifact.

**Tech Stack:** Node.js 22, Express 4, Node test runner, browser JavaScript, Tailwind CSS, Shelby testnet HTTP read proxy.

## Global Constraints

- Preserve unrelated dirty worktree changes.
- Accept only the configured VESSEL public origin for metadata source validation.
- Accept only `/api/media/` and `/api/shelby/blobs/` source paths.
- Do not mutate existing content-addressed TokenURIs.
- Do not change wallet, quote, payment, settlement, or retention behavior.
- Use test-first RED, GREEN, REFACTOR cycles.

---

### Task 1: Trusted metadata source validation

**Files:**
- Create: `app/server/src/lib/metadata-source.js`
- Create: `app/server/test/metadata-source.test.js`

**Interfaces:**
- Produces: `resolveMetadataImageUrl({ imageUrl, imageKey, publicBase }) => string`
- Produces: `assertMetadataImageAvailable({ imageUrl, fetchImpl }) => Promise<void>`
- Produces: `MetadataSourceError` with `status` and `code`

- [ ] **Step 1: Write failing unit tests**

Create tests with these assertions:

```js
assert.equal(resolveMetadataImageUrl({
  imageUrl: '/api/shelby/blobs/0xabc/media/cover.png',
  publicBase: 'https://vessel.example',
}), 'https://vessel.example/api/shelby/blobs/0xabc/media/cover.png');

assert.throws(() => resolveMetadataImageUrl({
  imageUrl: 'https://attacker.example/private',
  publicBase: 'https://vessel.example',
}), (error) => error.code === 'invalid_metadata_source' && error.status === 400);

await assert.rejects(
  assertMetadataImageAvailable({
    imageUrl: 'https://vessel.example/api/media/missing.png',
    fetchImpl: async () => new Response('', { status: 404 }),
  }),
  (error) => error.code === 'metadata_source_unavailable' && error.status === 422,
);
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/metadata-source.test.js`

Expected: FAIL because `src/lib/metadata-source.js` does not exist.

- [ ] **Step 3: Implement the minimal module**

Implement the following public shape:

```js
export class MetadataSourceError extends Error {
  constructor(message, { status, code }) {
    super(message);
    this.name = 'MetadataSourceError';
    this.status = status;
    this.code = code;
  }
}

export function resolveMetadataImageUrl({ imageUrl, imageKey, publicBase }) {}

export async function assertMetadataImageAvailable({ imageUrl, fetchImpl = fetch }) {}
```

`resolveMetadataImageUrl` must use the platform `URL` class, require the configured origin, and allow only `/api/media/` or `/api/shelby/blobs/`. `assertMetadataImageAvailable` must issue a `Range: bytes=0-0` request and require both an OK response and an `image/*` content type.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/metadata-source.test.js`

Expected: all metadata source tests pass.

### Task 2: Server route enforcement and bounded Shelby probe

**Files:**
- Modify: `app/server/src/index.js:318-338,432-450`
- Test: `app/server/test/metadata-source.test.js`
- Test: `app/server/test/shelby-api-routes.test.js`

**Interfaces:**
- Consumes: `resolveMetadataImageUrl` and `assertMetadataImageAvailable`
- Produces: absolute `json.image` and a fail-closed `POST /api/metadata`

- [ ] **Step 1: Add failing route-order and Range-forwarding tests**

Add source-inspection assertions that require this order inside `POST /api/metadata`:

```js
const normalized = route.indexOf('resolveMetadataImageUrl');
const available = route.indexOf('assertMetadataImageAvailable', normalized);
const stored = route.indexOf('store.put', available);
assert.equal(normalized >= 0 && available > normalized && stored > available, true);
```

Require the proxy to copy only a valid byte range into the upstream headers and preserve `content-range` and `accept-ranges` response headers.

- [ ] **Step 2: Verify RED**

Run: `node --test test/metadata-source.test.js test/shelby-api-routes.test.js`

Expected: FAIL because the route does not use the helper and the proxy does not forward Range.

- [ ] **Step 3: Implement minimal route changes**

Import the helper and perform the validation before constructing `json`:

```js
const imageUrl = resolveMetadataImageUrl({
  imageUrl: imageUrlIn,
  imageKey,
  publicBase: config.publicBase,
});
await assertMetadataImageAvailable({ imageUrl });
const json = { name: name || '', description: description || '', image: imageUrl };
```

For the Shelby proxy, forward only a header matching `/^bytes=\d+-\d*$/`, set `res.status(upstream.status)`, and forward `content-range` and `accept-ranges` together with the existing safe response headers.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/metadata-source.test.js test/shelby-api-routes.test.js`

Expected: all focused server tests pass.

### Task 3: Metadata Atelier preview and generation gate

**Files:**
- Modify: `app/server/public/metadata.html:31-35,57-59`
- Modify: `app/server/public/app.js:1000-1030`
- Test: `app/server/test/latency-and-metadata.test.js`

**Interfaces:**
- Produces DOM hooks: `#meta-image-preview`, `#meta-image-fallback`, `#meta-image-status`
- Consumes the selected artifact URL from the ledger

- [ ] **Step 1: Add failing UI regression tests**

Require these HTML hooks:

```js
for (const id of ['meta-image-preview', 'meta-image-fallback', 'meta-image-status']) {
  assert.equal(ids.has(id), true, `missing #${id}`);
}
```

Require `app.js` to build `new URL(url, window.location.origin).href`, register `load` and `error` listeners on the preview, and set `gen.disabled` from source readiness.

- [ ] **Step 2: Verify RED**

Run: `node --test test/latency-and-metadata.test.js`

Expected: FAIL because the preview and gating hooks do not exist.

- [ ] **Step 3: Implement minimal accessible UI**

Replace the static selected-artifact icon with an `img#meta-image-preview` using `h-full w-full object-cover`, retain `#meta-image-fallback`, and add `#meta-image-status` with `role="status"` and `aria-live="polite"`. In `initMetadata`, normalize with:

```js
const imageUrl = url ? new URL(url, window.location.origin).href : '';
let sourceReady = false;
const setSourceState = (state) => {
  sourceReady = state === 'ready';
  gen.disabled = !sourceReady;
};
```

The load event sets `ready`; the error event hides the image, shows the fallback and inline error, and keeps Generate disabled. Use the absolute `imageUrl` in both JSON preview and API submission.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/latency-and-metadata.test.js`

Expected: all Metadata Atelier UI tests pass.

### Task 4: Full verification and production evidence

**Files:**
- Review all files changed by Tasks 1 through 3.

- [ ] **Step 1: Run full checks**

Run: `npm test && npm run build:client`

Expected: zero test failures and a successful client build.

- [ ] **Step 2: Review scope and secrets**

Run: `git diff --check` and inspect `git diff -- app/server/src/lib/metadata-source.js app/server/src/index.js app/server/public/metadata.html app/server/public/app.js app/server/test/metadata-source.test.js app/server/test/latency-and-metadata.test.js app/server/test/shelby-api-routes.test.js`.

Expected: no whitespace errors, debug output, secrets, or unrelated edits.

- [ ] **Step 3: Commit and push focused files**

Stage only the planned files, commit with `fix(metadata): validate and preview source artifacts`, then push `main` so Vercel auto-deploys.

- [ ] **Step 4: Verify production**

Open Metadata Atelier in the wallet-enabled Chrome session. Confirm the expired artifact displays an inline error and Generate is disabled. Upload or select a live image, generate a new TokenURI, and verify both the JSON URL and absolute image URL return HTTP 200.
