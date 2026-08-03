# Vessel contract settlement beta release gate

Date: 2026-08-03

Decision: **NO-GO for public deployment**

The contract-only application code is locally verified and the Aptos deployment
is complete, but the Solana Program is not initialized and neither chain has a
recorded real upload. Vessel must
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
- Governance is a 2-of-3 Aptos Multisig Account without a native Testnet
  timelock and an autonomous 2-of-3 Squads with an 86,400-second timelock.
  The Move module retains its own 86,400-second delay for scheduled
  configuration changes.

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

`deployments/vessel-settlement.testnet.json` is partially finalized:

- Aptos module, vault, multisig, accepted asset, deployment transaction, shared
  quote public key, and config version are finalized and verified on Testnet.
- Solana Program ID, deployment signature, and Squads multisig are finalized.
- Solana config PDA, vault ATA, and accepted mint remain the System Program
  placeholder until the Squads initialization proposal executes.

### Governance verification

- Aptos Testnet timelock attempt
  `0xd971525916652968392e97f8c309069d2b9fa0b3a65fa26fb9548d2f4ca75ae8`
  aborted with `ETIMELOCK_NOT_ENABLED`. The approved Testnet exception creates
  the native multisig without a timelock.
- Aptos multisig creation transaction
  `0x9202ae8f54722a520c4d3094cfd67cd023e6cd9229f4ae2034c6ef9e2cab58f1`
  is finalized. Multisig
  `0x9885a9a0e382335d0f801301d43b451facaa6e768d31e5c9903b2a0dd9efef15`
  has exactly three owners, threshold 2, and no timelock resource.
- Aptos publication proposal, approval, and execution transactions are
  `0x1dda084f3ba5e1e55fc5eb21dcfb64f519309ae0ca299f8b4583f9f7b3b7b095`,
  `0x04db245b2f5af17456247b5fead78ec1eecf4ee6f22fbd01feb862659b088c25`,
  and `0xbdc7f3ea07c5c2fbac06cb7e9a07db58ef1b93dfe0e41575379e564c6386a8a4`.
  Initialization proposal, approval, and execution are
  `0x4226917b88b8a455f0153af46eaaf06cc26f8e1a23d748ecc8a00a60e5796880`,
  `0xab633e2f759aaab1b2c571dd0e9306b73570545d031303d5f66404200ccb3094`,
  and `0xb9be4c387c8711e7e437175474583ddcc1bdf22121f2bfe747db0e2fa09b5faa`.
  The verifier confirms module/vault/admin/asset/quote key/config version and
  reports `paused=false` and `upgradeLocked=false`.
- Solana Squads creation transaction
  `3uugP9Vmp88BaJJkqdPQvdyX1xKddF3rAyHxZnajLbt8CARTU65opCoLg5rxk7KSMi7i7TbHDNm6QhGhA4Uy7u6A`
  is finalized on Devnet. The autonomous Squads multisig is
  `2VQfFVSjR8tSCFwvPmz974XGaJQEY8CKa8krF2AM1qeH`; vault index 0 is
  `2yHruBbf2b5P5SdHCXWBypSc1EoQe4Cxm9UbNHKmJSeE`. On-chain verification
  confirms three members, threshold 2, null config authority, and an
  86,400-second timelock.
- The Solana Vessel Program
  `6K7MzA7zbRkgxKmQikZzawYxmDHv3LWK8XFjHhqChi1b` is finalized on Devnet and
  its upgrade authority is the Squads vault
  `2yHruBbf2b5P5SdHCXWBypSc1EoQe4Cxm9UbNHKmJSeE`. Its config/vault have not
  been initialized through Squads yet, so the cross-chain deployment is not
  verified end to end.
- Solana initialize vault transaction, proposal, and two approvals are finalized
  as `2JQcnuYSTuAT465nQjeVUpHRGY8znSNRgH62z72Y2hfWSAn6FzbpwVV3ecBnRTHpMCrXVV7qvYVdENDv64zY5FjW`,
  `5zbFyTPY2d8eFwxCu2g7sVwFro19N1qCSvJY624JTJHbMxU6eceF5UuKwK985xXpECYPEKxMYPEQN1zVgxiRFo5V`,
  `2hiNHJnvrHc6BhrXecnHbMJz81GVFKno94fDhvdG4fKChtSyuYHT3vNJ2htV2rEJys5pS6zRcbZgjLWkXDf6pBPw`,
  and `41wNBS4RwYDWvqy9YYeoSkrhBQVWUQ4r6EuH4Hf6aZ2iu5TRUs2MwKPfuruhTVXtXNkSnVeDaBVaftC3JncTFCh1`.
  Proposal PDA `9hCkD92WLaoLxbckPVyqHy6VatbD7XFUCuQutiJcRGUV` is Approved by members 1
  and 2. Its on-chain execute-after timestamp is `1785851172`; attempting to
  initialize before then would violate the approved Squads policy.

### Required real-flow evidence

The following evidence files do not exist yet and must not be fabricated:

- `docs/verification/aptos-contract-settlement-testnet.md`
- `docs/verification/solana-contract-settlement-devnet.md`

Each file must record a public transaction ID, receipt ID/PDA, file SHA-256,
Shelby byte verification, authoritative expiration, replay rejection, and
reload/interruption recovery. The Aptos run uses 7 days; the Solana DAA run uses
30 days.

## Conditions to change the decision to GO

- Initialize the Solana config and vault through the existing autonomous
  2-of-3 Squads proposal after its 86,400-second timelock.
- Complete the remaining manifest fields only from finalized public-chain
  results and run both setup verifiers successfully.
- Configure one shared Ed25519 quote public key without recording the private key
  in Git, logs, shell history, or this checklist.
- Run both setup scripts in `verify` mode successfully.
- Execute and record the two real upload flows above.
- Re-run all local gates, deploy the contract-only web app, smoke-test without a
  second payment, then verify the Vercel deployment SHA and Git auto-deploy.

Until then, the previously published demo may remain online only as a historical
demo. It is not evidence that the new contract settlement beta is deployed.
