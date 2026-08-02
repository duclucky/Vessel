# Vessel — Frontend Integration Brief (TECHNICAL CONTRACT ONLY)

> For the frontend-generation tool. **You own 100% of the visual design, layout,
> components, typography, motion, copy tone and overall vibe.** This document only
> specifies the *technical contract* with the backend: what API to call, the data
> shapes, the wallet flow, and hard constraints. Nothing here dictates how it looks.

## 0. What Vessel is (context)
A demo: an existing Ethereum/Solana wallet controls decentralized **hot** storage on
Shelby. User connects a wallet, uploads media, gets back a resolvable URL, and sees a
read-latency panel (Shelby vs IPFS). It runs on a testnet that is **wiped ~weekly** — so
surface an honest "demo / ephemeral data" note somewhere (your design choice how).

## 1. Architecture boundary
- **Frontend (you):** any framework/output. Talks to the backend **only** over HTTP
  `fetch` (JSON + multipart). Configurable base URL via `VESSEL_API_BASE`
  (default `http://localhost:8787`). CORS is enabled by the backend.
- **Backend (owned by the engineer, already speced below):** holds all secrets/API keys,
  performs every Shelby operation server-side, exposes the REST API in §3.
- **Hard rule:** the frontend must **never** hold or receive any API key, gateway secret,
  or private key. The only credential that originates in the browser is the **user's
  wallet signature**. Do not add any Shelby SDK / AWS SDK to the frontend bundle.

## 2. Wallet flow (frontend implements the connect UI; backend verifies)
You build the connect button + signature prompt UX (MetaMask via wagmi/viem or your
choice; Solana optional/stretch). The technical steps:
1. User connects wallet → you have an `address` (`0x…` for ETH).
2. `POST /api/identity/challenge { address }` → `{ message }`.
3. Ask the wallet to sign `message` (EIP-191 `personal_sign`).
4. `POST /api/identity/verify { address, signature, message }` →
   `{ ok, chain, storageAccount, ownershipProofUrl }`.
   - `storageAccount` = the DAA-derived Aptos address controlled by that wallet (display it
     as "your storage identity" — copy/label is your call).
5. Include `address` in subsequent upload calls (see §3) so uploads are attributed to the
   owner. (Backend handles the actual storage auth server-side.)

Explain each wallet prompt in the UI ("Sign to prove you own this storage identity — no new
wallet, no seed phrase"). Unexplained prompts read as phishing. Wording/placement = yours.

## 3. REST API contract (call these; shapes are fixed)
Base: `${VESSEL_API_BASE}`. All JSON unless noted. Errors: HTTP 4xx/5xx with
`{ error: string, code?: string, retriable?: boolean }`.

### `GET /api/health` → `{ status: "ok", backend: "mock"|"shelby", network: string }`

### `POST /api/upload`  (multipart/form-data)
- fields: `file` (the binary), `owner` (wallet address, optional), `expiresInSec` (optional)
- → `200 { key, url, size, contentType, etag, expiresAt }`
  - `key`: content-addressed id, e.g. `media/<sha256>.<ext>`
  - `url`: **use this in the app** to display the asset — it is `${VESSEL_API_BASE}/api/media/<key>`
    (the backend proxies the keyed read; do NOT construct raw Shelby URLs yourself).
- `409 { error, code:"overwrite_conflict" }` if a *different* file is sent to an existing key.
- Show upload progress with the standard `XMLHttpRequest`/`fetch` stream if you want; the
  endpoint is a normal multipart POST.

### `GET /api/media/:key`  → streams the bytes with correct `Content-Type`
- Use directly as `<img src>` / `<video src>` / download link. Handles keyed reads for you.

### `GET /api/list?owner=<address>&limit=&offset=`
- → `{ items: [{ key, url, size, contentType, createdAt, expiresAt }], nextOffset }`
- For a gallery of the connected wallet's uploads.

### `DELETE /api/media/:key`  (body `{ owner }`) → `{ ok: true }`

### `POST /api/metadata`  `{ name, description, imageKey, attributes?: [{trait_type,value}] }`
- Hosts an NFT-standard metadata JSON on Shelby (referencing `imageKey`'s URL).
- → `{ tokenUri, url, json }` — `tokenUri` is what an NFT contract's `tokenURI` would point to.

### `GET /api/latency?key=<key>&samples=20`
- → `{ shelby: { medianMs, minMs, p90Ms, samples }, ipfs: { medianMs } | null }`
- Drives the "hot storage vs IPFS" proof panel. **`ipfs` may be `null`** (IPFS comparison
  is not always available) — design a graceful state for null (your call).

## 4. UI states the backend implies (data only — you design them)
- **idle / uploading / success / error** for upload.
- **empty / loading / populated** for the gallery.
- **upstream-unavailable**: backend may return `{ error, retriable:true }` during Shelby
  blips — show a friendly "warming up, retrying…" state, not a stack trace. (The backend
  already retries; you just render the transient state if one bubbles up.)
- **ephemeral banner**: a subtle honest note that data is a demo and may be wiped.
- **latency panel**: render `shelby.medianMs` prominently; handle `ipfs === null`.

## 5. Constraints / limits (respect these)
- Max upload size for the demo: **25 MB** (reject larger client-side for nice UX; backend
  also enforces). Types: `image/*` always; `video/mp4` if present (feature-flagged — call
  `/api/health` or just try and handle errors).
- Don't cache media bytes in the frontend beyond the browser default; always reference
  `/api/media/:key`.
- No secrets, no direct Shelby/AWS calls, no raw Shelby URLs in the bundle.

## 6. What is explicitly YOURS to decide (do not ask the backend about these)
Layout, grid, colors, dark/light, typography, spacing, iconography, component library,
animations/transitions, empty-state illustrations, microcopy/tone, the overall "vibe",
page structure, and how you arrange connect → upload → gallery → latency → metadata.
Make it good. The backend adapts to your data needs, not the other way around.

## 7. Open questions? 
If the tool needs anything not covered here (an extra endpoint, a different field, a
websocket for progress, etc.), list the questions and the human will relay them to the
backend engineer, who will extend this contract. Prefer additive changes.
