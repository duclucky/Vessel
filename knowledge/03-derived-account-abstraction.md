# 03 · Derived Account Abstraction (DAA)

**Purpose:** DAA is *the* reason Vessel exists. This file explains the concept, why it's
the differentiator, and the SDK shape you'll code against. The concept here is stable;
the exact signatures are **⚠️ VERIFY** — read the official `shelby-ethereum-kit` skill
and `https://docs.shelby.xyz/sdks/ethereum-kit` before implementing.

---

## 1. The concept

**[VERIFIED]** Shelby uses **Derived Account Abstraction (DAA)** so that **wallets from
other chains (Ethereum, Solana) can derive and control a storage account on Aptos.**

In plain terms: the user keeps signing with the wallet they already have (MetaMask,
Phantom). That wallet's signing authority is used to **derive and authorize an Aptos-side
storage account** on Shelby. The user never creates an Aptos wallet, never writes down a
new seed phrase, and never bridges assets. The external wallet **is** the key to the
storage account.

**[ANALYSIS]** This is the emotional core of the demo: *connect MetaMask → you now own
and control decentralized hot storage on Aptos.* No other hot-storage protocol offers
this cross-chain wallet-native control. Protect this story; don't dilute it.

## 2. Why DAA (vs the alternatives) — for context

- **Vs. making users get an Aptos wallet:** kills the UX and the "cross-chain" claim.
- **Vs. app-custodied keys (e.g. gateway shared secrets):** works, but then *the app*
  controls storage, not the user's wallet — the differentiator evaporates. (This is the
  central tension resolved in `05-architecture.md`.)

DAA is what lets us claim **user-owned** storage while keeping **user-familiar** wallets.

## 3. The SDK shape (⚠️ VERIFY signatures against the official skill/docs)

Shelby publishes a `Shelby` client in the chain kits. The **Solana** kit's documented
usage looks like the following (**[VERIFIED]** shape from Shelby's Solana docs). The
**Ethereum** kit **mirrors this** (**⚠️ VERIFY** — same pattern, ethers/viem signer
instead of a Solana keypair):

```ts
// SHAPE ONLY — confirm names/params in the shelby-ethereum-kit skill + live docs.
import { Shelby, Network } from "@shelby-protocol/solana-kit/node";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com");

const shelby = new Shelby({
  network: Network.TESTNET,
  connection,
  apiKey: "AG-***",           // keep server-side; never ship to the browser
});

// Derive a Shelby storage account controlled by the external wallet:
const solanaKeypair = Keypair.generate();          // in reality: the user's connected wallet
const storageAccount = shelby.createStorageAccount(solanaKeypair, "my-app.com");

// Write a blob, signed by that storage account:
await shelby.upload({
  blobData: new Uint8Array([1, 2, 3]),
  signer: storageAccount,
  blobName: "example.txt",
  expirationMicros: Date.now() * 1000 + 86_400_000_000, // hot storage: blobs expire
});
```

**React** (**[VERIFIED]** shape): hooks like `useStorageAccount` come from the kit's
`/react` entry, and `ShelbyClient` from `@shelby-protocol/sdk/browser`; wire them under
the app's wallet connection.

```ts
// SHAPE ONLY.
"use client";
import { useStorageAccount, Network } from "@shelby-protocol/solana-kit/react";
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
// ...obtain the connected wallet from your wallet library, pass it in, get a storageAccount.
```

**For Ethereum (our primary), you must confirm in the `shelby-ethereum-kit` skill:**

1. Import path (likely `@shelby-protocol/ethereum-kit/node` and `/react`). **⚠️ VERIFY**
2. What "signer" the Ethereum kit expects — an `ethers`/`viem` signer? a wagmi
   connector? a raw personal-sign callback? **⚠️ VERIFY** — this determines how you wire
   MetaMask.
3. The exact `createStorageAccount(...)` (or equivalent) signature and what the second
   arg (`"my-app.com"` above — likely an app/domain identifier) means. **⚠️ VERIFY**
4. Whether the browser flow requires a **user signature prompt** to derive/authorize the
   account (expect yes) and what message is signed. **⚠️ VERIFY**
5. **Funding/gas:** the derived Aptos account still interacts with the Aptos contract
   (which needs gas) and pays Shelby storage. Confirm how a brand-new DAA account gets
   funded on `shelbynet`/testnet (faucet? sponsored? paid by the app?). **⚠️ VERIFY —
   this is a Day-1 blocker if unclear.**

## 4. What the browser flow probably looks like (⚠️ design hypothesis to confirm)

**[ANALYSIS]** Expected happy path — treat as a hypothesis to validate in Day-1
verification, not as gospel:

1. User clicks "Connect wallet" → `wagmi`/MetaMask connects; you get an address + a way
   to request signatures.
2. App calls the Ethereum kit to **derive the Shelby storage account** for that wallet;
   this likely triggers **one signature prompt** (deterministic derivation from the
   signature). You now hold a `storageAccount` handle bound to the user's wallet.
3. Ensure the derived Aptos account is funded (faucet/sponsor — see item 5 above).
4. Upload via the kit (`upload({...})`) or via the gateway (see `04` + `05`), producing a
   blob under the wallet's namespace.
5. Reads resolve via an RPC/gateway URL — no wallet needed to read (reads are paid by the
   reader/RPC, not gated by the owner's signature).

## 5. Security & handling rules

- **Never** put the Shelby `apiKey` or any gateway SigV4 secret in client-side code.
  Route privileged calls through a thin server proxy. The **user's wallet signature** is
  the only credential that should originate in the browser.
- Do not persist the user's derived account secrets anywhere; re-derive from the wallet
  as needed (confirm the kit supports deterministic re-derivation — **⚠️ VERIFY**).
- Ask for the minimum signatures needed; explain each prompt in the UI ("Sign to create
  your Shelby storage account"). Unexplained wallet prompts read as phishing.

## 6. Fallback if Ethereum DAA isn't usable yet

**[ANALYSIS]** If Day-1 verification shows Ethereum DAA is not actually operational on
the current network (kill criterion **K1**):

- Try **Solana DAA** (documented, and the shape above is verified for Solana) and reframe
  the demo to Solana-first.
- If neither DAA path works, the differentiator is gone — **escalate to the user** before
  building a lesser "gateway-only, app-custodied" version, which is a materially weaker
  submission. Do not silently downgrade.

## 7. Read next

- The S3 gateway (easy I/O, but **not** wallet-authenticated) → `04-s3-gateway.md`.
- How DAA and the gateway are reconciled into one clean architecture →
  `05-architecture.md` (**read before choosing your write path**).
