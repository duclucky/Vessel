# Vessel

> **Contract-settlement beta (2026-08-03): deployed on public testnets.**
> Aptos Move and the Solana Program are initialized under separate 2-of-3
> multisigs, and the public deployment manifest contains no placeholders. Both
> native multisigs use the approved no-native-timelock beta profile; each
> contract retains its own 24-hour schedule/execute delay for sensitive config
> changes. Real-wallet upload evidence remains a separate release checklist.

## Current contract-only payment model

- Native Aptos wallets pay the Vessel service fee to the Move contract vault;
  APT gas and Shelby protocol/storage charges are paid directly as part of the
  registration flow.
- Solana wallets pay the Vessel service fee to the Vessel Program vault; the DAA
  registration sponsorship remains separate.
- One shared Ed25519 quote key signs immutable `QuoteV1` payloads on both chains.
  Finalized contract receipts, not ordinary wallet transfers, authorize upload.
- Retention supports 7, 30, 90, or a custom 1-365 days. Quotes account for file
  size and duration, network/protocol cost, sponsored gas, a 2% Vessel fee, and a
  USD 0.01 minimum.
- Testnet tokens have no real monetary value.

The older sponsored-USDC walkthrough below documents the historical demo and is
not the release truth for the pending contract-only beta.

**Wallet-native, cross-chain media hosting on Shelby.**
Connect an Ethereum or Solana wallet you already own — no new account, no seed phrase,
no bridge — and host media on a decentralized *hot* storage network with sub-second
reads, then drop the URLs straight into your NFT metadata.

> **Status:** demo / proof-of-capability, built against Shelby **testnet** (Solana DAA).
> Not a production product. See `CLAUDE.md` §3–4 for why that framing is deliberate.
> `Vessel` is a working title — rename as you like.

---

## The working build (`app/server/`)

The runnable app lives in **`app/server/`**. Flow (**Cách B — sponsored, USDC-only**):

1. **Connect Phantom** → deterministically derive your **Aptos DAA storage account** (you own it).
2. **Pay a tiny USDC fee** on Solana (stablecoin → no price volatility).
3. **Sign the upload** with Phantom. The app **sponsors** the Aptos side (gas + ShelbyUSD) via an
   Aptos gas station — you never hold APT or ShelbyUSD.
4. Get a **stable Shelby URL** for your media (owned by your account) + a sample NFT `tokenURI`;
   a latency panel compares Shelby (hot) vs a public IPFS gateway.

**Security:** the only browser-side credential is the wallet signature. All keys (Shelby API key,
gas station key, private keys, HMAC pay-secret) stay **server-side**. Phantom signs the multi-agent
transaction as sender; the server co-signs via the gas station and submits. Recipe: `NOTES.md` §5j.

```bash
cd app/server && npm install
cp .env.example .env      # fill keys
npm run build:client      # bundle vessel-solana.js
npm start                 # http://localhost:8787
```

Deploy: Vercel with **Root Directory = `app/server`**; set every secret from `.env.example` as a
Vercel env var. `VERCEL=1` disables `app.listen` (runs as a serverless function); payments are
stateless (HMAC) so no shared memory is needed. **Ethereum DAA byte-upload is not yet possible
upstream — Solana (Phantom) is the working DAA path** (`NOTES.md` §5d, §5g).

---

## Why this exists

Today, media behind Ethereum and Solana NFTs lives in one of three bad places:

| Option | Problem |
|---|---|
| IPFS | Must be pinned; retrieval is slow and unreliable |
| Arweave | Permanent but *cold* — slow reads, pay-once, not built for serving |
| AWS/CDN | Fast, but centralized and censorable — breaks the "decentralized" claim |

None gives you **fast (hot) + decentralized + controlled by the wallet the user already
has.** Vessel does, using two Shelby capabilities:

- **Derived Account Abstraction (DAA):** an Ethereum/Solana wallet can derive and
  control a storage account on Aptos — the wallet *is* the key. No Aptos wallet needed.
- **Sub-second reads over a dedicated network:** Shelby is purpose-built for read-heavy,
  low-latency "hot" workloads, unlike Filecoin/Arweave.

The demo's headline moment: *connect MetaMask → you now control decentralized hot
storage → your media loads visibly faster than the same file on IPFS.*

---

## Repository map

```
vessel/
├── CLAUDE.md                              ← read this first (agent operating manual)
├── README.md                              ← you are here
├── knowledge/                             ← "what is true" — platform knowledge
│   ├── 01-product-brief.md                    product definition, scope, kill-criteria
│   ├── 02-shelby-protocol.md                  the platform + its hard current limits
│   ├── 03-derived-account-abstraction.md      DAA: the differentiator, in depth
│   ├── 04-s3-gateway.md                        the S3 gateway: easy I/O + quirks
│   └── 05-architecture.md                      THE key design decision + system design
└── guides/                                ← "how to act" — execution
    ├── 00-setup.md                            install official Shelby skill/CLI/SDK (run first)
    ├── 01-verification-first.md               Day-1 kill checklist (run before building)
    ├── 02-build-plan.md                       week-by-week plan with gates
    └── 03-conventions.md                       coding conventions + storage interface
```

**Two-word mental model:** `knowledge/` = facts to obey; `guides/` = steps to follow.

---

## Quickstart (for the AI or a human dev)

1. Read `CLAUDE.md` end to end.
2. Run `guides/00-setup.md` — install the official Shelby **skill plugin, CLI, and
   SDK/kits** (exact commands there), then read the live docs at https://docs.shelby.xyz.
   **The exact API lives in the skill + docs, not in this repo's markdown.**
3. Complete `guides/01-verification-first.md` — prove the load-bearing assumptions in a
   terminal. Do not build UI before these pass.
4. Follow `guides/02-build-plan.md`.

---

## Ground truth & honesty policy

Facts in `knowledge/` are tagged:

- **[VERIFIED]** — confirmed from Shelby docs/announcements at authoring time
  (~Q3 2026). Still re-check, because the platform moves fast.
- **⚠️ VERIFY** — inferred or illustrative (e.g. an API signature shown for shape).
  Confirm against the official skill/docs before relying on it.
- **[ANALYSIS]** — a judgment call / recommendation, not a fact.

If a `knowledge/` claim conflicts with the live docs, **the live docs win** — update the
knowledge file and note it.
