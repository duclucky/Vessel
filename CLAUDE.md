# CLAUDE.md — Vessel: Operating Manual for the AI Builder

> **Working title:** `Vessel` — wallet-native, cross-chain media hosting on Shelby.
> Rename freely; the name is not load-bearing.

You are the primary engineer on this project. This file is your constitution.
Read it fully before writing any code. It tells you **what we are building, how to
think, which tools to use, and — most importantly — what NOT to do.**

---

## 0. The one-paragraph brief

We are building a **demo** (not a production product) that lets a user connect an
**Ethereum or Solana wallet they already own** and, without creating any Aptos
account or seed phrase, upload media (images / short video / metadata JSON) to
**Shelby** — a decentralized *hot* storage network — then get back stable URLs they
can drop into an NFT `tokenURI`. The "wow" is: **your existing wallet controls
decentralized, low-latency storage, cross-chain, with no bridge and no new account.**
The mechanism that makes this possible is **Derived Account Abstraction (DAA)**.

The target audience for this demo is **the Shelby / Aptos builder program and
ecosystem judges** — not paying end users. Optimize for a crisp, verifiable,
recordable demonstration of a capability that *only Shelby can offer*.

---

## 1. Reading order (do this before coding)

Read these in order. Do not skip. Do not start coding until you have read them all
and completed the Day‑1 verification in `guides/01-verification-first.md`.

1. `knowledge/01-product-brief.md` — what/why/scope/non-goals/kill-criteria.
2. `knowledge/02-shelby-protocol.md` — the platform, and its **hard current limits**.
3. `knowledge/03-derived-account-abstraction.md` — DAA: the differentiator.
4. `knowledge/04-s3-gateway.md` — the S3 gateway: the easy I/O path + its quirks.
5. `knowledge/05-architecture.md` — **the central design decision** (DAA vs gateway),
   system design, data flow, the storage abstraction.
6. `guides/00-setup.md` — **install the official Shelby skill/CLI/SDK** (exact commands).
7. `guides/01-verification-first.md` — **run this first, in code, before building.**
8. `guides/02-build-plan.md` — the week-by-week execution plan with gates.
9. `guides/03-conventions.md` — coding conventions + the swappable storage interface.

---

## 2. First action, every session: load the official Shelby knowledge

**These instruction files teach you how to think. They do NOT contain Shelby's exact,
current API signatures — those change and must come from source.** Before writing any
Shelby-touching code, load Shelby's own agent skills and read the live docs.

- Shelby publishes an official **Claude Code plugin** of agent skills:
  `github.com/shelby/shelby-skills` (org `shelby` — the canonical one; a community
  `codehakase/shelby-skills` also exists, don't confuse them). It contains `SKILL.md`
  entry points and `references/` for: `shelby-sdk`, `shelby-ethereum-kit`,
  `shelby-solana-kit`, `shelby-cli`, `shelby-media`. **Install it and read the relevant
  skill** (at minimum `shelby-ethereum-kit` and `shelby-sdk`) before writing integration
  code. **Exact install commands (plugin + CLI + SDK/kits) are in `guides/00-setup.md` —
  run that first.**
- Cross-check against the live docs at **https://docs.shelby.xyz** — specifically the
  pages for the TypeScript SDK, `ethereum-kit`, `solana-kit`, the S3 gateway, and
  `Networks`. Package versions move; pin what you actually install.

**Rule:** Every code path that calls Shelby must be traceable to a signature you read
in the official skill or docs *this session* — never to a signature you remember or
that appears illustratively in these files. Illustrative snippets in `knowledge/` are
marked `⚠️ VERIFY`. Treat them as shape, not truth.

---

## 3. How to think (operating principles)

1. **Verify by doing, fail fast.** This project rests on assumptions that must be
   proven in a terminal, not reasoned about. The single most important thing you can
   do is complete `guides/01-verification-first.md` before building UI. If a
   load-bearing assumption fails, **stop and report the kill decision** — do not paper
   over it.
2. **This is a demo on an unstable network.** The live Shelby network (`shelbynet`)
   is a single-region prototype that is **wiped roughly weekly**. Never build anything
   that assumes data or URLs persist. Assume every artifact is ephemeral.
3. **Isolate Shelby behind an interface.** All storage I/O goes through one
   `StorageProvider` abstraction (see `guides/03-conventions.md`). We must be able to
   swap the backend for Walrus, S3/MinIO, or a local mock in under an hour — for
   demos, for fallback, and because the platform is immature.
4. **Prefer the boring, battle-tested path** for everything that is not the
   differentiator. Wallet connection = standard `wagmi`/`@solana/wallet-adapter`.
   Storage I/O over the gateway = standard AWS S3 client. Spend your novelty budget on
   the DAA ownership story and the demo's clarity, nowhere else.
5. **Name the tension, don't hide it.** The product concept ("cross-chain hosting
   *via DAA*, *pure S3 gateway*") contains a real architectural conflict: the S3
   gateway authenticates with shared-secret keys, **not** the user's wallet, while DAA
   is precisely what makes storage wallet-controlled. `knowledge/05-architecture.md`
   resolves this. Read it before you assume the two halves compose for free.
6. **Do not invent APIs.** If you cannot find a method in the skill or docs, say so and
   ask, or write against the `StorageProvider` interface with a mock and flag it. Never
   fabricate a plausible-looking Shelby call.
7. **Record everything.** Because the network may vanish mid-demo, every working
   milestone should be captured (screen recording / asciinema / saved responses). The
   deliverable includes a demo video, not just running code.

---

## 4. Scope guardrails (say no to these)

Do **not**, without an explicit new instruction from the user, build any of:

- On-chain monetization (pay-per-view, token-gating, micropayments). That is a
  *different* product and requires Move contracts. Out of scope here.
- Minting custom NFT contracts. If a demo needs an NFT, point an existing standard
  contract / testnet mint at a Shelby URL. We host media; we don't reinvent NFTs.
- Dependence on Shelby **managed encryption** — it is *in progress*, not shipped.
  Do not put it on the demo's critical path.
- Any persistence guarantee, production auth, payments, or real user data.
- Second chain before the first works. Ship Ethereum end-to-end, then add Solana only
  if time remains.

If a task seems to require one of these, stop and confirm with the user first.

---

## 5. Definition of done (for the demo)

- A user connects an Ethereum wallet (MetaMask) in the browser.
- Behind the scenes, a **DAA-derived storage identity** is established for that wallet
  (see architecture doc for the exact ownership model we land on).
- The user uploads an image (and, if verified working, a short video) to Shelby.
- The app returns a **stable, resolvable URL** for the media and generates a sample
  NFT metadata JSON referencing it, also hosted on Shelby.
- A side-by-side panel demonstrates **read latency vs a public IPFS gateway** for the
  same asset (this is the visual proof of "hot" storage).
- Everything runs against `shelbynet`/testnet with the storage layer behind the
  `StorageProvider` interface, and there is a **recorded** run of the full flow.
- (Optional / stretch) Solana wallet path works too.

---

## 6. Environment & secrets

- Node.js (LTS), pnpm preferred (Shelby packages publish for npm/pnpm/yarn/bun).
- Get a Shelby **API key** (format looks like `AG-…`) to avoid rate limits; keep it in
  `.env`, never in the repo, never in client bundles. Route any gateway shared-secret
  keys through a thin server proxy — never ship SigV4 secrets to the browser.
- Testnet/`shelbynet` endpoints and the faucet are listed in
  `knowledge/02-shelby-protocol.md`. Fund test accounts from the faucet.

---

## 7. When you are unsure

Ask one sharp question, or make the smallest assumption that lets you keep moving and
**state it inline in your output**. Do not stall on ambiguity you can resolve by
reading a doc or running a one-line probe. Bias toward a working vertical slice over a
complete-but-unproven design.
