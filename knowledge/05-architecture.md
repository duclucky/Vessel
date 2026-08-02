# 05 · System Architecture

**Purpose:** turn the platform facts into one coherent design. This file centers on the
**one decision that defines the project** (how DAA and the gateway coexist), then lays
out components, data flow, and the abstraction boundary. Read `02`, `03`, `04` first.

Tags: **[VERIFIED]**, **⚠️ VERIFY**, **[ANALYSIS/DECISION]**.

---

## 1. Design goals (in priority order)

1. **Show the differentiator:** a user's existing ETH/SOL wallet controls decentralized
   hot storage (DAA), with reads visibly faster than IPFS.
2. **Be demo-robust** on an unstable, weekly-wiped, single-RPC network.
3. **Be swappable:** one storage interface; backend replaceable in <1h.
4. **Be vibe-code-fast:** boring, standard libs everywhere except the DAA moment.

## 2. THE decision: how DAA and the gateway coexist

Recall the tension (from `04` §2): **the gateway authenticates by app-custodied SigV4
keys; DAA authenticates by the user's wallet.** "Cross-chain hosting *via DAA*, *pure S3
gateway*" cannot be taken literally without resolving this. Three options:

| Option | Ownership story | Vibe-code ease | Verdict |
|---|---|---|---|
| **A. Pure gateway** | Weak — app keys own the data, not the user | Highest | ❌ Loses the differentiator |
| **B. Pure DAA kit** | Strongest — wallet owns everything | Lower (bespoke SDK) | ✅ but heavier |
| **C. Hybrid (recommended)** | Strong — wallet-owned **writes** via DAA; gateway used for **reads/serving/tooling** | High | ✅ **Default** |

**[DECISION] Default to Option C (Hybrid):**

- **Writes that must be wallet-owned → DAA kit** (`@shelby-protocol/ethereum-kit`). This
  is what earns the "your wallet controls this" claim.
- **Reads / stable serving URLs / any S3-tooling convenience → gateway** (reads aren't
  wallet-gated, so app-custodied gateway access is fine for *serving*).
- Everything behind the **`StorageProvider` interface**, so the write path can be gateway,
  kit, or mock without touching the UI.

**[⚠️ VERIFY — Day-1, decides whether C is clean or needs adjustment]:**
Can the gateway operate **within a DAA-derived account's namespace** (so a
wallet-owned blob written via the kit is readable/servable via the gateway, and vice
versa)?
- **If yes** → clean hybrid: write via kit, read/serve via gateway, same namespace.
- **If no** (gateway objects live only under gateway-key namespaces, separate from
  DAA-derived accounts) → **write via the kit AND read via the kit/RPC read URL**; use
  the gateway only for out-of-band tooling. Adjust the `StorageProvider` implementation
  accordingly. Still Option C in spirit; just fewer gateway responsibilities.

Do not proceed past Day-1 without answering this probe. It changes the read path.

## 3. Components

```
┌────────────────────────────────────────────────────────────────────────┐
│  BROWSER (React)                                                         │
│  • wagmi + MetaMask (ETH)  /  @solana/wallet-adapter (SOL, stretch)      │
│  • DAA: derive/authorize Shelby storage account via ethereum-kit/react  │
│  • Upload UI, gallery, NFT-metadata preview                             │
│  • Latency panel: Shelby read vs IPFS gateway                          │
│  ── holds NO gateway secrets; only the user's wallet signature ──       │
└───────────────┬───────────────────────────────────┬────────────────────┘
                │ wallet-signed (DAA)                │ HTTPS (no secrets)
                ▼                                     ▼
        Shelby DAA path                       ┌──────────────────────┐
   (@shelby-protocol/ethereum-kit)            │  THIN SERVER PROXY    │
   • createStorageAccount(walletSigner)       │  (Node/Next API route)│
   • upload({ blobData, signer, blobName,     │  • holds SHELBY apiKey │
   •         expirationMicros })              │  • holds S3 gateway    │
                │                              │    SigV4 secrets       │
                │ Aptos txns + RPC             │  • signs/forwards S3   │
                ▼                              │    or presigns URLs    │
   ┌───────────────────────────────┐          └───────────┬───────────┘
   │  SHELBY (shelbynet/testnet)   │◄─────────────────────┘  S3 subset API
   │  • Aptos smart contract       │      GetObject/PutObject/Head/List (SigV4)
   │    (metadata, commitments,    │
   │     placement groups, audits) │      ┌───────────────────────────────┐
   │  • RPC server (single, proto) │◄────►│  Shelby S3 Gateway            │
   │  • 16 Storage Providers       │      │  (subset of S3, own keys)     │
   │    (Clay erasure coding)      │      └───────────────────────────────┘
   │  • DoubleZero private fiber   │
   └───────────────────────────────┘
```

**[ANALYSIS]** The **thin server proxy** is essential: it is the only place gateway
secrets and the Shelby `apiKey` live. The browser only ever holds the user's wallet
connection. In a Next.js app, the proxy is just a couple of API routes.

## 4. Data flow — the happy path

### 4.1 Onboard (DAA)
1. Browser: connect MetaMask (`wagmi`).
2. Browser: `ethereum-kit` derives the Shelby storage account for the wallet — expect
   **one signature prompt**; explain it in the UI. **⚠️ VERIFY** exact call + signer type.
3. Ensure the derived Aptos account can pay (faucet/sponsor). **⚠️ VERIFY** funding UX.

### 4.2 Upload (wallet-owned write)
4. Browser: user picks a file. Compute a **content-addressed key** (e.g.
   `media/{sha256}.{ext}`) to sidestep the 409-on-overwrite rule.
5. **Write via DAA kit** `upload({ blobData, signer: storageAccount, blobName,
   expirationMicros })`. Set a comfortable `expirationMicros` (blobs expire — hot
   storage). **⚠️ VERIFY** max blob size vs chunkset behavior; large video may need
   `media-prepare` (CMAF/HLS) + multipart.
6. On success, resolve the blob's **read URL** (kit read URL / RPC / gateway per the §2
   Day-1 answer).

### 4.3 Serve & compare
7. Gallery reads media by URL (no wallet needed to read).
8. **Latency panel:** fetch the same asset from (a) Shelby and (b) a public IPFS gateway;
   time both; render the delta. This is the proof shot.

### 4.4 NFT metadata
9. Generate a standard metadata JSON (`{ name, description, image: <shelbyUrl>, ... }`)
   and host it on Shelby too; surface the resulting `tokenURI`-ready URL. **[ANALYSIS]**
   We do not mint; we produce a URL a standard contract could reference.

## 5. The abstraction boundary (non-negotiable)

**[DECISION]** All storage I/O crosses a single interface. Nothing in the UI imports a
Shelby package directly. This gives us fallback (Walrus/S3/MinIO/mock) and demo safety.

```ts
// Full definition + rationale in guides/03-conventions.md. Summary:
export interface StorageProvider {
  createOwnedIdentity(wallet: WalletSigner): Promise<StorageIdentity>; // DAA
  put(id: StorageIdentity, key: string, data: Uint8Array,
      opts?: { contentType?: string; expiresInSec?: number }): Promise<PutResult>;
  getUrl(key: string): string;                 // resolvable read URL
  get(key: string): Promise<Uint8Array>;       // direct read (for latency probe)
  list(id: StorageIdentity, prefix?: string): Promise<BlobRef[]>;
  delete(id: StorageIdentity, key: string): Promise<void>; // delete-then-put to replace
}
```

Implementations: `ShelbyDaaProvider` (kit writes), optionally `ShelbyGatewayProvider`
(gateway reads/serving), `S3MockProvider` (MinIO/local — demo fallback + fast dev loop).

## 6. Tech stack (see `guides/03-conventions.md` for detail)

- **App:** Next.js (App Router) + TypeScript — gives us the browser app *and* the thin
  proxy (API routes) in one repo.
- **Wallet:** `wagmi` + `viem` + MetaMask (ETH); `@solana/wallet-adapter` (SOL, stretch).
- **Shelby:** `@shelby-protocol/ethereum-kit`, `@shelby-protocol/sdk`,
  `@shelby-protocol/react`; `@shelby-protocol/player`/`media-prepare` if video is in.
- **Gateway I/O:** `@aws-sdk/client-s3` (server-side only).
- **UI:** minimal — Tailwind or plain CSS; the star is the flow, not the chrome.

## 7. Failure & resilience posture

- Wrap every network call in retry-with-backoff; the single-RPC prototype *will* blip.
- Surface friendly states for upstream-unavailable (gateway returns clear codes now).
- Feature-flag the backend: `STORAGE_BACKEND=shelby-daa | shelby-gateway | mock`.
  A demo must be able to switch to `mock`/MinIO instantly if `shelbynet` is down.
- **Record** a full successful run whenever you get one.

## 8. Open questions to resolve in Day-1 verification (`guides/01`)

1. Ethereum DAA: exact call, signer type, signature prompt, funding. (K1)
2. Gateway ↔ DAA namespace interop (§2 probe). Decides the read path.
3. Read latency + range-read/video stability vs IPFS. (K2)
4. Max blob size / multipart / video pipeline needs.
5. Whether the gateway supports presigned URLs and browser CORS (if we ever go direct).
