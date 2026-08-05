# Vessel

Wallet-owned hot storage, cross-chain settlement, and canonical NFT metadata for Aptos and Solana, powered by Shelby.

## Live beta

- Application: [https://vessel-sage.vercel.app](https://vessel-sage.vercel.app)
- Network: Aptos Testnet, Solana Devnet, Shelby Testnet
- Status: public testnet beta
- Source: [github.com/duclucky/Vessel](https://github.com/duclucky/Vessel)

Vessel is an end-to-end NFT media workspace. A user connects an existing wallet, establishes a wallet-controlled Shelby storage identity, prepares individual assets or collection folders, generates NFT metadata, and receives contract-issued settlement evidence. The application does not mint NFTs. It produces media and metadata URLs that an NFT contract or marketplace can consume.

Testnet tokens have no real monetary value. Retention is temporary and the beta does not provide a production availability commitment.

## What Vessel does

Vessel currently combines these journeys in one web application:

1. **Wallet discovery and identity**: detects supported Aptos and Solana browser wallets, connects the selected wallet, and shows the resulting Shelby storage identity.
2. **Single media preparation**: validates an image or other supported asset, selects retention from 1 to 365 days, and presents an itemized quote before approval.
3. **Batch collection preparation**: accepts a folder as one collection workflow, preserves relative source paths, and tracks progress as a batch.
4. **Wallet-scoped Vault and Gallery**: records successful artifacts for the connected wallet and exposes copy, preview, and removal actions.
5. **Canonical NFT metadata**: creates cross-chain JSON for one NFT, including traits and media fields.
6. **Collection metadata export**: groups an uploaded collection from Vault history, reuses its Shelby media URLs, and exports deterministic JSON files as a ZIP.
7. **Latency evidence**: compares a real Shelby read with a configured public IPFS gateway and reports unavailable measurements honestly.
8. **Contract settlement**: validates a signed quote and accepts a contract receipt from the supported chain instead of treating a transfer to an ordinary wallet as payment evidence.

## Current network status

**Shelby public API is temporarily paused.** Production currently runs with `SHELBY_WRITES_ENABLED=false`.

While this gate is disabled:

- New Shelby upload and metadata-hosting operations are blocked before a wallet transaction is requested.
- Single NFT JSON can still be generated and downloaded locally.
- Batch collection JSON and ZIP export can use unexpired **browser-local Vault history** for the connected storage address.
- The application labels that batch source as local Vault cache and does not claim a fresh remote or on-chain reconciliation.
- Only collections previously recorded by the same browser can be reconstructed while the indexer is unavailable.

When Shelby restores public writes and indexing, setting `SHELBY_WRITES_ENABLED=true` restores remote artifact listing and reconciliation without changing the metadata workflow.

## User journeys

### 1. Connect

Open Identity and choose a compatible wallet from the in-page wallet picker.

- **Aptos**: the connected Aptos account is the storage identity and settlement sender.
- **Solana**: the wallet authorizes a deterministic Aptos Derived Account Abstraction identity for Shelby, while the Vessel service settlement stays on Solana.

Wallet state is restored silently when the extension supports it. Selecting a connected address opens an account menu with copy, switch, and logout actions.

### 2. Prepare storage

Open Upload, select one file or a collection folder, and choose a retention preset or a custom duration from 1 to 365 days. Quote calculation accounts for file size and duration, network and protocol cost, sponsored gas, a 2% Vessel service fee, and a USD 0.01 minimum.

The current Shelby write gate prevents submission while the upstream API is paused. The UI remains usable for inspection and does not present a disabled network as a successful upload.

### 3. Use the Vault

Gallery and Vault data are scoped to the connected storage address. The browser ledger preserves source paths needed to reconstruct batch collections and distinguishes locally recorded state from remotely reconciled Shelby state.

### 4. Generate metadata

Metadata supports two modes:

- **Single NFT**: choose a Vault asset, enter name, description, optional external URL, collection details, and traits, then download canonical JSON.
- **Batch collection**: select a collection already recorded in the Shelby Vault, optionally apply a CSV metadata override, review every item, and download a metadata ZIP.

Hosting the generated JSON on Shelby remains disabled until Shelby writes reopen.

### 5. Inspect latency

The Latency page fetches the configured Shelby artifact and an optional IPFS comparison asset. It displays actual results only. A missing or unavailable comparison remains `n/a`.

## Architecture

```text
Supported wallet
  |
  +-- Aptos wallet ------------------------------+
  |   native storage identity                    |
  |                                              v
  +-- Solana wallet --> deterministic Aptos DAA --> Shelby storage
  |                                              |
  +-- chain-specific signed quote                +--> media URL
      |                                          +--> NFT metadata
      +-- Aptos Move contract receipt
      +-- Solana Program receipt
```

The browser owns wallet interaction and user approval. Server routes provide public configuration, quote signing and validation, storage coordination, transaction verification, and protected provider credentials. Client-facing secrets are never embedded in the browser bundles.

Storage code remains behind provider boundaries:

- `app/server/src/storage/shelby.js`: Shelby-backed server provider.
- `app/server/src/storage/mock.js`: local in-memory development provider.
- `app/server/client-src/`: wallet-native Aptos and Solana browser clients bundled into `public/`.
- `app/server/public/ledger.js`: wallet-scoped browser history and recovery state.

## Settlement contracts

Vessel deploys one settlement contract or program for each supported chain. Both consume the same public-key-signed `QuoteV1` model and issue a single-use receipt.

### Aptos Testnet

| Item | Value |
|---|---|
| Aptos Move contract and multisig | `0x9885a9a0e382335d0f801301d43b451facaa6e768d31e5c9903b2a0dd9efef15` |
| Service-fee vault | `0x2025257c90ced758ea49e1492d60a903dbc8c4d5915657611f968b7a27cf3f8a` |
| Deployment transaction | `0xbdc7f3ea07c5c2fbac06cb7e9a07db58ef1b93dfe0e41575379e564c6386a8a4` |
| Governance | 2-of-3 Aptos Multisig Account |

The Aptos Move contract holds only the Vessel service fee. APT gas and Shelby protocol or storage charges remain direct network costs in the registration flow.

### Solana Devnet

| Item | Value |
|---|---|
| Solana Program | `G2dA3Sz1XxvJ4ppkvwb95kfy5w6M9ip2KiZBmt7xbsBx` |
| Config PDA | `cdKfmtYBndH3DM6B4B1UeeaaCBYRMTsBcJ9irQ5M4cA` |
| Vault ATA | `Ac7fiHCWCnWFkPUE6xgsginTqQmfUE6uwFkPUN7Pv8y7` |
| Squads multisig | `GuoEcd5vAUctrhNbiS8WygVBMFL85kR4GN6yJFuK6zRh` |
| Accepted mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

The Solana Program vault holds the Vessel service fee. DAA registration sponsorship and Shelby protocol costs remain separate.

The public source of truth for all addresses is [`deployments/vessel-settlement.testnet.json`](deployments/vessel-settlement.testnet.json). Contract-specific operating instructions live in [`contracts/aptos/vessel_settlement/README.md`](contracts/aptos/vessel_settlement/README.md) and [`contracts/solana/vessel-settlement/README.md`](contracts/solana/vessel-settlement/README.md).

## NFT metadata and batch collections

Single and collection exports use one marketplace-compatible NFT metadata model. The Metadata Designer supports image, video, audio, HTML or interactive, and game item presets. Generated JSON can include:

- `name`
- `description`
- `image`
- `external_url`
- `animation_url`
- `background_color`
- `attributes`
- `properties.category`
- `properties.files`

Batch collection generation does not select a second local source folder. It selects a collection already recorded in the connected wallet's Vault, preserves the original filenames and relative paths, and reuses previously uploaded Shelby URLs. The metadata builder does not hash or re-upload source images.

Batch collection names default to `<Collection Name> #<Number>`, and batch JSON files default to `1.json`, `2.json`, `3.json`. CSV overrides can update names, descriptions, external URLs, background colors, animation URLs, and text, number, date, boost number, or boost percentage traits.

Optional Vessel proof can be added under `properties.vessel`, but it is off by default so marketplace-facing JSON stays clean. Vessel validates the collection before enabling ZIP export. Batch metadata hosting uses the same Shelby write gate as single metadata hosting.

## Repository map

```text
Vessel/
├── app/server/                    Express API, static dApp, browser clients, tests
│   ├── client-src/                wallet and settlement bundle sources
│   ├── public/                    landing and five dApp journeys
│   ├── scripts/                   deployment, governance, and verification helpers
│   ├── src/                       server routes, quotes, settlement, storage providers
│   └── test/                      Node test suite
├── contracts/
│   ├── aptos/vessel_settlement/   Aptos Move package
│   └── solana/vessel-settlement/  Solana Anchor program
├── deployments/                   public testnet deployment manifest
├── docs/superpowers/              approved feature specs and implementation plans
├── guides/                        setup, verification, build, and conventions
├── knowledge/                     original product and protocol research
├── AGENTS.md                      repository entry point for coding agents
└── CLAUDE.md                      project operating manual
```

`knowledge/` records the original planning assumptions. Where historical planning text conflicts with current code or the deployment manifest, current code and `deployments/vessel-settlement.testnet.json` are authoritative.

## Local development

### Prerequisites

- Node.js and npm
- A browser with a compatible Aptos or Solana wallet extension for real-wallet tests
- Shelby credentials only when the public service is available and `STORAGE_BACKEND=shelby`
- Aptos and Solana CLIs only for contract deployment or on-chain verification tasks

### Install and run

```powershell
Set-Location app/server
npm install
Copy-Item .env.example .env
npm run build:client
npm start
```

Open [http://localhost:8787](http://localhost:8787).

For UI development with automatic server reload:

```powershell
npm run dev
```

Use `STORAGE_BACKEND=mock` for network-independent local development. Set `SHELBY_WRITES_ENABLED=false` to reproduce the production pause without contacting Shelby write or indexer APIs.

## Environment configuration

Start from `app/server/.env.example`. Never commit the resulting `.env` file.

### Runtime and storage

| Variable | Purpose |
|---|---|
| `PORT` | Local Express port, default `8787` |
| `PUBLIC_BASE` | Public origin used to construct application URLs |
| `STORAGE_BACKEND` | `mock` or `shelby` |
| `MAX_UPLOAD_BYTES` | Per-file server upload limit |
| `DEFAULT_STORAGE_DAYS` | Default retention selection |
| `SHELBY_NETWORK` | Shelby network name, currently `testnet` |
| `SHELBY_WRITES_ENABLED` | Required boolean in production; use `false` during the API pause |
| `SHELBY_API_KEY` | Server-only Shelby API credential |
| `SHELBY_SOLANA_SECRET_KEY` | Server-only managed Solana DAA key for fallback provider operations |
| `DAPP_DOMAIN` | Domain separator used by wallet identity operations |

### Wallets and latency

| Variable | Purpose |
|---|---|
| `WALLET_APTOS_ENABLED` | Enables Aptos wallet family discovery unless set to `false` |
| `WALLET_SOLANA_ENABLED` | Enables Solana wallet family discovery unless set to `false` |
| `IPFS_GATEWAY` | Public IPFS gateway base URL |
| `IPFS_COMPARE_CID` | Optional CID for a real comparison asset |
| `SOLANA_RPC` | Solana Devnet RPC endpoint |
| `USDC_MINT` | Accepted Solana Devnet settlement mint |

### Quotes, sponsorship, and settlement

| Variable | Purpose |
|---|---|
| `DYNAMIC_QUOTES_ENABLED` | Enables live network-aware quote computation |
| `SETTLEMENT_CONTRACTS_ENABLED` | Requires contract receipts for the service flow |
| `SETTLEMENT_DEPLOYMENTS_FILE` | Deployment manifest path |
| `QUOTE_SIGNER_PRIVATE_KEY_B64` | Server-only Ed25519 quote signer |
| `QUOTE_SIGNER_PUBLIC_KEY_HEX` | Public quote verification key |
| `GAS_STATION_ACCOUNT` | Public sponsor account address |
| `GAS_STATION_API_KEY` | Server-only gas station credential |
| `APT_USD_REFERENCE_MICROS` | Aptos USD reference used by quote calculations |
| `REGISTER_GAS_UNITS_ESTIMATE` | Registration gas estimate |
| `GAS_SAFETY_BPS` | Gas safety multiplier in basis points |
| `TELEMETRY_WALLET_SALT` | Server-only salt for privacy-preserving telemetry identifiers |

Production startup fails closed when `SHELBY_WRITES_ENABLED` is missing or malformed. Contract settlement startup also validates the public deployment manifest and required quote keys before enabling the flow.

## Test and build

Run all checks from `app/server`:

```powershell
npm test
npm run build:client
```

`npm test` runs the Node test suite across wallets, Aptos and Solana settlement, receipts, quotes, upload recovery, batch upload, metadata, accessibility, and public content contracts.

`npm run build:client` rebuilds the browser wallet bundles from `client-src/` and copies the required Clay WASM asset into `public/`.

For the settlement-only subset:

```powershell
npm run test:settlement
```

Do not claim a real-wallet path is verified from automated tests alone. Wallet extension prompts and live testnet receipts require a browser run with the intended extension and account.

## Deploy to Vercel

The existing Vercel project uses **Root Directory = `app/server`**. Configure environment values in Vercel and keep secret values out of Git.

The normal production path is the connected Git deployment:

```powershell
git push origin main
```

Vercel builds from the configured Root Directory and serves Express as a serverless function. To inspect the current alias from the repository root:

```powershell
npx vercel inspect https://vessel-sage.vercel.app
```

Do not invoke a manual deployment from inside `app/server`, because Vercel would apply the configured Root Directory a second time. If a manual deployment is required, run the Vercel command from the repository root.

## Security model

- Browser code receives only public configuration, public deployment identifiers, wallet adapter state, and signed public quote payloads.
- Wallet extensions retain user keys and display the transaction approval surface.
- Shelby API credentials, the quote signer private key, gas station credentials, server fallback keys, telemetry salts, and compatibility secrets remain server-only.
- Each chain has a separate settlement contract or program and a separate vault.
- Aptos governance uses a 2-of-3 Aptos Multisig Account.
- Solana governance uses a 2-of-3 autonomous Squads multisig.
- Sensitive program configuration changes use contract-level scheduling rules described in the contract READMEs.
- Public receipts are single-use settlement evidence. They do not expose private signing material.

Never paste `.env`, wallet secrets, private keys, seed phrases, API tokens, or browser session data into issues, logs, screenshots, or committed documentation.

## Beta limitations

- Shelby public writes and indexing are currently unavailable, so upload and hosted metadata are gated off in production.
- Browser-local Vault history is device and browser specific. It is not a replacement for remote Shelby reconciliation.
- Testnet artifacts expire according to their selected retention and may also be affected by network resets.
- Vessel does not mint NFTs or provide marketplace listing services.
- The beta does not provide an SLA, durability guarantee, managed encryption claim, or mainnet promise.
- Pricing uses testnet assets and reference inputs. It is not a statement of future mainnet pricing.
- IPFS comparison requires a configured matching asset; missing measurements remain unavailable.
- Contract upgrades remain possible during beta under their documented governance controls.

## Project documentation

- [`AGENTS.md`](AGENTS.md): repository entry point and hard project rules.
- [`CLAUDE.md`](CLAUDE.md): complete operating manual and scope guardrails.
- [`guides/00-setup.md`](guides/00-setup.md): Shelby SDK, CLI, and skill setup.
- [`guides/01-verification-first.md`](guides/01-verification-first.md): verification-first kill checklist.
- [`guides/03-conventions.md`](guides/03-conventions.md): provider boundaries and implementation conventions.
- [`docs/superpowers/specs/`](docs/superpowers/specs/): approved feature designs.
- [`docs/superpowers/plans/`](docs/superpowers/plans/): executable implementation plans.
- [Shelby documentation](https://docs.shelby.xyz): current protocol and API documentation.

The live Shelby documentation and installed official SDK are authoritative for current upstream API shapes. This README is authoritative for the current Vessel repository and deployed beta behavior.
