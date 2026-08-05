# Vessel ShelbyNet runtime pivot design

Date: 2026-08-06

## Objective

Make Vessel operate against ShelbyNet while preserving the existing Aptos Testnet path for later reactivation. The public landing page must present both environments accurately:

- Aptos Testnet: visible, marked Maintenance, disabled.
- ShelbyNet: visible, marked Live, enabled.

The change must prove that the webapp can execute real Shelby storage flows on the live developer prototype network without deleting or invalidating the current Aptos Testnet deployment artifacts.

## Current problem

The repository has a `SHELBY_NETWORK` setting, but several runtime paths still hard-code `Network.TESTNET`, Aptos Testnet chain id `2`, testnet Shelby RPC URLs, and the testnet settlement deployment manifest. As a result, changing `.env` to `SHELBY_NETWORK=shelbynet` does not fully move the application to ShelbyNet.

The existing Aptos Testnet setup remains useful and must not be removed. It should be treated as a maintained but disabled environment in the UI.

## Target architecture

Vessel will support two named storage environments:

| Environment | Display name | Status | User entry |
|---|---|---|---|
| `testnet` | Aptos Testnet | Maintenance | Disabled |
| `shelbynet` | ShelbyNet | Live | Enabled |

The backend will resolve network-specific values through a single runtime resolver instead of scattered hard-coded constants.

For ShelbyNet:

- Aptos network: `shelbynet`
- Aptos chain id: `118`
- Shelby RPC: `https://api.shelbynet.shelby.xyz/shelby`
- Aptos fullnode: `https://api.shelbynet.shelby.xyz/v1`
- Aptos indexer: `https://api.shelbynet.shelby.xyz/v1/graphql`
- Shelby protocol module address: `0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a`
- Sponsored register functions:
  - `blob_metadata::register_blob_with_sponsor`
  - `blob_metadata::register_multiple_blobs_with_sponsor`

## API key handling

Do not expose Shelby or gas station keys to the browser. The server will support split key variables:

- `SHELBY_RPC_API_KEY`
- `SHELBY_INDEXER_API_KEY`
- `SHELBY_APTOS_API_KEY`
- `SHELBY_API_KEY` as backward-compatible fallback

This avoids sending a key scoped for one Shelby service to another service. The current local probing showed that a key can fail with `401 API key not found` if sent to the wrong ShelbyNet endpoint.

## Gas station

The ShelbyNet gas station fee payer is:

```text
0x0577497ffa319784c9cf53632316eb893c23d541e3ba0586e57bccc42e8f186d
```

This address is public. Its API key remains secret and must stay only in `.env` and deployment environment variables.

The fee payer must have ShelbyNet APT and ShelbyUSD. APT funding through the public faucet was verified. ShelbyUSD balance was already present and sufficient for small smoke tests.

## Settlement contracts

The existing Aptos Testnet manifest and Solana Devnet manifest remain untouched.

ShelbyNet Aptos settlement requires a new Move deployment and a new manifest. The loader must support at least:

- Aptos Testnet chain id `2`
- ShelbyNet chain id `118`

The manifest validation must remain fail-closed. It should accept ShelbyNet only when the manifest explicitly declares `environment: "shelbynet"` and chain id `118`.

Solana settlement remains on Solana Devnet. It does not deploy to ShelbyNet. For Solana users, the flow remains:

1. User pays Vessel service fee through the Solana Program.
2. Backend verifies the Solana receipt.
3. Backend uses the sponsored Shelby registration flow to register/upload the blob on ShelbyNet.

## Frontend behavior

Landing page:

- Rename the old `Shelby Testnet` label to `Aptos Testnet`.
- Show Aptos Testnet as Maintenance with a disabled button.
- Show ShelbyNet as Live with the active launch button.
- Inside the app, show the active storage environment as `ShelbyNet live beta`.

Wallet and upload UI:

- Continue to detect Aptos and Solana wallets.
- Require the wallet/network appropriate to the selected route.
- Keep errors explicit when the wallet is on the wrong chain or when ShelbyNet writes are disabled.

## Data flow

For Aptos users on ShelbyNet:

1. User connects Aptos wallet.
2. App derives or reads the Shelby storage account.
3. Server issues a quote using live Shelby pricing from ShelbyNet.
4. User settles Vessel fee through the ShelbyNet Move settlement contract after it is deployed.
5. Server builds a sponsored Shelby register transaction.
6. User signs or submits through the supported wallet flow.
7. Server uploads bytes to Shelby RPC.
8. Gallery and media proxy read from ShelbyNet.

For Solana users:

1. User connects Solana wallet.
2. App derives the Aptos storage account through Solana DAA.
3. Server issues a quote using ShelbyNet pricing.
4. User settles Vessel fee through the Solana Devnet Program.
5. Server verifies receipt and sponsors ShelbyNet register/upload.
6. Gallery and media proxy read from ShelbyNet.

## Error handling

- Missing ShelbyNet keys: server returns a clear configuration error.
- Missing gas station config: sponsored upload is unavailable, but the app should not claim upload success.
- Missing ShelbyNet settlement manifest: Aptos paid settlement is disabled until deployment exists.
- Aptos Testnet route selected from landing page: disabled maintenance UI, no hidden redirect.
- ShelbyNet indexer unavailable: upload result can still show direct media URL, while gallery shows a recoverable indexing error.
- ShelbyNet wipe: show artifacts as ephemeral and avoid any permanent-storage wording.

## Verification plan

Before claiming completion:

1. Unit tests for network resolver and manifest validation.
2. Existing server test suite.
3. Client bundle build.
4. ShelbyNet health probe:
   - Aptos ledger info returns chain id `118`.
   - Shelby pricing views return active payment tier.
   - Fee payer balance is readable.
5. Browser smoke:
   - Landing page shows Aptos Testnet Maintenance and ShelbyNet Live.
   - ShelbyNet opens the dApp.
   - Upload flow fails closed if a required secret or manifest is missing.
6. After Move deployment:
   - Real Aptos settlement receipt.
   - Real Shelby register/upload/read.
   - Gallery lists the uploaded artifact.

## Non-goals

- Do not delete the existing Aptos Testnet code, manifest, docs, or deployment references.
- Do not migrate Solana Program deployment off Devnet as part of ShelbyNet storage pivot.
- Do not introduce permanent-storage claims.
- Do not expose API keys or private keys to browser bundles or committed files.
