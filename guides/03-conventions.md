# Guide 03 · Conventions & the Storage Abstraction

How we write code so the app stays swappable, secure, and demo-robust. The centerpiece is
the **`StorageProvider` interface** — the one seam every storage operation crosses.

---

## 1. The `StorageProvider` interface (the most important code in the repo)

**Rule:** no UI/component/page imports a `@shelby-protocol/*` package or an S3 client
directly. All storage crosses this interface. This is what lets us fall back to
Walrus/S3/MinIO/mock in minutes and keeps Shelby's churn contained to one folder.

```ts
// src/storage/types.ts

/** A wallet capable of signing (ETH via wagmi/viem, or SOL via wallet-adapter). */
export interface WalletSigner {
  chain: "ethereum" | "solana";
  address: string;
  /** Adapter-specific handle the DAA kit needs. Kept opaque to the UI. */
  raw: unknown;
}

/** A DAA-derived, wallet-owned storage identity on Shelby. */
export interface StorageIdentity {
  /** The external wallet that owns this identity. */
  owner: string;
  /** Derived Shelby/Aptos account handle (opaque; from the kit). */
  account: unknown;
  /** Namespace prefix for this owner's blobs (e.g. the account hex). */
  namespace: string;
}

export interface PutOptions {
  contentType?: string;
  /** Hot storage: blobs expire. Provider maps this to expirationMicros. */
  expiresInSec?: number;
}

export interface PutResult {
  key: string;
  url: string;         // resolvable read URL
  etag?: string;       // Shelby: merkle root, NOT MD5 — do not treat as integrity vs local MD5
  size: number;
}

export interface BlobRef {
  key: string;
  url: string;
  size?: number;
  updatedAt?: number;
}

export interface StorageProvider {
  /** DAA: derive/authorize a wallet-owned storage identity. May prompt a signature. */
  createOwnedIdentity(wallet: WalletSigner): Promise<StorageIdentity>;

  /** Wallet-owned write. Throws OverwriteConflictError on 409 (different content, same key). */
  put(id: StorageIdentity, key: string, data: Uint8Array, opts?: PutOptions): Promise<PutResult>;

  /** Build a resolvable read URL for a key (reads are not wallet-gated). */
  getUrl(key: string): string;

  /** Direct read (used by the latency probe and integrity checks). */
  get(key: string): Promise<Uint8Array>;

  /** List a namespace's blobs. */
  list(id: StorageIdentity, prefix?: string): Promise<BlobRef[]>;

  /** Delete (needed because replace = delete-then-put; Shelby 409s on overwrite). */
  delete(id: StorageIdentity, key: string): Promise<void>;
}
```

### Implementations
- `src/storage/shelby-daa.ts` — `ShelbyDaaProvider`: writes via `@shelby-protocol/ethereum-kit`
  (and `solana-kit`). Reads via kit/RPC read URL.
- `src/storage/shelby-gateway.ts` — `ShelbyGatewayProvider` (optional): reads/serving via
  the S3 gateway **iff** Probe-3 interop = yes. Server-side only (holds SigV4 secrets).
- `src/storage/mock.ts` — `S3MockProvider`: MinIO or in-memory. **Build against this first**
  and keep it working — it's the demo fallback and the fast dev loop.

### Selection
```ts
// src/storage/index.ts
export function getStorageProvider(): StorageProvider {
  switch (process.env.STORAGE_BACKEND) {
    case "shelby-daa":     return new ShelbyDaaProvider();
    case "shelby-gateway": return new ShelbyGatewayProvider();
    default:               return new S3MockProvider(); // safe default
  }
}
```

**⚠️** The method signatures inside each Shelby provider must match the **current** kit
API (from the `shelby-*` skills / live docs), not the illustrative shapes in `knowledge/`.

---

## 2. Secrets & the client/server boundary

**Never** ship any of these to the browser: `SHELBY_API_KEY`, gateway
`accessKeyId`/`secretAccessKey`, any Aptos private key. The **only** credential that
originates client-side is the **user's wallet signature**.

- Privileged calls (holding `apiKey` or gateway secrets) run in **server code** — Next.js
  API routes / server actions. The browser calls those routes.
- DAA account derivation and wallet-signed writes may run client-side **via the kit using
  the user's wallet** — that's fine, because the credential is the user's signature, not
  a secret you hold. Confirm in the kit whether writes are fully client-side or need a
  server assist. **⚠️ VERIFY.**
- `.env.local` for secrets; never commit it. Provide `.env.example` with placeholder keys
  and comments.

```
# .env.example
STORAGE_BACKEND=mock                 # mock | shelby-daa | shelby-gateway
SHELBY_API_KEY=AG-xxxxxxxx           # server only
SHELBY_RPC_URL=https://api.testnet.shelby.xyz/shelby
SHELBY_NETWORK=testnet               # or shelbynet
# Gateway (server only; used only if reads go through the gateway):
SHELBY_S3_ENDPOINT=
SHELBY_S3_KEY=
SHELBY_S3_SECRET=
SHELBY_S3_BUCKET=
# Public (safe for browser):
NEXT_PUBLIC_IPFS_GATEWAY=https://ipfs.io/ipfs/   # for the latency comparison
```

---

## 3. Key scheme (respect the platform's rules)

- **Content-addressed keys:** `media/{sha256hex}.{ext}` and
  `metadata/{sha256hex}.json`. This makes re-uploading identical content idempotent
  (Shelby returns 200) and sidesteps the **409-on-overwrite** rule entirely.
- Remember Shelby has **no real directories** — the slashes are naming convention only.
- Keys ≤ 1024 chars, never end in `/`.
- To "replace," write a **new** key; if you truly must reuse a key, `delete()` then
  `put()`.

---

## 4. Error handling

Define typed errors and handle the platform's known cases:

```ts
export class OverwriteConflictError extends Error {}     // gateway 409 / kit equivalent
export class UpstreamUnavailableError extends Error {}   // single-RPC prototype blips
export class NotFoundError extends Error {}
```

- Wrap **every** network call in **retry-with-exponential-backoff** (e.g. 3–5 tries).
  The single-RPC prototype *will* intermittently fail; treat transient errors as normal.
- Map `UpstreamUnavailableError` to a friendly UI state ("Shelby is warming up, retrying…")
  — never a raw stack trace in a demo.
- Do **not** treat an ETag≠local-MD5 as corruption; Shelby ETags are merkle roots. If
  using the AWS SDK, disable response checksum validation for the gateway client. **⚠️
  VERIFY** the exact flag for your SDK version.

---

## 5. Code style

- TypeScript strict mode on. No `any` in the storage layer; opaque handles typed as
  `unknown` and narrowed inside providers only.
- Small, pure functions; side effects (network, wallet) isolated in providers and
  server routes.
- Prefer explicit over clever. This is a demo read by judges and future-you.
- Keep components dumb: they call hooks/actions that call `getStorageProvider()`.
- One `NOTES.md` at repo root logging every **confirmed** Shelby signature, endpoint,
  and quirk you validated (dated), so the docs-lag doesn't bite twice.

---

## 6. Testing (light, demo-appropriate)

- Unit-test the **mock provider** and the key/hashing logic (deterministic, no network).
- For Shelby providers, a couple of **integration smoke tests** gated behind an env flag
  (they hit the live network and can flake / get wiped — don't run them in CI blindly).
- The real "test" is the **recorded end-to-end run**; prioritize that over coverage.

---

## 7. Definition of clean (self-check before you call something done)

- [ ] No `@shelby-protocol/*` or S3 import outside `src/storage/`.
- [ ] No secret reachable from the browser bundle.
- [ ] `STORAGE_BACKEND=mock` runs the full UI with zero Shelby access.
- [ ] Every Shelby call is behind retry + typed errors.
- [ ] Keys are content-addressed; no in-place overwrites.
- [ ] Every Shelby signature used is traceable to the current skill/docs, logged in NOTES.md.
