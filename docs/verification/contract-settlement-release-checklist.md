# Vessel contract settlement beta release gate

Date: 2026-08-03

Decision: **NO-GO for public deployment**

The contract-only application code is locally verified, but neither chain has a
complete public governance deployment or a recorded real upload. Vessel must
remain fail-closed (`SETTLEMENT_CONTRACTS_ENABLED` must not be enabled in
production) until every blocking item below is complete.

## Architecture under review

- Aptos users settle the Vessel service fee into the Move contract vault. APT
  gas and Shelby protocol/storage charges remain direct protocol costs in the
  registration transaction.
- Solana users settle the Vessel service fee into the Vessel Program vault.
  Sponsored Aptos registration remains a separate protocol operation.
- Both chains verify the same Ed25519 `QuoteV1` signer and create an immutable,
  single-use receipt.
- Direct wallet-to-treasury transfers, ATA-only transfers, and memo-only
  payments cannot authorize an upload.
- Governance target is 2-of-3 Aptos Multisig Account and autonomous 2-of-3
  Squads, each with an 86,400-second timelock.

## Local verification evidence

| Gate | Result | Evidence |
|---|---|---|
| Node and browser application | PASS | `npm run check`: 152 tests passed; both wallet bundles and `clay.wasm` built |
| Aptos Move | PASS | 25/25 tests; 63.12% package coverage |
| Solana Rust | PASS | 6/6 tests across program, admin, and quote suites |
| Solana Anchor integration | PASS | 9/9 tests on `solana-test-validator`; exact debit, receipt, replay, mutation, authority, timelock, withdrawal, and upgrade-lock paths |
| Legacy payment path scan | PASS | No legacy treasury env, transfer helper, or `/api/pay/*/verify` path under `app/server` |
| Diff validation | PASS | `git diff --check` returned success; user-owned retention/storage edits remain unstaged |
| Secret scan | PASS WITH NOTE | The only broad-pattern matches are the scan commands documented in implementation plans; no credential value was found |

The first `anchor test` invocation could not start Anchor 1.1.2's optional
`surfpool` runner because that binary is not installed. The same built program
was deployed to an isolated local `solana-test-validator`, and the configured
TypeScript suite then passed 9/9. The validator was stopped after the run.

## Blocking deployment checks

### Public deployment manifest

`deployments/vessel-settlement.testnet.json` is intentionally still a
placeholder:

- Aptos module, vault, multisig, accepted asset, and deployment transaction are
  `0x0`.
- Solana program/config/vault/Squads/mint values are the System Program
  placeholder or empty.
- The shared quote public key is all zeroes.

### Governance verification

- Aptos Testnet creation transaction
  `0xd971525916652968392e97f8c309069d2b9fa0b3a65fa26fb9548d2f4ca75ae8`
  aborted with `ETIMELOCK_NOT_ENABLED`. The framework's native multisig
  timelock feature is not enabled on Aptos Testnet, so no Aptos multisig account
  was created. Vessel does not silently downgrade the approved 24-hour policy.
- Solana Squads creation transaction
  `3uugP9Vmp88BaJJkqdPQvdyX1xKddF3rAyHxZnajLbt8CARTU65opCoLg5rxk7KSMi7i7TbHDNm6QhGhA4Uy7u6A`
  is finalized on Devnet. The autonomous Squads multisig is
  `2VQfFVSjR8tSCFwvPmz974XGaJQEY8CKa8krF2AM1qeH`; vault index 0 is
  `2yHruBbf2b5P5SdHCXWBypSc1EoQe4Cxm9UbNHKmJSeE`. On-chain verification
  confirms three members, threshold 2, null config authority, and an
  86,400-second timelock.
- The Solana Vessel Program is not yet deployed or transferred to the Squads
  vault. Aptos module publication remains blocked by the governance decision
  above. Accepted assets, quote key, config version, and upgrade authorities
  therefore cannot yet be marked verified end to end.

### Required real-flow evidence

The following evidence files do not exist yet and must not be fabricated:

- `docs/verification/aptos-contract-settlement-testnet.md`
- `docs/verification/solana-contract-settlement-devnet.md`

Each file must record a public transaction ID, receipt ID/PDA, file SHA-256,
Shelby byte verification, authoritative expiration, replay rejection, and
reload/interruption recovery. The Aptos run uses 7 days; the Solana DAA run uses
30 days.

## Conditions to change the decision to GO

- Supply three real public Aptos owner addresses and create the 2-of-3 Aptos
  Multisig Account.
- Supply three real public Solana member addresses and create an autonomous
  2-of-3 Squads multisig.
- Publish/deploy through those governance paths, transfer/verify upgrade
  authority, initialize both vaults, and update the manifest only from finalized
  public-chain results.
- Configure one shared Ed25519 quote public key without recording the private key
  in Git, logs, shell history, or this checklist.
- Run both setup scripts in `verify` mode successfully.
- Execute and record the two real upload flows above.
- Re-run all local gates, deploy the contract-only web app, smoke-test without a
  second payment, then verify the Vercel deployment SHA and Git auto-deploy.

Until then, the previously published demo may remain online only as a historical
demo. It is not evidence that the new contract settlement beta is deployed.
