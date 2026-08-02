# Guide 01 · Verification First (run this before building anything)

**This is the most important guide in the repo.** Vessel rests on assumptions that must
be proven in a terminal, not reasoned about. Do **not** write UI until the gates below
pass. If a gate fails, apply the mapped kill/fallback from `knowledge/01-product-brief.md`
§7 and **report a go/no-go to the user** with the evidence (commands + outputs).

Work top-to-bottom. Each probe has a **goal**, **how**, and a **PASS/FAIL gate**.
Capture outputs (copy terminal text, save responses) as you go.

---

## Pre-flight (30 min)

- [ ] **Complete `guides/00-setup.md` first** — it installs the official Shelby skill
      plugin, CLI, and SDK/kits, and sets up API key / endpoints / faucet. Everything
      below assumes it's done.
- [ ] Confirm you've read `shelby-ethereum-kit` and `shelby-sdk` from the installed skill.
- [ ] Open live docs: `https://docs.shelby.xyz` → SDK, ethereum-kit, s3-gateway,
      Networks, Quickstart. **Pin the exact package versions you installed.**
- [ ] `node -v` (LTS), `pnpm -v`. Create a scratch dir; don't build the app yet.

---

## Probe 0 — CLI smoke test (prove the network is alive) · ~30 min

**Goal:** confirm `shelbynet`/testnet is up and a basic write→read works at all, before
any DAA/gateway complexity.

**How** (confirm exact commands in the `shelby-cli` skill / `docs.shelby.xyz/tools/cli`):
```bash
pnpm add -g @shelby-protocol/cli         # or npm/yarn/bun
shelby --version                          # confirms install
shelby init                               # follow prompts; creates an account/context
# fund the account (CLI prints a faucet/aptos fund command)
echo "hello shelby" > hello.txt
shelby upload hello.txt                   # ⚠️ confirm exact subcommand/flags in skill
shelby ls                                 # list blobs
shelby download <blob-name> out.txt       # read it back
cat out.txt                               # expect: hello shelby
```

**GATE 0:** round-trips (upload → list → download, bytes match).
- FAIL → network is down or wiped mid-setup. Retry; if persistently unusable → **K3**
  (network too unstable) → escalate.

---

## Probe 1 — Read latency vs IPFS (prove "hot") · ~45 min

**Goal:** confirm reads are *visibly* fast — this is the demo's proof shot. If reads
aren't fast/stable, the whole value prop weakens (**K2**).

**How:**
```bash
# Upload a realistic asset (e.g. a 2–5 MB JPG/PNG).
shelby upload sample.jpg
# Time N sequential reads from Shelby (via CLI download or a direct RPC/gateway GET).
# Then upload the same file to an IPFS pinning service and time reads from a public
# IPFS gateway. Compare median latency (warm and cold).
```
Record: median Shelby read latency, median IPFS read latency, and whether Shelby reads
are **consistent** (no big tail spikes) over ~20 reads.

**GATE 1:** Shelby median read is **clearly faster** than the IPFS gateway (target
sub-second for a few-MB asset) **and** consistent enough to demo live.
- FAIL (slow or spiky) → **K2**. Consider images-only demo; if even that is unstable →
  escalate.

---

## Probe 2 — Ethereum DAA works (prove the differentiator) · ~2–3 h

**Goal:** confirm an **Ethereum wallet signature can derive and control a Shelby storage
account**, and write a wallet-owned blob. This is **K1** — the make-or-break probe.

**How** (against the `shelby-ethereum-kit` skill — the signatures below are shape only):
```ts
// scratch/daa-probe.ts  — SHAPE ONLY; confirm every name/param in the skill/docs.
import { Shelby, Network } from "@shelby-protocol/ethereum-kit/node"; // ⚠️ VERIFY path
// Use a throwaway EOA private key for the probe (a stand-in for MetaMask), via
// ethers/viem — confirm what signer type the kit expects.
const shelby = new Shelby({ network: Network.TESTNET, /* rpc/connection */, apiKey: process.env.SHELBY_API_KEY });
const storageAccount = shelby.createStorageAccount(walletSigner, "vessel.demo"); // ⚠️ VERIFY
// Fund the derived Aptos account if required (faucet/sponsor). ⚠️ VERIFY — may block.
await shelby.upload({
  blobData: new TextEncoder().encode("owned-by-eth-wallet"),
  signer: storageAccount,
  blobName: "daa-probe.txt",
  expirationMicros: Date.now() * 1000 + 86_400_000_000,
});
// Read it back (kit read URL / RPC). Confirm bytes + that the blob lives under the
// wallet-derived account namespace.
```

Answer explicitly and write it down:
- What **signer** does the Ethereum kit take (ethers signer / viem / wagmi / raw sign)?
- Does deriving the account require a **user signature**? What message is signed?
- How does a **brand-new derived Aptos account get funded** on this network?
- Does the written blob live under the **wallet-derived namespace** (proving ownership)?

**GATE 2:** an ETH-wallet-derived account writes and reads a blob it owns.
- FAIL → **K1**. Try **Solana DAA** (Probe 2b, same shape via `solana-kit` — verified
  shape). If Solana works, reframe demo to Solana-first. If neither → escalate before
  building a weaker app-custodied version.

---

## Probe 3 — Gateway ↔ DAA namespace interop (decides the read path) · ~1–2 h

**Goal:** answer the `knowledge/05` §2 question — can the **gateway** read/serve an
object that the **DAA kit** wrote (same namespace), and vice versa?

**How** (server-side; gateway uses SigV4 shared secrets — never in browser):
```ts
// scratch/gateway-probe.ts — confirm endpoint/region/bucket semantics in s3-gateway docs.
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
const s3 = new S3Client({
  endpoint: process.env.SHELBY_S3_ENDPOINT,   // ⚠️ VERIFY
  region: "auto",                             // ⚠️ VERIFY
  credentials: { accessKeyId: process.env.SHELBY_S3_KEY!, secretAccessKey: process.env.SHELBY_S3_SECRET! },
  forcePathStyle: true,
  // ⚠️ disable MD5/checksum response validation (ETag = merkle root, not MD5)
});
// 1) Try to GET the blob written by the DAA kit in Probe 2 (map its name → S3 key).
// 2) PutObject via gateway, then try to read it via the DAA kit/RPC.
// Observe: same namespace? 409 semantics? ETag = merkle root (not MD5)?
```

**GATE 3:** determine one of:
- **Interop = yes** → hybrid is clean: **write via kit, read/serve via gateway.**
- **Interop = no** → **write via kit, read via kit/RPC read URL**; gateway = tooling only.
Record the decision; it configures `ShelbyGatewayProvider` vs `ShelbyDaaProvider` read
paths in `guides/03-conventions.md`.

Also confirm here:
- [ ] ETag mismatch handling needed (disable client MD5 check).
- [ ] 409-on-overwrite confirmed → key scheme must avoid in-place overwrite.
- [ ] `CopyObject` unsupported (don't use it).

---

## Probe 4 — Media limits (only if video is in scope) · ~1–2 h

**Goal:** confirm whether short video is demo-able on the current network, or whether we
stay images-only.

**How:** upload a short (5–15 s) clip; attempt **range reads** / streamed playback via
`@shelby-protocol/player`; check whether `@shelby-protocol/media-prepare` (CMAF/HLS) is
needed; confirm **max blob size / multipart** behavior.

**GATE 4:** short video uploads and plays back acceptably.
- FAIL → drop video from Definition of Done; demo **images only** (still fully valid).

---

## Decision summary to report to the user

After the probes, produce a short go/no-go with:

| Probe | Result | Consequence |
|---|---|---|
| 0 CLI round-trip | pass/fail | build vs K3 |
| 1 read latency vs IPFS | pass/fail + numbers | proof shot vs K2 |
| 2 ETH DAA (K1) | pass/fail | differentiator vs Solana pivot/escalate |
| 3 gateway↔DAA interop | yes/no | read path config |
| 4 video (optional) | pass/fail | video vs images-only |

**Green-light rule:** proceed to `guides/02-build-plan.md` only if **Probe 0 and (Probe 2
OR its Solana variant)** pass. Everything else shapes scope but isn't fatal.
