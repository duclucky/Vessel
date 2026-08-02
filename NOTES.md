# NOTES.md — Confirmed Shelby signatures, endpoints, quirks

> Every entry below was **verified this session (2026-08-02)** against the installed
> packages, the cloned official skill (`github.com/shelby/shelby-skills`), live docs
> (`docs.shelby.xyz`), or live on-chain/RPC calls to `shelbynet`. Where a knowledge/
> file conflicts with this, **this file wins** (per README ground-truth policy).

## 0. Sources are real (verified)
- npm `@shelby-protocol/*` published by `shelby-xyz <eng@shelby.xyz>` via GitHub Actions
  OIDC; repo `github.com/shelby-protocol/shelby`; all modified 2026-07-30.
- Skills repo `github.com/shelby/shelby-skills` (org `shelby`) cloned — has
  `.claude-plugin/plugin.json` + `skills/shelby-{sdk,ethereum-kit,solana-kit,cli,media}/`.
- Docs `docs.shelby.xyz` resolves.
- Two orgs, both real: `shelby` (skills/marketplace) vs `shelby-protocol` (monorepo).

## 1. Installed versions (pinned — docs LAG these)
| Package | Installed | Skill doc claims | Note |
|---|---|---|---|
| `@shelby-protocol/cli` (global) | 0.1.1 | — | `shelby --version` OK |
| `@shelby-protocol/ethereum-kit` | 0.1.11 | `^0.1.1` | node+react entries |
| `@shelby-protocol/sdk` | 0.4.1 | `^0.0.9` | node+browser+sp entries |
| `@aptos-labs/ts-sdk` | **6.3.1 (pinned)** | `^5.1.0` | **v7.x breaks** peer `^5.2.1 \|\| ^6.0.0` |
| `ethers` | 6.17 | — | ethereum-kit/node signer type |
- Tooling: node v24.11, npm 11.18, git 2.52, claude CLI 2.1.205. **No pnpm** → used npm.

## 2. Networks / endpoints (live-verified reachable)
- `Network.SHELBYNET = "shelbynet"` is the ONLY network enum in installed kit/sdk.
  ⚠️ `Network.TESTNET` (in knowledge/03 snippet) **does not exist** — do not use it.
- Fullnode `https://api.shelbynet.shelby.xyz/v1` → 200
- Shelby RPC base `https://api.shelbynet.shelby.xyz/shelby/v1`
- Indexer (GraphQL) `https://api.shelbynet.shelby.xyz/v1/graphql`
- Faucet `https://faucet.shelbynet.shelby.xyz`
- Shelby deployer/contract `SHELBY_DEPLOYER = 0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a`
  (matches knowledge/02 ✅). Exported as `SHELBY_DEPLOYER` from `@shelby-protocol/sdk/node`.

## 3. Faucet (programmatic — important)
- `POST https://faucet.shelbynet.shelby.xyz/fund` body `{"address":"0x..."}` → `{"txn_hashes":[...]}` (funds APT).
- Kit/SDK: `fundAccountWithAPT({address,amount})` and `fundAccountWithShelbyUSD({address,amount})`
  (testnet-only). **This resolves the knowledge/03 §5 "funding UX" Day-1 blocker.**
- ⚠️ **RATE LIMIT: 10 requests/day/IP** → `UsageLimitExhausted`. Each `fund*` call = 1 request
  (funding one account = 2). Get an `AG-…` API key to raise limits. **Hit this cap this session.**
- ShelbyUSD faucet credit is **capped at 10,000,000** regardless of requested `amount`.

## 4. ShelbyUSD fungible asset (shelbynet, live)
- Actual FA metadata address (from indexer): `0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1`.
- ⚠️ Skill doc constant `SHELBYUSD_TOKEN_ADDRESS = 0x249f5c642a63885ff88a5113b3ba0079840af5a1357706f8c7f3bfc5dd12511f` — **stale / differs** on this network. Query the chain, don't hardcode.

## 5. ethereum-kit — CONFIRMED runtime API (`@shelby-protocol/ethereum-kit/node`)
```
new Shelby({ network: Network.SHELBYNET, apiKey?, gasStationApiKey?, locationHint? })
Shelby.createStorageAccount(ethersWallet: ethers.Wallet, domain: string, scheme?="https")
   -> ShelbyStorageAccount { accountAddress: AccountAddress, ethereumWallet, domain, scheme,
      derivedPublicKey, authenticationFunction }   // extends EIP1193DerivedAccount (SIWE/DAA)
Shelby.fundAccountWithAPT({ address, amount }) / fundAccountWithShelbyUSD({ address, amount })
Shelby.upload({ blobData: Uint8Array, signer: storageAccount, blobName, expirationMicros, options? })
Shelby.download({ account: AccountAddress, blobName, range? }) -> { readable: ReadableStream, contentLength }
```
- Runtime-verified methods present: createStorageAccount, fundAccountWithAPT, fundAccountWithShelbyUSD,
  upload, batchUpload, download, waitForRegistration, signChallenge.
- React: `useStorageAccount({ client: ShelbyClient, wallet })` → `{ storageAccountAddress,
  signTransaction, submitTransaction, signAndSubmitTransaction }`. `ShelbyClient` from
  `@shelby-protocol/sdk/browser`. Upload via `useUploadBlobs` (`@shelby-protocol/react`) with
  `signer: { account: storageAccountAddress, signAndSubmitTransaction }`.
- `wallet` for the hook = wagmi `useWalletClient()` data ({ account:{address}, request(...) }).

## 5b. ⚠️⚠️ CRITICAL — DAA write path: TWO real gaps in current published packages (SOLVED here)

The Node DAA upload (`ethereum-kit@0.1.11` + `sdk@0.4.1`) does NOT work out of the box.
Two independent problems, both diagnosed and worked around this session:

**(A) Split `@aptos-labs/ts-sdk` version breaks DAA on-chain auth.**
- `ethereum-kit` → `derived-wallet-ethereum@0.9.2` → `ts-sdk@5.2.1` (signs the DAA/abstraction authenticator).
- `sdk@0.4.1` → `ts-sdk@6.3.1` (builds/serializes the transaction).
- With the split, EVERY DAA-authored txn aborts in the **prologue** at
  `0x1::ethereum_derivable_account::authenticate` → `Execution ABORTED`, `gas_used:0`
  (even a trivial 1-octa self-transfer). Not a funding/location/logic issue.
- **FIX:** force a single ts-sdk across the tree. `package.json`:
  `"overrides": { "@aptos-labs/ts-sdk": "5.2.1" }` (sdk peer allows `^5.2.1`).
  After this, DAA trivial transfer AND `register_blob` **execute successfully on-chain**
  (verified: real submit, `Executed successfully`, gas_used ~5172, tx `0x078d83…`).

**(B) `signChallenge` can't serialize the abstract (DAA) public key.**
- After (A), upload proceeds to `putBlobChunksets` → RPC `signChallenge`, which does
  `account.publicKey.toUint8Array()`. For a DAA account that is an `AbstractPublicKey`
  whose `serialize()` throws `"not implemented for AbstractPublicKey"`.
- The SDK's `ShelbyRPCClient` accepts `options.signChallengeHandler` ("intended for
  kit-level overrides (e.g. Solana DAA)") — but **ethereum-kit 0.1.11 does NOT wire one
  up** (kit dist has no ShelbyRPCClient/signChallenge reference). This is an upstream gap.
- **WORKAROUND (faithful, uses kit primitives):** patch `shelby.rpc.signChallenge` to
  return `{ challenge, signature: await account.sign(bytes), publicKey:
  sa.derivedPublicKey.toUint8Array() }`. `sa.derivedPublicKey.toUint8Array()` works (78 bytes).
  This got past the serialize error and reached the RPC challenge call successfully.
  → File as `sdk-feedback`: ethereum-kit should ship a `signChallengeHandler`.

**(C) Anonymous rate limits gate everything — an `AG-` API key is effectively required.**
- Faucet: **10 requests/day/IP** (`UsageLimitExhausted`).
- RPC: **40000 compute units / 300s / anonymous IP** (`429` on `/v1/auth/challenge`).
- Both are why setup docs say "get an API key." For a clean end-to-end + demo, GET AN `AG-` KEY.

**Net:** DAA derivation ✅, funding ✅, on-chain control ✅ (fix A), byte-upload auth ✅
structurally (workaround B). Full recorded green run pending a non-rate-limited run
(API key, or wait out the 300s window). K1 differentiator is essentially proven.

## 5c. ⚠️⚠️ NETWORK × SDK-VERSION × API-KEY MATRIX (the real end-to-end blocker)

The platform is mid-migration; the two live networks run DIFFERENT contract versions,
and the geomi API key only works on one of them. Verified 2026-08-02:

| | **shelbynet** | **testnet** |
|---|---|---|
| RPC | `api.shelbynet.shelby.xyz/shelby` | `api.testnet.shelby.xyz/shelby` |
| Fullnode | `api.shelbynet.shelby.xyz/v1` (isolated validators) | `api.testnet.aptoslabs.com/v1` (std Aptos testnet) |
| Contract (`0x85fd…`) | **newest**: has `location` module; `register_blob` takes `Option<String>` selectedLocation + locationHint | **older**: NO `location` module; `register_blob(String,u64,vector<u8>,u32,u64,u8,u8)` — no location args |
| Matching SDK | `sdk@0.4.1` (latest) ✅ | needs a version between 0.0.9 and 0.4.1; `0.0.9` errors `Unsupported network: testnet`; `0.4.1` sends string location → `Cannot convert … to BigInt` |
| geomi API key (`aptoslabs_*`) | **REJECTED** 401 "API key not found" (both RPC + fullnode) | **ACCEPTED** ✅ (RPC challenge 200, fullnode 200) |
| Anonymous RPC | 429 (40k CU/300s, globally saturated — idle-for-hours still 429) | n/a (key works) |

**Consequence:** no single (network, sdk, key) combo currently gives a clean keyed
end-to-end:
- **shelbynet** = SDK+contract align and all my fixes work (DAA on-chain tx CONFIRMED),
  but anonymous-only + rate-limited, and the geomi key is rejected.
- **testnet** = key works + more stable (not weekly-wiped), but its older contract
  matches no cleanly-installable published SDK version found this session.
- geomi.dev issues keys formatted `aptoslabs_*` (NOT `AG-`; knowledge files stale) and,
  per the acquire-api-keys page, for network **Testnet**.

**ACTION OPTIONS (pick with user):**
1. Get a **shelbynet-scoped** key (if geomi offers that network) → shelbynet is instantly
   green with sdk@0.4.1 + ts-sdk@5.2.1 override + signChallenge patch + `selectedLocation:"shelbynet-1"`.
2. Find the sdk version whose `register_blob` matches the **testnet** contract (no location
   args) AND supports `Network.TESTNET`; run on testnet with the working key.
3. Ask Shelby (Discord / builder program) which (network, sdk, key) they bless right now.
4. Build the app on the **mock** provider per plan; drop in the captured working recipe
   once the matrix aligns. (StorageProvider seam makes this a 1-file swap.)

## 5d. ⚠️⚠️⚠️ DEFINITIVE BLOCKER — ETH-DAA byte-upload has no working client impl

With a **shelbynet-scoped** geomi key (`aptoslabs_*`, created for network shelbynet):
- Key accepted on shelbynet (fullnode 200, RPC `/auth/challenge` 200). **Rate limit gone.**
- `register_blob` now **executes on-chain with the key** (past auth, past rate limit). ✅
- Upload then reaches `putBlobChunksets → buildAuthHeaders`, which needs the RPC
  **"derivable" auth scheme**: `{ challenge, signature, publicKey, authScheme:"derivable",
  identity, domain, authFunction }` (headers `X-Shelby-Challenge/-Signature/-Public-Key/
  -Auth-Scheme/-Auth-Function` + identity/domain).
- The built-in `signChallenge` does `account.sign(bytes)` + `account.publicKey.toUint8Array()`.
  For a DAA account: `sa.sign(bytes)` returns a **1-byte placeholder** (its `.sign` is for
  txn authenticators, not raw challenge bytes) and `publicKey` is an `AbstractPublicKey`
  whose `serialize()` throws. So the default path cannot produce a valid challenge auth.
- **No "derivable" challenge builder exists in ANY installed package** — verified by
  grep across `@shelby-protocol/sdk@0.4.1`, `ethereum-kit@0.1.11`, `react@3.0.1`, and
  `@aptos-labs/derived-wallet-ethereum` (it has SIWE/`createSiwe` primitives, but nothing
  wires them to the RPC challenge). The RPC supports the scheme; **the client doesn't build it.**
- `sa.derivedPublicKey` DOES carry `{domain, ethereumAddress, authenticationFunction}` and
  serializes to 78 bytes — the identity bundle — but the exact SIWE-over-challenge message
  the RPC verifies is **undocumented**. Reproducing it = fabricating a Shelby call → NOT DONE.

**CONCLUSION:** wallet-owned **media byte-upload via Ethereum DAA is not completable with
the current published Shelby client stack.** On-chain ownership (register_blob) works;
pushing the bytes does not. This is an **upstream gap** (ethereum-kit should ship a
`signChallengeHandler`; the SDK comment even says handlers are "intended for kit-level
overrides, e.g. Solana DAA"). Same broken path in browser/React (WalletAdapterSigner has
no `.sign()` either). → **K4-adjacent. File as sdk-feedback; escalate to Shelby.**

Proven regardless: DAA derivation, funding, and **on-chain wallet control** (real txns).
The differentiator's *ownership* claim is demonstrable; the *hot-storage media serve* via
ETH DAA is blocked until Shelby ships the derivable challenge handler (or we use the
Solana kit, which the SDK hints already wires one).

## 5e. Solana DAA path — different upstream bug (register real-submit aborts)

Tried Solana DAA as the K1 fallback (solana-kit@0.2.10 + sdk@0.4.1 + ts-sdk@5.2.1, shelbynet key):
- solana-kit **DOES ship the `signChallenge` derivable override** ethereum-kit lacks
  (returns `{challenge, signature, publicKey:solanaPubkey.toBytes(), authScheme:"derivable",
  identity, domain, authFunction}`) — so the chunkset-auth that blocks Ethereum is solved here.
- Solana DAA on-chain auth WORKS: real 1-octa self-transfer executed (`0xdff77…`, gas 445).
- `register_blob` **simulates success** (gas 5992, location applied) but **real-submit
  aborts 4016** — consistently, regardless of `orderless` true/false or location option.
- Ethereum `register_blob` real-submits fine at the same time (network healthy) → this is
  **Solana-DAA-specific**: the register txn's on-chain signature verification fails for the
  Solana derivable account (sim skips sig check; simple transfers use a different path that works).

**BOTTOM LINE — both DAA byte-write paths blocked by DISTINCT upstream client bugs:**
| Path | derive | fund | on-chain auth | register_blob | byte upload (chunkset) |
|---|---|---|---|---|---|
| **ETH DAA** | ✅ | ✅ | ✅ | ✅ | ❌ ethereum-kit has NO derivable `signChallenge` handler |
| **SOL DAA** | ✅ | ✅ | ✅ (transfer) | ❌ real-submit 4016 (sim ok) | (handler exists, but never reached) |

Neither completes a wallet-owned media upload on the current published stack. The
differentiator's **ownership/auth is proven on-chain**; the media byte-store via DAA is not
completable today. → File BOTH as sdk-feedback; escalate to Shelby. K1/K4.

**A native (non-DAA) Aptos `Account` would complete the full upload** (its `signChallenge`
works: real Ed25519 pubkey+sign) — usable to prove Probe 0 (round-trip) + Probe 1 (latency
vs IPFS) end-to-end, just without the wallet-ownership story. Needs one faucet-funded account.

## 5f. ✅ GREEN — storage + read + latency proven (native account)

First fully-green end-to-end on shelbynet, via a **native Aptos `Account`** (Ed25519,
non-DAA — reliable signing, avoids the DAA abstraction-signing instability):
- Uploaded a **1.1 MB PNG** (`ShelbyNodeClient.upload`, `selectedLocation:"shelbynet-1"`,
  API key) → OK in ~4.85s (first try).
- Read back **byte-exact** via SDK `download` AND via public HTTP URL (200).
- **Shelby read latency (20 reads, 1.1 MB): median 378 ms, min 332 ms, p90 1164 ms, max 1509 ms.**
  Real & repeatable; tail spikes expected on the single-RPC prototype.
- ⚠️ **Reads need the API key** (Bearer) on shelbynet — anonymous reads are rate-limited.
  The "stable resolvable URL" is therefore key-gated → serve via a thin server proxy in the app.
- ⚠️ **IPFS side-by-side NOT validly done**: a public-gateway fetch of a *different* CID
  returned ~2 ms (edge-cached) — meaningless as a comparison. A fair Probe-1 needs the SAME
  asset pinned to IPFS (pinning-service key) — do in the build phase.

**Net proven state:** storage/serve layer works (Probe 0 ✅, Probe 1 Shelby-side ✅);
DAA *ownership* proven on-chain (both chains sign real txns); DAA *byte-upload* blocked
upstream (5b/5d/5e). Native run artifacts saved: `scratchpad/vessel-probe/demo-image.png`,
`last-run.json`.

## 5g. ✅✅✅ BREAKTHROUGH — FULL DAA byte-upload WORKS (Solana, testnet)

The DAA question, answered by doing (2026-08-03):

**Ethereum DAA byte-upload = impossible on ANY network.** Verified by inspecting the dist of
EVERY published `ethereum-kit` (0.1.1 → 0.1.11): none wire the `signChallenge` / derivable
handler. Network-independent client gap. shelbynet and testnet both blocked. Dead end.

**Solana DAA byte-upload = WORKS end-to-end on testnet.** ✅ Real run:
- Combo: **`@shelby-protocol/solana-kit@0.2.8` + `@shelby-protocol/sdk@0.3.1` + ts-sdk 5.2.1 + `Network.TESTNET`**.
  - solana-kit 0.2.8 is the first with the `signChallenge` derivable handler (sdk-dep 0.3.1).
  - sdk 0.3.1 supports `testnet` AND predates the `location` feature → matches testnet's
    (older) contract; NO `selectedLocation`/`locationHint` option is passed.
- Solana keypair → derived Aptos storage account `0x44d487…` (auth `0x1::solana_derivable_account::authenticate`).
- `shelby.upload({ signer: storageAccount, ... })` → **UPLOAD OK (~6.5s)**; read back via SDK
  AND public HTTP (`api.testnet.shelby.xyz/shelby/v1/blobs/<daaAcct>/<name>`, keyed) → **byte-exact**.
- **The blob is owned by the Solana wallet's DAA account** — the true differentiator, fully realized.

**Funding (testnet, manual — no programmatic mint):**
- APT: https://aptos.dev/network/faucet (JWT/captcha-gated; can't script).
- ShelbyUSD: https://docs.shelby.xyz/apis/faucet/shelbyusd (React component; no public API).

**Network/key notes:** testnet key is a SEPARATE geomi `aptoslabs_*` key (testnet-scoped);
shelbynet key is rejected on testnet and vice-versa. testnet is NOT weekly-wiped (more stable).

**⇒ Recommended real-DAA path for the demo: Solana wallet (Phantom) → DAA → testnet.**
Ethereum stays connect+ownership-proof only (byte-upload via server) until Shelby ships the
ethereum-kit challenge handler. Build a `ShelbySolanaDaaProvider` (or client-side upload via
`solana-kit` react) to make the stored bytes genuinely wallet-owned.

## 5h. ✅ Client-side sovereign upload (each visitor owns) — built, testnet, mainnet-shaped

Realizes the true differentiator: the visitor's OWN Phantom wallet owns + pays for storage.
- **Vanilla, no React** (design preserved): replicated `solana-kit/react`'s thin logic using
  `@aptos-labs/derived-wallet-solana` primitives — `SolanaDerivedPublicKey` (derive) +
  `signAptosTransactionWithSolana` (Phantom SIWS signing) — plus a Phantom-based `signChallenge`
  handler for the RPC byte-upload. Uses `@shelby-protocol/sdk/browser` `ShelbyClient.upload`.
- Bundled with esbuild (`client-src/vessel-solana.js` → `public/vessel-solana.js`, ~2.3 MB,
  node polyfills). `window.VesselSolana = { connect, balances, upload, readUrl, faucets }`.
- **Derivation verified**: pubkey `oxnn…vEK` + domain `vessel.demo` → `0x44d4…` (matches the
  account proven in 5g). Signing path = same primitives as the proven node run.
- **Mainnet-shaped**: switch network in the `NETWORKS` map (client) + backend — sign/own/pay
  flow is identical; testnet only differs by the one-time faucet (mainnet = real balance).
- **Anonymous testnet RPC** (reads+writes) → no server secret in the browser; each visitor's
  blobs read from their own account namespace directly.
- Upload page: Phantom present → sovereign client upload (funding-gate panel if unfunded);
  else server fallback. Identity page: Phantom → shows the visitor's OWN account.
- ⚠️ Not headless-testable (needs a real Phantom extension) — code matches proven paths; the
  human runs the final live Phantom test.

## 5i. ✅✅✅ SPONSORED upload PROVEN — customer needs ZERO Aptos tokens (Cách B)

The "app sponsors, customer owns" model works end-to-end on testnet (verified 2026-08-03):
a **completely empty** customer DAA account (0 APT, 0 ShelbyUSD) uploaded a blob it OWNS,
signing only with its Solana wallet. Gas station paid APT + ShelbyUSD.

**Recipe (undocumented — figured out empirically):**
1. Client: `new Shelby({ network: TESTNET, connection, apiKey, gasStationApiKey })` — the
   gas-station key installs a `TRANSACTION_SUBMITTER` (Aptos gas station) as fee payer.
2. `upload({ signer: customerDaaAccount, blobName, expirationMicros, options: {
     usdSponsor: { feePayerAddress: GAS_STATION_ACCOUNT }, build: { withFeePayer: true } } })`
   - `usdSponsor` → uses `register_blob_with_sponsor` (multi-agent: sender + sponsor).
   - `build.withFeePayer: true` → REQUIRED, else "must have a fee payer for gas station".
   - `usdSponsor.feePayerAddress` MUST be the **gas station's own fee-payer account** (the SDK
     errors telling you the required address, e.g. `0x9da754…`), NOT your own account. That
     account co-signs as BOTH fee payer (APT) AND USD sponsor (ShelbyUSD).
3. **One-time server setup: fund the gas station's fee-payer account with ShelbyUSD** (it pays
   storage as the sponsor). Transfer via `0x1::primary_fungible_store::transfer<Metadata>`
   (`SHELBYUSD_FA_METADATA_ADDRESS` = `0x1b18363a…`). Gas station config already funds its APT.
4. Customer signs (SIWS via Phantom / keypair). Blob owned by customer's derived account,
   readable anonymously at `…/blobs/<customerAcct>/<name>`.

**Config used:** gas station created at geomi.dev for module `0x85fd…::blob_metadata`, allow
`register_blob_with_sponsor` + `register_multiple_blobs_with_sponsor`, SKIP SIMULATION on
(abstract accounts don't simulate), gas 28–250000, price 100–350.

**Note:** gasStationApiKey is a sponsorship key (function-restricted + rate-limit/recaptcha
options) → CAN be used client-side (recaptcha exists for exactly that), so the sponsored upload
can run fully in the browser with Phantom; or relay via server. The USDC payment (customer →
treasury on Solana devnet) gates the upload and is verified server-side.

**Still to build:** (1) USDC payment + server verification, (2) wire client-side Phantom sign +
sponsored upload into the app. Core (the hard multi-agent+gas-station+DAA composition) is proven.

## 6. ⚠️ CRITICAL UNDOCUMENTED QUIRK — `locationHint` is REQUIRED to write
- Without it, `upload()` throws `E_NO_LOCATION_SELECTED`:
  *"No write location could be resolved: none was selected and the account has no default
  location or location hint."* (NOT in any skill doc.)
- Fix: pass `locationHint` in `ShelbyClientConfig` (feeds `defaultOptions.locationHint`).
- Discover valid names via view: `${DEPLOYER}::location::activated_location_names`.
  **Live result today: `[["shelbynet-1"]]`.** → use `locationHint: "shelbynet-1"`.
- (On the DAA path the same missing-location surfaced earlier as an on-chain Move abort
  `vm_error_code 4016` at `registerBlob`; the native path surfaced the readable message.)

## 7. Read path (no wallet needed)
- Public HTTP GET: `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/{accountAddress}/{blobName}`
  (confirmed in skill "HTTP Access" + kit upload example). **This is the intended read/serve URL.**
- ⇒ Probe-3 leaning: **write via kit, read/serve via this RPC HTTP URL**; S3 gateway optional.

## 8. S3 gateway (from docs.shelby.xyz/tools/s3-gateway)
- Self-hosted server: `@shelby-protocol/s3-gateway` (v1.2.1), runs `localhost:9000`, points at RPC.
- SigV4 region = `shelbyland`. Bucket = S3 alias for a Shelby account; config sets
  `accountAddress` → so a bucket CAN point at a DAA-derived account (interop possible in principle).
- accessKeyId/secretAccessKey = self-defined shared secrets in `shelby.config.yaml` (NOT AWS, NOT wallet).
- Presigned URLs: not confirmed. ETag=merkle-root / 409-on-overwrite / no CopyObject: from
  knowledge/04, NOT live-verified this session.

## 9. Core SDK (`@shelby-protocol/sdk/node`) — confirmed
- `ShelbyNodeClient(config, provider?)` (browser: `ShelbyClient` from `/browser`).
- Instance shape: `{ coordination, metadata, rpc, config, aptos, _provider }`.
- List: `client.coordination.getAccountBlobs({ account, pagination })` → items have
  `blobNameSuffix` (use this), `creationMicros`, `expirationMicros`, `size` (µs timestamps).
- Delete: `client.coordination.deleteBlob({ account: signer, blobName })`.
- Error guards: `isBlobAlreadyExistsError`, `isAccessDeniedError`, `isBlobNotFoundError`,
  `isBlobExpiredError`, `StaleChannelStateError` (all from `@shelby-protocol/sdk`).
- Micropayment channels (`ShelbyMicropaymentChannelClient`) are the **download/read** payment
  path, not needed for the high-level `upload()`.

## 10. CLI (`shelby`) — confirmed syntax
- `shelby upload <source> <dest> -e "<expiration>"` — **-e REQUIRED**; formats: natural
  language ("in 7 days"), ISO date/datetime, unix seconds. **`7d`/`24h` NOT supported.**
- `shelby download <source> <dest>`; `shelby delete <dest>`; `shelby account {create,list,use,balance,blobs}`;
  `shelby context {create,list,use}` (`--network shelbynet|local`); `shelby faucet` (interactive/browser).
- `shelby init` is interactive (network + account prompts); account/context subcommands are non-interactive.
- No config until `shelby init` run (`~/.shelby/config.yaml`).

## 11. Aptos ts-sdk gotcha
- Custom endpoint requires `new AptosConfig({ network: Network.CUSTOM, fullnode, indexer })`
  (else: "Custom endpoints require a network to be specified"). Indexer URL needed for FA-balance queries.

## 12. What is NOT yet observed (honest gaps → see go/no-go)
- A **successful upload + read-back** was NOT observed — blocked solely by faucet 10/day cap
  after the `locationHint` fix was identified/applied. Everything upstream (derivation, funding,
  DAA auth reaching Move execution, valid activated location) is verified.
- Probe 1 (latency vs IPFS) not run — needs one written blob first.
- Probe 4 (video) not attempted.

## 5j. ✅✅✅ PHANTOM + SPONSORED PROVEN — customer owns, ZERO tokens, gas station key stays SERVER-SIDE

The path the user chose (Phantom + Cách B). Two "sync-vs-async" walls found & solved (verified 2026-08-03,
headless, mimicking Phantom via a keypair-backed `signMessage` — identical bytes Phantom produces):

**Wall 1 — on-chain register (multiAgent `register_blob_with_sponsor`):** SDK's high-level path calls
`aptos.signAndSubmitTransaction({signer: account})` which needs a SYNC `Account.signTransactionWithAuthenticator`
(nacl + secretKey). Phantom = async, no secret key → cannot. **Solved:** override
`client.coordination.aptos.signAndSubmitTransaction` → build the multiAgent txn, produce the SENDER
authenticator async via `signAptosTransactionWithSolana({rawTransaction, solanaWallet, ...})`, then submit
via `GasStationClient.signAndSubmitTransaction({transaction, senderAuthenticator})` (from
`@aptos-labs/gas-station-client`) — the gas station co-signs BOTH fee-payer (APT) AND secondary/sponsor
(ShelbyUSD, its own acct 0x9da754). Sender signs over feePayer=0x0 (standard sponsored scheme); gas station fills it.

**Wall 2 — byte-upload challenge:** `rpc.putBlobResumable` calls `signFn(account, challenge)` WITHOUT await
→ challenge must be signed synchronously. Phantom async again. **Solved:** `getChallenge` IS awaited → override
`rpc.getChallenge` to fetch the challenge AND async-Phantom-sign it there, stash the auth; the sync
`signChallenge` just returns the stash. Fresh challenge, no double-fetch/nonce mismatch.

**validateUsdSponsorConfig** throws if `usdSponsor` set without a submitter. Since we override submit, pass a
dummy non-null `options.submit.transactionSubmitter = { submitTransaction: async()=>{} }` to pass the check.

**Final architecture (honors "secrets never in browser"):**
- CLIENT (Phantom, no secret key): derive DAA acct; `client.upload({signer:{accountAddress}, options:{usdSponsor:
  {feePayerAddress: GAS_STATION_ADDR}, build:{withFeePayer:true}, submit:{transactionSubmitter: dummy}}})` with the
  two overrides. Sender auth via Phantom; **serialize** txn (`MultiAgentTransaction.bcsToBytes()`, ~299B) +
  senderAuth (`AccountAuthenticator.bcsToBytes()`, ~230B) → POST to server. Byte-upload (challenge) done client-side.
- SERVER (holds gas station key): `POST /api/sponsor/submit {txnB64, senderAuthB64, uploadToken}` → verify token
  (paid) → `MultiAgentTransaction.deserialize` + `AccountAuthenticator.deserialize` → `GasStationClient
  .signAndSubmitTransaction(...)` → `{hash}`. **Gas station key never reaches the browser.**
- **Serialize→wire→deserialize round-trip PROVEN** (client→server hop simulated, submit still succeeds).
- Blob owned by customer's DAA acct, readable anonymously at `…/blobs/<custAcct>/<name>` byte-exact.
- USDC payment (Phantom→treasury on Solana devnet, memo=paymentId) gates the uploadToken. Only diff vs real
  Phantom: `signMessage` is keypair-backed here vs extension UI — identical signing bytes, same code path.

Proof: `scratchpad/vessel-tn-sol/phantom-sponsor.mjs`. Real runs: hashes 0xe71c…, 0xd395…, 0x2cb2…, 0x4385….
