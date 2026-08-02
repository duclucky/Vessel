# 01 · Product Brief

**Purpose of this file:** give the builder a precise, unambiguous definition of what
Vessel is, who it is for, what "good" looks like, and — critically — where the edges
are. When in doubt about scope, this file decides.

---

## 1. Problem statement

NFT and dApp media (images, short video, metadata JSON) needs storage that is
simultaneously (a) **fast to read** ("hot"), (b) **decentralized / censorship-resistant**,
and (c) **controllable by the wallet the user already has** on Ethereum or Solana.
No existing option delivers all three at once (see `README.md` table). Shelby can,
because of hot-read performance + **Derived Account Abstraction (DAA)**.

## 2. What we are building

A browser demo, `Vessel`, that:

1. Lets a user connect an existing **Ethereum** wallet (MetaMask via `wagmi`) — and,
   as a stretch, a **Solana** wallet (`@solana/wallet-adapter`).
2. Establishes a **wallet-controlled storage identity on Shelby via DAA** — no Aptos
   account, no seed phrase, no bridge. (Exact ownership model: see
   `05-architecture.md`; it is a Day-1 verification item.)
3. Uploads media to Shelby and returns a **stable, resolvable read URL**.
4. Generates a sample **NFT metadata JSON** that references the Shelby-hosted media,
   and hosts that JSON on Shelby too (so `tokenURI` → Shelby).
5. Shows a **latency comparison** — Shelby read vs a public IPFS gateway for the same
   asset — as the visual proof that this is *hot* storage.

## 3. Target user / audience

- **Primary:** Shelby / Aptos **builder-program reviewers and ecosystem judges.** The
  win condition is a submission that demonstrates a capability *unique to Shelby*,
  cleanly and verifiably.
- **Narrative persona (for the demo story):** an NFT creator or dApp developer who
  wants decentralized, fast media hosting without forcing users onto a new chain/wallet.

This is **not** built for real paying end users. Do not add production concerns
(billing, SLAs, KYC, durability guarantees). See non-goals.

## 4. Why Shelby specifically (the differentiators we must showcase)

| Differentiator | Why it matters for this demo |
|---|---|
| **DAA** (wallet from ETH/SOL controls Aptos storage) | The "no new account" magic; the emotional hook of the demo |
| **Hot reads** (sub-second, dedicated network) | The measurable proof vs IPFS; "decentralized *and* fast" |
| **Chain-agnostic** | Justifies "cross-chain" — same storage, any wallet |

If a design choice does not serve at least one of these three, question it.

## 5. Success criteria (Definition of Done)

Restated from `CLAUDE.md` §5, canonical here:

- [ ] Connect MetaMask in-browser.
- [ ] Wallet-controlled Shelby storage identity established via DAA.
- [ ] Upload an image; get a stable read URL that resolves.
- [ ] (If verified working) upload + play a short video.
- [ ] Generate sample NFT metadata JSON referencing the Shelby URL; host it on Shelby.
- [ ] Latency panel: Shelby read vs IPFS gateway, same asset, numbers visible.
- [ ] Storage I/O runs entirely through the `StorageProvider` interface.
- [ ] A **recorded** end-to-end run exists (insurance against network wipe).
- [ ] (Stretch) Solana wallet path works.

## 6. Non-goals (explicitly out of scope)

Do **not** build these unless the user explicitly reopens scope:

- ❌ On-chain monetization: pay-per-view, token-gating, subscriptions, micropayments.
  (Different product; needs Move; big surface.)
- ❌ Custom NFT smart contracts / a minting engine.
- ❌ Reliance on Shelby **managed server-side encryption** (in progress, not shipped).
- ❌ Provenance/authenticity verification UX (that is the *sibling* product idea; keep
  Vessel focused on hosting + DAA).
- ❌ Durability/persistence guarantees, production auth, real payments, multi-tenant.
- ❌ Mainnet assumptions, token/airdrop assumptions.

## 7. Kill criteria (when to stop and escalate)

Stop building and report a **go/no-go** to the user if any of these is true after the
Day-1 verification (`guides/01-verification-first.md`):

- **K1 — DAA doesn't deliver the story.** If an Ethereum wallet signature cannot, in
  practice, derive/control a Shelby storage account (i.e., DAA for Ethereum is not
  actually usable on the current network), the core differentiator is gone.
  → Fallback: reframe to Solana-only if that path works, else escalate.
- **K2 — Reads aren't actually fast/stable.** If reads on the current single-RPC
  prototype are not visibly sub-second, or range reads/video are too flaky to demo,
  the "hot storage beats IPFS" proof collapses.
  → Fallback: demo images only; if even that is unstable, escalate.
- **K3 — Network too unstable to demo.** If `shelbynet` is down or wiping too often to
  hold a demo together, escalate; we may need to wait for the public testnet or pivot
  backend via the `StorageProvider` interface.
- **K4 — No usable write path for a wallet-owned namespace.** If neither the DAA SDK
  path nor the gateway can produce wallet-scoped, resolvable objects, escalate.

A kill decision is a *success* of the process, not a failure. Report it plainly with
the evidence (commands run, outputs seen).

## 8. Positioning discipline (how to talk about it)

In the demo and writeup, present Vessel as a **capability demonstration**, not a
product you can rely on today. Say "your wallet controls decentralized hot storage" —
true. Do **not** say "host your real collection here" — the network is wiped weekly and
URLs are not durable across wipes/mainnet. This honesty is a feature with technical
judges; overclaiming loses credibility fast.
