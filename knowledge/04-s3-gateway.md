# 04 · Shelby S3 Gateway

**Purpose:** the gateway is the *easy* storage I/O path — point a standard AWS S3 client
at it and `PutObject`/`GetObject` work. But it has an auth model and several quirks that
directly shape our architecture. Read all of it; the auth section is decisive.

Tags: **[VERIFIED]** (from Shelby S3-gateway docs), **⚠️ VERIFY**, **[ANALYSIS]**.

---

## 1. What it is

**[VERIFIED]** The Shelby S3 Gateway implements a **subset of the Amazon S3 API**. Most
standard S3 tooling (AWS SDKs, `rclone`, etc.) works against it with minor config. It
uses **standard AWS SigV4** request signing.

**[ANALYSIS]** This is why the gateway is the fastest path to "just move bytes": you can
use `@aws-sdk/client-s3` in Node with almost no Shelby-specific code.

## 2. ⚠️ THE AUTH MODEL — the single most important fact in this file

**[VERIFIED]** The gateway's `accessKeyId` / `secretAccessKey` are **shared secrets
between your S3 client and the gateway. They are NOT AWS credentials — and they are NOT
derived from or bound to a user's wallet.**

**[ANALYSIS] Implication — the core tension of this project:**

- The gateway authenticates **by gateway keys**, i.e. **app-custodied**, not by the
  user's Ethereum/Solana wallet.
- **DAA** (the differentiator) authenticates **by the user's wallet**.
- Therefore **"pure S3 gateway" and "via DAA" pull in opposite directions.** If you
  upload purely through the gateway, the write is authorized by *your app's* gateway
  keys, and the "the user's wallet controls this storage" story is weakened or lost.

**Do not treat this as a detail.** It is *the* architectural decision. Resolution,
options, and the Day-1 probe are in `05-architecture.md` §2. The short version of the
recommended answer: **use the DAA kit for wallet-owned writes (the story), and the
gateway for convenient reads / stable URLs / S3-tooling** — behind one `StorageProvider`
interface — unless Day-1 verification shows the gateway can scope objects to a
DAA-derived namespace.

**⚠️ VERIFY (Day-1):** Can the gateway write/read objects **within a specific
DAA-derived account's namespace**, or only within namespaces tied to gateway keys? The
answer decides whether a "gateway + DAA" hybrid is clean or whether wallet-owned writes
must go through the kit SDK.

## 3. Non-standard behaviors you MUST handle

**[VERIFIED] ETag is NOT an MD5.** For a single-part upload, standard S3 returns the
MD5 of the object as the ETag. The Shelby gateway instead returns the **blob merkle
root** — a SHA2-256-based hash from Shelby's erasure-coded commitments.
- ETags are **consistent** across `PutObject`, `GetObject`, `HeadObject`, `ListObjects`.
- **Clients that verify integrity by comparing a locally computed MD5 to the ETag will
  see a mismatch. This is NOT corruption.** Disable MD5 checksum verification in your
  client (e.g., in `rclone`; and set the appropriate options in the AWS SDK so it doesn't
  reject the response). **⚠️ VERIFY** the exact AWS SDK v3 flags to suppress checksum
  validation for your version.

**[VERIFIED] Uploads are idempotent by content:**
- Same content to an existing key → gateway detects the matching merkle root → **`200 OK`**.
- **Different** content to an existing key → **`409 ObjectAlreadyExists`**.
- To **replace** an object: **delete it first, then upload** the new version.
**[ANALYSIS]** Design keys so you don't need in-place overwrites; treat writes as
content-addressed-ish. For versioned media, use a new key (e.g., include a hash/timestamp).

**[VERIFIED] `CopyObject` is not supported.** To copy: `GetObject` then `PutObject`.

**[VERIFIED] Many standard S3 headers are accepted but silently ignored** (no error,
no effect). Don't rely on server-side behavior triggered by headers (e.g., some
storage-class / SSE / metadata headers) unless docs confirm the gateway honors them.

## 4. Encryption status (do not depend on it)

**[VERIFIED]** Managed, **server-side object encryption** for the gateway is **in
progress**: encrypted uploads/downloads/ranges/multipart, plaintext-transparent
listings, pluggable key management. It is **gated behind integration work — not GA.**
**[ANALYSIS]** Keep it **off** the demo's critical path (non-goal per `01-product-brief`
§6). If you need encryption for the demo, encrypt client-side before upload; but prefer
to simply not need it.

## 5. Operational notes

**[VERIFIED]** The gateway returns **clearer status codes when an upstream dependency is
unavailable** (recent hardening). Handle upstream-unavailable responses gracefully in the
UI — on a single-RPC prototype, transient failures are expected; retry with backoff and
show a friendly state rather than a stack trace.

**[ANALYSIS] Browser vs server:** SigV4 shared secrets must **never** reach the browser.
Two safe patterns:
- **Thin server proxy** (recommended for the demo): the browser calls your backend; the
  backend holds gateway keys and signs/forwards to the gateway. Simple, secure.
- **Presigned URLs**: your backend presigns S3 URLs; the browser uploads/downloads
  directly. **⚠️ VERIFY** the gateway supports S3 presigning before relying on it.
- Also confirm **CORS** behavior if you ever call the gateway directly from the browser.

## 6. Minimal usage sketch (⚠️ shape only — confirm endpoint + config)

```ts
// SERVER-SIDE ONLY. Confirm the gateway endpoint + region string in Shelby docs.
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.SHELBY_S3_ENDPOINT,     // ⚠️ VERIFY exact gateway URL
  region: "auto",                               // ⚠️ VERIFY expected region value
  credentials: {                                // gateway shared secrets — NOT AWS, NOT wallet
    accessKeyId: process.env.SHELBY_S3_KEY!,
    secretAccessKey: process.env.SHELBY_S3_SECRET!,
  },
  forcePathStyle: true,                         // ⚠️ VERIFY (path-style is common for S3-compat)
  // ⚠️ VERIFY: disable request/response MD5 checksum validation for this client/version
});

await s3.send(new PutObjectCommand({
  Bucket: process.env.SHELBY_S3_BUCKET,         // ⚠️ VERIFY bucket/namespace semantics
  Key: "media/hero.png",
  Body: bytes,
}));
// Remember: different content to an existing Key → 409. Delete-then-put to replace.
```

## 7. Decision heuristic (gateway vs DAA kit for a given operation)

| Operation | Use | Why |
|---|---|---|
| Wallet-owned **write** (the ownership story) | **DAA kit** (`ethereum-kit`) | Authorized by user's wallet, not app keys |
| Convenient **read** / stable serving URL | **Gateway** (or RPC read URL) | Simple, S3-tooling friendly; reads aren't wallet-gated |
| Bulk/tooling ops (rclone, scripts) | **Gateway** | Standard S3 ergonomics |
| Anything that must prove *user* ownership | **DAA kit** | Gateway keys ≠ user identity |

All of it goes behind the `StorageProvider` interface (`guides/03-conventions.md`), so the
choice per operation is an implementation detail we can change.

## 8. Read next

- Reconcile all of the above into one design → `05-architecture.md`.
