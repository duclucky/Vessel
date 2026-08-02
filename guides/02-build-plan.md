# Guide 02 · Build Plan

A 2–4 week plan sized for a solo/vibe-code builder. Each week has a **gate**: don't
advance until it's met. The ordering front-loads risk (verify → thin vertical slice →
differentiator polish → package). Timeboxes are guidance; the gates are the real
contract.

**Prerequisite:** `guides/01-verification-first.md` green-lit (Probe 0 + a DAA path).

---

## Week 1 — Verify & vertical slice

**Objective:** one file, one wallet, end to end — ugly is fine.

- [ ] Complete all Day-1 probes; record the go/no-go table. (Guide 01)
- [ ] Scaffold Next.js (App Router) + TypeScript + Tailwind. One repo = app + thin proxy.
- [ ] Implement the `StorageProvider` interface + a `mock`/MinIO impl first, so the UI
      works before Shelby is wired. (`guides/03-conventions.md`)
- [ ] Wire `wagmi` + MetaMask connect.
- [ ] Implement `ShelbyDaaProvider.createOwnedIdentity()` and `.put()` using
      `@shelby-protocol/ethereum-kit` (confirmed signatures from the skill).
- [ ] Thin proxy route holding `SHELBY_API_KEY` (and gateway secrets if used for reads).
- [ ] Upload one image via the connected wallet; get a resolvable read URL; show it.

**GATE 1:** In the browser, connect MetaMask → upload an image → see it render from its
Shelby URL. Backend switch (`STORAGE_BACKEND=mock|shelby-daa`) works.
→ If DAA blocked despite Probe 2 passing, isolate the blocker and report; don't thrash.

---

## Week 2 — Make it a coherent app

**Objective:** the core loop feels intentional; the read path is settled.

- [ ] Apply the Probe-3 decision: reads/serving via **gateway** (if interop=yes) or via
      **kit/RPC** (if interop=no). Implement in the provider, not the UI.
- [ ] Gallery: list the wallet's blobs (`list()` / `useAccountBlobs`), render thumbnails.
- [ ] Content-addressed keys (`media/{sha256}.{ext}`) to avoid 409-on-overwrite; handle
      the "already exists → 200" and "different content → 409" cases cleanly.
- [ ] Retry-with-backoff + friendly upstream-unavailable states everywhere.
- [ ] Set sensible `expirationMicros`; surface "hot storage / ephemeral" honestly in UI.
- [ ] Basic empty/loading/error states; drag-and-drop upload.

**GATE 2:** connect → upload multiple assets → see them in a gallery that survives a
refresh (within the network's wipe window) → reads are consistently fast.

---

## Week 3 — The differentiator & the proof shot

**Objective:** the two things judges remember: the DAA moment and the latency win.

- [ ] **Latency panel:** same asset fetched from Shelby vs a public IPFS gateway; show
      median times + a simple bar/delta. This is the money shot — make it legible.
- [ ] **NFT metadata:** generate a standard `{ name, description, image: <shelbyUrl> }`
      JSON, host it on Shelby, surface the `tokenURI`-ready URL. (No minting.)
- [ ] Polish the **DAA onboarding**: clear copy on the signature prompt ("Sign to create
      your Shelby storage account — no new wallet, no seed phrase").
- [ ] (Stretch) **Solana path** via `@solana/wallet-adapter` + `solana-kit`, reusing the
      same `StorageProvider` seam. Only if Ethereum is fully done.
- [ ] Copy/positioning pass: "capability demo," never "durable hosting."

**GATE 3:** a stranger can watch a 60–90s run and immediately grok: *my existing wallet
just put media on decentralized storage that loads faster than IPFS.*

---

## Week 4 — Harden, record, submit

**Objective:** ship the submission; be wipe-proof.

- [ ] **Record the full demo** (screen capture with audio narration). Do this early and
      often — the network can wipe before your final take.
- [ ] Fallback rehearsal: prove the demo still runs on `mock`/MinIO if `shelbynet` dies,
      so a live demo can't hard-fail.
- [ ] README for judges: what it is, why only Shelby enables it (DAA + hot reads),
      honest limitations, how to run. Link the video.
- [ ] Submit to the Shelby/Aptos builder program; post in the Shelby Discord for
      feedback and visibility.
- [ ] File any Shelby API friction as feedback (there's an `sdk-feedback` reference in
      the skills) — ecosystem programs value signal from real builders.

**GATE 4 (Definition of Done, `knowledge/01` §5):** recorded end-to-end run + running
app behind the `StorageProvider` seam + latency proof + NFT-metadata URL + honest
writeup. (+ Solana if it landed.)

---

## If you're on the 2-week track (compressed)

Cut ruthlessly: **images only** (skip video/Probe 4), **Ethereum only** (skip Solana),
skip the gallery polish. Keep the non-negotiables: DAA upload, one great latency
comparison, NFT-metadata URL, and a **recorded** run. A tight single-flow demo beats a
broad half-working one.

## Standing rules across all weeks

- Never break the `StorageProvider` seam for a "quick" direct Shelby call in the UI.
- Never ship secrets to the browser (see `03-conventions.md`).
- Re-verify against the live skill/docs whenever a Shelby call misbehaves — assume the
  API moved before assuming your logic is wrong.
- Keep a running `NOTES.md` of confirmed signatures, endpoints, and quirks you hit;
  future-you and the docs-lag will thank you.
