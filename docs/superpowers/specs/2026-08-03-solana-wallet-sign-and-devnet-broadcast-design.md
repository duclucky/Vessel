# Solana Wallet Sign and Devnet Broadcast Design

## Objective

Make Phantom settlement reliable when its internal `signAndSendTransaction` path reports a false-negative simulation failure even though the exact Vessel transaction succeeds on Solana Devnet RPC.

## Evidence

- No new wallet signature appeared on Solana Devnet after either failed approval, so no USDC was charged.
- The exact current quote and transaction simulated successfully through the configured Devnet RPC; Vessel Program, System Program, and Token Program all returned success.
- The same bytes fail on Mainnet with `AccountNotFound`.
- Browser logs show Phantom's service-worker port disconnecting before the dApp receives a signature.

## Approved Design

When Wallet Standard exposes `solana:signTransaction`, Vessel asks the selected wallet to sign the immutable legacy transaction for `solana:devnet`. Vessel verifies that the returned signed transaction has the same serialized message and a valid payer signature, then broadcasts the signed bytes through the configured Solana Devnet connection. Wallets without `signTransaction` retain the existing `signAndSendTransaction` fallback.

If settlement fails before a transaction ID exists, the upload screen restores the signed quote and displays the error so the user can retry without toggling retention.

## Security and Scope

- The wallet remains the only holder of the payer key.
- Vessel cannot modify a transaction after the wallet signs it; message bytes are compared before broadcast.
- Settlement still targets the deployed Vessel Program and multisig-controlled vault.
- No server relayer, private key, contract change, or schema migration is introduced.

## Verification

- Adapter regression test for Devnet `signTransaction` normalization.
- Settlement regression test proving signed bytes are broadcast through the configured connection and the older send path is not used.
- Mutation and invalid-signature tests fail before broadcast.
- Upload UI regression test restores a retryable quote after pre-submission errors.
- Full test/build check, Production deploy, Chrome approval, Solana receipt verification, Shelby upload, and Gallery verification.
