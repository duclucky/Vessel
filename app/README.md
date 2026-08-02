# Vessel — running app (server + frontend)

Wallet-native media hosting on **Shelby testnet**, with real **Solana Derived Account
Abstraction (DAA)** at the storage layer: a Solana key controls the Aptos account that owns
every blob (verified end-to-end — NOTES.md 5g). The frontend (Stitch design, visual
preserved) is served by the backend, which holds secrets and does every Shelby operation
behind the `StorageProvider` seam.

**Network: testnet only** (shelbynet dropped — its Ethereum-DAA byte path is unshippable and
it wipes weekly). Combo: `solana-kit@0.2.8 + sdk@0.3.1 + Network.TESTNET`.

```
app/
  server/
    src/            REST API + StorageProvider (mock | shelby)
    public/         the 6 screens + app.js (wallet + API wiring)
    .env            local config (NOT committed) — has the shelbynet key + funded account
    .env.example    template
```

## Run

```bash
cd app/server
npm install
npm start           # → http://localhost:8787
```

Open http://localhost:8787.

### Backends (swap with `STORAGE_BACKEND` in `.env`)
- `mock` — in-memory, zero Shelby access. The whole UI works. Use as a network-proof fallback.
- `shelby` — real Shelby **testnet** via Solana DAA. Needs `SHELBY_SOLANA_SECRET_KEY` (JSON
  array of the funded Solana keypair) and optionally `SHELBY_API_KEY` (geomi.dev testnet key,
  lifts rate limits). Fund the storage account (printed on boot) via the testnet faucets:
  APT → https://aptos.dev/network/faucet, ShelbyUSD → https://docs.shelby.xyz/apis/faucet/shelbyusd.

## What works (verified end-to-end)
- **Upload → read → serve via Solana DAA**: media is uploaded to Shelby testnet signed by the
  Solana-DAA account, read back byte-exact via `/api/media/:key`.
- **Latency panel**: real Shelby testnet read latency (median ~1 s for ~1 MB). IPFS shows
  "n/a" until a matching pin is configured (`IPFS_COMPARE_CID`) — no fabricated numbers.
- **Gallery / metadata / delete**: live from the API.
- **Identity**: shows the real Solana→Aptos DAA storage account that owns the media. EVM wallet
  connect (MetaMask) is an optional ownership-derivation demo.

## Two ownership modes (mainnet-shaped)
- **Sovereign (Phantom installed):** the visitor's OWN Solana wallet derives its Aptos storage
  account, signs the upload, and pays for storage — the blob is owned by their wallet. This is
  the production/mainnet model; on testnet the visitor funds their account once (guided faucet
  panel). Runs fully client-side (`public/vessel-solana.js`, bundled from `client-src/` via
  `npm run build:client`); reads come straight from the user's account namespace (anonymous on
  testnet). **Switch to mainnet later by adding a `mainnet` entry in `client-src/vessel-solana.js`
  NETWORKS + the backend network — the sign/own/pay flow is identical.**
- **Fallback (no Phantom):** upload goes to the server-managed Solana-DAA account. Demonstrates
  the mechanism without a wallet.

### Testing the sovereign flow
Open in a browser **with the Phantom extension** (Solana). Upload page → drop a file → connect
Phantom → fund your account once (faucet panel) → your wallet signs → blob owned by you. (Can't
be tested headlessly — needs a real Phantom wallet.)

## Honest limitations (see ../NOTES.md)
- **Ethereum DAA byte-upload is impossible** in every published `ethereum-kit` (no challenge
  handler) — so the sovereign path is **Solana/Phantom**. EVM stays connect+ownership-proof only.
- Testnet data is ephemeral (may reset). Client-side derivation matches the proven account
  (verified) and the signing path uses the same primitives proven via the node run (NOTES 5g).
- Gallery currently lists the server account's blobs; listing a visitor's own blobs (from their
  account via the indexer) is a small follow-up.

## API (contract)
See `../FRONTEND-INTEGRATION.md`. Endpoints: `/api/health`, `/api/identity/{challenge,verify}`,
`/api/upload`, `/api/media/:key`, `/api/list`, `DELETE /api/media/:key`, `/api/metadata`, `/api/latency`.
