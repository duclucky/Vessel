# Official Shelby DAA React Migration Design

## Goal

Make Vessel's cross-chain storage path as close to Shelby's official integration model as possible: Shelby SDKs own Derived Account Abstraction and ShelbyNet storage operations, while Vessel contracts only collect Vessel service fees and emit receipts.

## Current Problem

Vessel currently works, but the implementation mixes two concerns too closely:

- Shelby DAA and ShelbyNet storage ownership.
- Vessel fee settlement on Aptos, Solana, and EVM testnets.

The Solana and EVM paths use official underlying DAA primitives, but the app is still a vanilla JavaScript app. Shelby's official browser examples for Solana and Ethereum are React hooks. That means the current implementation is defensible, but not the most official form when presented to Shelby reviewers.

## Decision

Adopt the official Shelby React/browser integration as the DAA and storage authority.

Vessel will migrate the wallet-owned upload runtime to a React island mounted inside the existing static pages. This avoids a full rewrite of the visual app while allowing the DAA/storage path to use Shelby's official browser entrypoints:

- `@shelby-protocol/solana-kit/react`
- `@shelby-protocol/ethereum-kit/react`
- `@shelby-protocol/sdk/browser`
- `@shelby-protocol/react` where useful for query/mutation wrappers

The current vanilla shell, routing, visual design, gallery, metadata designer, CSV export, proof pages, and landing page remain intact unless a direct integration boundary requires a small adapter.

## Non-Goals

- Do not build NFT minting.
- Do not replace Shelby protocol contracts.
- Do not claim Vessel contracts are Shelby contracts.
- Do not remove Aptos Testnet support; keep it available but not the default live route.
- Do not remove Shelbynet deployment records.
- Do not introduce production guarantees for testnet data retention.

## Architecture

### Boundary 1: Shelby DAA and storage

Shelby official SDKs own:

- wallet to storage-account derivation,
- DAA transaction signing,
- ShelbyNet upload/register/commit calls,
- storage account ownership semantics.

The app must present this clearly:

> User wallet controls a Shelby Storage Account through Shelby DAA. The Shelby Storage Account owns blobs on ShelbyNet.

For Solana, the React island must call the official Solana Kit browser hook. For Ethereum, the React island must call the official Ethereum Kit browser hook. If a hook requires a specific wallet object shape, the migration may introduce a small adapter that converts the selected wallet provider into the hook's required shape. That adapter must not derive keys, sign Shelby transactions, or implement DAA cryptography itself.

### Boundary 2: Vessel fee settlement

Vessel contracts own only:

- collection of the Vessel service fee,
- custody in the contract or program vault,
- admin or multisig withdrawal,
- a verifiable receipt that binds the fee payment to a specific storage intent.

The contracts must not represent themselves as Shelby storage contracts. New source-chain fee contracts must use `VesselFeeReceiptV1` naming. Existing deployed contracts may keep their old on-chain struct names for backwards compatibility only if the server and UI map them to "Vessel fee receipt" everywhere.

### Boundary 3: Server verification

The server verifies:

- Shelby quote integrity,
- Vessel fee receipt integrity,
- wallet identity match,
- file hash match,
- storage account match,
- retention and expiration match.

The server never receives a wallet seed phrase or private key. Shelby API keys and gas station keys remain server-side.

## Data Flow

### Solana or Ethereum wallet upload

1. User selects a wallet in the Vessel wallet modal.
2. React DAA island receives the selected wallet provider.
3. Shelby kit derives the Shelby Storage Account.
4. Vessel server issues a signed quote with:
   - source chain,
   - source wallet,
   - Shelby storage account,
   - file hash,
   - retention,
   - storage expiration,
   - fee breakdown,
   - Vessel service fee.
5. User approves Vessel fee settlement on the source chain.
6. Vessel contract emits fee receipt.
7. Server verifies receipt against the signed quote.
8. Shelby official SDK path registers and uploads the blob under the derived Shelby Storage Account.
9. Gallery records the artifact with media URL, proof URL, fee receipt, and optional TokenURI.

### Aptos wallet upload

Aptos remains the native ShelbyNet path. It can continue using the current Aptos wallet flow if it is already closer to Shelby's native model than forcing it through the cross-chain React kit.

## Contract Redesign

### Solana program

Rename semantics from generic settlement to fee settlement:

- `SettlementReceiptV1` becomes `VesselFeeReceiptV1`.
- `SettlementReceiptCreatedV1` becomes `VesselFeeReceiptCreatedV1`.
- `amount` means Vessel service fee amount only.
- `asset` means the source-chain fee asset, currently Devnet USDC.
- The receipt must bind:
  - quote ID,
  - payer Solana public key,
  - Shelby storage account bytes,
  - file hash,
  - retention days,
  - storage expiration micros,
  - config version.

The program keeps:

- Ed25519 quote verification through Solana's native Ed25519 verify instruction,
- PDA receipt,
- vault authority PDA,
- token transfer into vault ATA,
- pause,
- timelocked config changes,
- Squads-controlled authority.

### EVM contract

Rename semantics from generic settlement to fee settlement:

- `SettlementReceiptV1` becomes `VesselFeeReceiptV1`.
- `amount` must use the actual chain payment unit.
- For Sepolia beta, native ETH is acceptable only if the quote explicitly converts the Vessel service fee to wei.

Because EVM does not have a standard Ed25519 precompile, Ed25519 quote signature verification remains server-side for the beta. The EVM contract must still validate:

- payer equals `msg.sender`,
- chain is EVM,
- network is Sepolia,
- amount is exact,
- quote has not expired,
- quote ID, file hash, and storage address are non-zero.

### Aptos Move contract

Use the same fee-only language:

- the Move contract is the Vessel fee collector,
- Shelby protocol remains the storage authority,
- Aptos-native storage gas and ShelbyUSD are paid through Shelby's native path where applicable.

If the Move contract currently records broader settlement wording, rename public copy and server adapters first. Rename Move structs only if migration cost is acceptable before submission.

## Frontend Migration Strategy

Use a React island instead of rewriting the full app.

Create a small React bundle that owns:

- Shelby client provider setup,
- Solana `useStorageAccount`,
- Ethereum `useStorageAccount`,
- selected wallet adapter bridge,
- upload action adapter back to the existing page controller.

Expose a stable browser interface:

```js
window.VesselOfficialShelby = {
  scanWallets(),
  connectWallet(walletId),
  disconnect(),
  getSession(),
  upload(file, context),
  resumeUpload(file, recoveryRecord)
}
```

Existing vanilla pages call this interface instead of directly calling `window.VesselSolana` or the custom EVM DAA adapter.

## Compatibility

The migration must keep these user-facing features working:

- wallet modal,
- Aptos/Solana/EVM grouping,
- upload single file,
- folder/batch upload,
- metadata JSON generation,
- metadata hosting,
- gallery media and TokenURI sections,
- proof pages,
- CSV export,
- collection detail page,
- recovery after pending receipt.

## Copy Changes

Use this wording consistently:

- "Powered by Shelby DAA"
- "Shelby Storage Account"
- "Vessel fee receipt"
- "Vessel contract vault"
- "ShelbyNet storage"

Avoid:

- "Vessel owns Shelby storage"
- "Vessel Solana contract is Shelby DAA"
- "Shelby contract on Solana"
- "Permanent storage"

## Testing Requirements

Add or keep tests proving:

- Solana and Ethereum browser integrations call the official Shelby hook boundary.
- The old custom DAA adapters are no longer the primary upload path.
- Vessel fee quote amount is separated from Shelby storage cost and sponsored gas.
- Solana and EVM fee receipts cannot be replayed against a different file, payer, storage account, retention, or config version.
- Gallery and proof pages label fee receipts separately from Shelby storage evidence.
- Production `/api/config` exposes only non-secret network and contract metadata.

## Rollout

1. Add React island without removing the current runtime.
2. Route one chain at a time through the React island, starting with Solana.
3. Verify Solana upload with Phantom.
4. Route Ethereum through the React island.
5. Verify Ethereum DAA derivation and Sepolia fee settlement.
6. Rename contract/server receipt semantics to fee-only.
7. Update landing page, README, Notion submission copy, and in-app helper text.
8. Deploy to Vercel after full test and live smoke.

## Acceptance Criteria

- Shelby DAA/storage integration is demonstrably backed by official Shelby browser SDK entrypoints or a documented compatibility wrapper around those entrypoints.
- Vessel contracts are documented and named as fee settlement only.
- Solana and Ethereum uploads still produce ShelbyNet media URLs.
- Metadata TokenURI hosting still works.
- Gallery and proof pages show both Shelby storage evidence and Vessel fee receipt evidence.
- `npm run check` passes.
- A production `/api/config` check shows Aptos, Solana, and EVM enabled only when their runtime dependencies are configured.
