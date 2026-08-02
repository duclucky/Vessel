# 02 · Shelby Protocol — Platform Knowledge

**Purpose:** everything the builder must know about the platform itself, and — equally
important — its **current maturity limits**. Do not design around capabilities the live
network does not yet have.

Ground-truth tags: **[VERIFIED]** (from Shelby docs/announcements, ~Q3 2026),
**⚠️ VERIFY** (confirm against live docs/skill before relying), **[ANALYSIS]** (judgment).

---

## 1. What Shelby is

**[VERIFIED]** Shelby is a **decentralized *hot* storage protocol** — high read
bandwidth, low latency, read-heavy workloads (video, AI pipelines, real-time apps) —
co-built by **Aptos Labs** and **Jump Crypto**, announced 24 Jun 2025. It contrasts with
*cold*/archival storage (Filecoin, Arweave).

**[VERIFIED]** Shelby is **not a blockchain.** It uses the **Aptos L1** as a
coordination and settlement layer (system state, economic logic, audits). Data itself
lives off-chain on Storage Provider nodes; Aptos holds metadata, commitments, payment-
channel state, and audit outcomes.

**[VERIFIED]** Positioning: an "unbundling" of AWS S3-style object storage, with
cryptographic provenance and no egress fees, aimed heavily at **AI read workloads** and
**verifiable data**. For us, the relevant angles are hot reads + DAA, not AI.

## 2. Core architecture (what you're actually talking to)

**[VERIFIED]** Four components:

1. **Aptos smart contract** — source of truth: blob metadata, placement groups,
   commitments, micropayment-channel state, audits.
2. **Storage Provider (SP) servers** — store erasure-coded chunks of user data.
3. **Shelby RPC servers** — what clients talk to for reads/writes; bridge public
   internet ↔ the private network to the SPs.
4. **Private network (DoubleZero fiber)** — internal SP↔RPC traffic; the source of the
   latency advantage.

**[VERIFIED] Erasure coding (Clay Codes):** data → 10 MB "chunksets" → **16 chunks**
(10 data + 6 parity), each **1 MB**. Any **10 of 16** chunks reconstruct the data.
Small files are zero-padded internally (padding never returned on read). Implication:
tiny files still incur chunk/erasure overhead — batch small assets where it matters.

**[VERIFIED] Blob naming:** an account's data lives under its Aptos-account hex
namespace, e.g. `0x123…/user/defined/path.ext`. Names ≤ 1024 chars, must not end in `/`.
**There are no real directories** — only blobs; tools emulate directory layout by
convention. Plan your key scheme deliberately.

**[VERIFIED] Blobs expire.** Writes specify an expiration (`expirationMicros` in the
SDK). Shelby is **hot storage, not permanent storage** — unlike Arweave, nothing is
"pay once, keep forever." **[ANALYSIS]** For our demo this is fine (ephemeral anyway),
but never message Vessel as permanent hosting.

**[VERIFIED] Read/write flow (simplified):**
- *Write:* SDK erasure-codes locally → computes commitments → submits blob metadata +
  merkle root to the Aptos contract (storage paid here) → sends raw bytes to an RPC →
  RPC re-encodes, verifies against on-chain commitments, distributes chunks to the 16
  SPs of the blob's placement group → SPs sign acks → contract flips blob to "written."
- *Read:* client picks an RPC, opens a payment session → RPC looks up placement group,
  pulls ≥10 chunks over the private network (paying SPs via micropayment channel),
  validates, reassembles, returns bytes. Reads are **paid**.

## 3. ⚠️ CURRENT MATURITY — read this twice

The marketing describes the *vision* (global mesh, 30+ cities, 5 continents, 400 TB+
demos). The **network you actually build on today is far smaller**. Design for reality.

**[VERIFIED] `shelbynet` (the live developer prototype):**
- **Wiped roughly once per week, or faster.** Assume all data is ephemeral.
- **Single RPC server**, in a cloud environment.
- **16 SPs in a single region**, ~1 TiB disk each, ~**10 TiB** total capacity.
- Isolated from Aptos mainnet/testnet/devnet; its own validators under name `shelbynet`.

**[VERIFIED]** A separate `testnet` exists in docs but its limits/capabilities were
still **"TBD"** at authoring time. **Public early access** on testnet opened ~Mar 2026;
**full production expected later in 2026.**

**[VERIFIED] No token yet.** Native "Shelby token" + stablecoins are described, but full
tokenomics and distribution are **unpublished**. **[ANALYSIS]** Build no logic and make
no business assumption that depends on a token, airdrop, or incentive program.

**[ANALYSIS] Consequences for us (non-negotiable):**
- Vessel is a **demo**, never a persistence-bearing product.
- **Record a full run** — the network can wipe or go down mid-presentation.
- Keep storage behind the `StorageProvider` interface so we can fall back to
  Walrus/S3/MinIO/mock instantly.
- Expect docs/examples to occasionally lag the shipped code (upload path recently
  consolidated to a "v2" flow; older snippets may be stale). Pin versions; trust the
  installed package + current docs over any snippet.

## 4. Developer surface (packages, tools)

**[VERIFIED]** npm packages (install for npm/pnpm/yarn/bun):

| Package | Purpose |
|---|---|
| `@shelby-protocol/cli` | CLI: init, fund, upload, list, download, contexts |
| `@shelby-protocol/sdk` | Core TS SDK (`/browser` and node entry points) |
| `@shelby-protocol/react` | React hooks over `@tanstack/react-query` (e.g. `useAccountBlobs`) |
| `@shelby-protocol/ethereum-kit` | **Ethereum wallet integration via DAA** ← our primary |
| `@shelby-protocol/solana-kit` | Solana wallet integration via DAA ← our stretch |
| `@shelby-protocol/player` | Video/media playback |
| `@shelby-protocol/media-prepare` | Media prep (FFmpeg presets, CMAF+HLS builder) |

**[VERIFIED] Official agent skills — USE THESE.** `github.com/shelby/shelby-skills` is a
**Claude Code plugin** with a `SKILL.md` + `references/` per package
(`shelby-sdk`, `shelby-ethereum-kit`, `shelby-solana-kit`, `shelby-cli`, `shelby-media`).
Install and read `shelby-ethereum-kit` and `shelby-sdk` before writing integration code.
This is the canonical, current source for API signatures.

**[VERIFIED] Other tooling:** block explorer at `explorer.shelby.xyz`; an
**S3-compatible gateway** (see `04-s3-gateway.md`); Aptos GraphQL indexer; **API keys**
(format `AG-…`) recommended to avoid rate limits.

## 5. Endpoints & faucet (reference — re-check `docs.shelby.xyz/…/networks`)

**[VERIFIED] `testnet`:**

| Component | URL |
|---|---|
| Shelby RPC | `https://api.testnet.shelby.xyz/shelby` |
| Aptos Full Node | `https://api.testnet.aptoslabs.com/v1` |
| Indexer (GraphQL) | `https://api.testnet.aptoslabs.com/v1/graphql` |

**[VERIFIED] `shelbynet` (weekly-wiped prototype):**

| Component | URL |
|---|---|
| Shelby RPC | `https://api.shelbynet.shelby.xyz/shelby` |
| Aptos Full Node | `https://api.shelbynet.shelby.xyz/v1` |
| Indexer (GraphQL) | `https://api.shelbynet.shelby.xyz/v1/graphql` |
| Faucet | `https://faucet.shelbynet.shelby.xyz` |

**[VERIFIED]** Shelby smart contract account (both networks, at authoring time):
`0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a` — inspect on Aptos
Explorer with the matching network name. **⚠️ VERIFY** current values against
`https://docs.shelby.xyz/protocol/architecture/networks` — endpoints/addresses change.

**[ANALYSIS]** Fund the account from the faucet; the SDK/kit needs Aptos gas + Shelby
storage payment on the coordination layer even though *you* connect via an ETH/SOL
wallet (the DAA-derived Aptos account is what pays — verify the exact funding UX Day 1).

## 6. Competitive frame (one line, so you understand positioning)

**[VERIFIED]** Closest competitor is **Walrus** (Mysten Labs / Sui) — also "hot"
storage, but **already on mainnet** and well-funded; runs over the public internet.
Filecoin/Arweave are cold storage. **[ANALYSIS]** Vessel wins on the two things Walrus
lacks: **dedicated-network read latency** and **DAA cross-chain wallet control**. Lean on
those in the demo; don't compete on price or maturity.

## 7. What to read next

- The DAA mechanism that makes "any wallet controls storage" possible →
  `03-derived-account-abstraction.md`.
- The easy S3 I/O path and its important quirks → `04-s3-gateway.md`.
- How we reconcile DAA with the gateway and structure the app → `05-architecture.md`.
