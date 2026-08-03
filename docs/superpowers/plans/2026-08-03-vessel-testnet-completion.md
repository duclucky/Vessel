# Vessel Testnet Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the public Aptos Testnet and Solana Devnet contract deployments, prove one real upload per chain, and release the fail-closed contract-only webapp.

**Architecture:** Aptos uses a native 2-of-3 Multisig Account created through `create_with_owners` with no framework timelock; Move-level configuration changes retain their 86,400-second delay. Solana uses an autonomous 2-of-3 Squads vault with `timeLock = 0` for this Devnet submission beta; Program-level configuration changes retain their 86,400-second delay.

**Tech Stack:** Aptos Move and `@aptos-labs/ts-sdk`, Solana Anchor and `@sqds/multisig`, Node.js test runner, Shelby Testnet, Vercel.

## Global Constraints

- Aptos governance is exactly 2-of-3 and has `timelock = null` on Testnet.
- Solana governance is exactly 2-of-3 with the approved Devnet `timeLock = 0` exception.
- No private key, seed, signed quote, or paid authorization is printed or committed.
- Direct treasury transfers never authorize upload.
- `SETTLEMENT_CONTRACTS_ENABLED` remains false until both real-flow evidence files pass review.
- Existing user-owned dirty files remain unstaged and unmodified by this plan.

---

### Task 1: Aptos no-timelock governance helper

**Files:**
- Modify: `app/server/scripts/aptos-multisig-payload.mjs`
- Modify: `app/server/test/aptos-multisig-payload.test.js`
- Modify: `contracts/aptos/vessel_settlement/README.md`

**Interfaces:**
- `validateMultisigInputs({ owners, threshold, timelockSeconds })` accepts only three unique owners, threshold `2`, and `timelockSeconds: null`.
- `buildCreatePayload()` targets `0x1::multisig_account::create_with_owners` with five function arguments.
- `readMultisigStatus()` reports `timelockSeconds: null` and `overrideThreshold: null` when `MultisigAccountTimeLock` is absent.

- [ ] **Step 1: Write the failing tests**

```js
const config = validateMultisigInputs({ owners, threshold: 2, timelockSeconds: null });
const payload = buildCreatePayload(config);
assert.equal(payload.function, '0x1::multisig_account::create_with_owners');
assert.deepEqual(payload.functionArguments, [
  owners.slice(1), 2, ['vessel_role'], [[...Buffer.from('settlement_admin')]],
]);
assert.throws(
  () => validateMultisigInputs({ owners, threshold: 2, timelockSeconds: 86_400 }),
  /disabled on Aptos Testnet/i,
);
```

- [ ] **Step 2: Run RED**

Run: `cd app/server && node --test test/aptos-multisig-payload.test.js`

Expected: FAIL because the helper still requires `86_400` and emits `create_with_owners_and_timelock`.

- [ ] **Step 3: Implement the no-timelock path**

Use `create_with_owners`, omit both option arguments, treat missing `MultisigAccountTimeLock` as the expected state, and make verification reject any present timelock resource for this deployment profile.

- [ ] **Step 4: Run GREEN and broader governance tests**

Run: `cd app/server && node --test test/aptos-multisig-payload.test.js test/settlement-deployments.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add app/server/scripts/aptos-multisig-payload.mjs app/server/test/aptos-multisig-payload.test.js contracts/aptos/vessel_settlement/README.md
git commit -m "fix(aptos): create testnet multisig without timelock"
```

### Task 2: Create, publish, and initialize Aptos deployment

**Files:**
- Modify: `deployments/vessel-settlement.testnet.json`
- Modify: `docs/verification/contract-settlement-release-checklist.md`

**Interfaces:**
- Owner 1 creates the multisig and proposes publication/initialization.
- Owner 2 approves each proposal.
- Any owner executes after the 2-of-3 threshold because native timelock is absent.

- [ ] **Step 1: Create the multisig**

Build the entry-function payload with the helper, submit it from owner 1, wait for finality, and derive the created multisig address only from finalized transaction events/changes.

- [ ] **Step 2: Compile for the finalized multisig address**

```powershell
$visMultisig = $env:APTOS_MULTISIG_ADDRESS
if ($visMultisig -notmatch '^0x[0-9a-fA-F]{64}$') { throw 'Finalized Aptos multisig address is required' }
& 'C:\Users\TBC\AppData\Local\VesselTools\aptos-9.5.0\aptos.exe' move build-publish-payload `
  --package-dir D:\Visell\contracts\aptos\vessel_settlement `
  --named-addresses vessel_settlement=$visMultisig `
  --json-output-file D:\Visell\contracts\aptos\vessel_settlement\build\publish-payload.json
```

Set `APTOS_MULTISIG_ADDRESS` only from the finalized creation transaction; never place private material in the command.

- [ ] **Step 3: Publish through multisig**

Create the publication proposal from the compiled payload, approve with owner 2, execute, and verify both modules at the multisig address through the Testnet fullnode.

- [ ] **Step 4: Initialize through multisig**

Create the initialize proposal using the public ShelbyUSD metadata address, shared Ed25519 public key, and config version `1`; approve, execute, then verify config, vault, admin, accepted asset, and version.

- [ ] **Step 5: Update public evidence and commit**

Record only finalized public addresses and transaction hashes in the manifest/checklist, run helper `verify`, then commit.

### Task 3: Initialize Solana Program through Squads

**Files:**
- Modify: `deployments/vessel-settlement.testnet.json`
- Create: `docs/verification/solana-contract-settlement-devnet.md`

**Interfaces:**
- Final Program ID: `G2dA3Sz1XxvJ4ppkvwb95kfy5w6M9ip2KiZBmt7xbsBx`.
- Final Squads vault authority: `5dtfsZNnhctzxFq5f2g3PqYj5eSz9Ab6Tk38Wxgp72g`.
- Initialization is proposed, approved 2-of-3, and executed immediately under the Devnet beta exception.

- [ ] **Step 1: Verify current authority and accepted mint**

Read the ProgramData authority at `finalized`, verify it equals the Squads vault, and verify the Devnet USDC mint from authoritative public configuration before creating any proposal.

- [ ] **Step 2: Create and approve initialize proposal**

Encode the Anchor `initialize` instruction with the shared quote public key, verified mint, config version `1`, and Squads vault authority. Create the vault transaction and approve it with two members.

- [ ] **Step 3: Execute after the on-chain timelock**

Execute only when Squads reports the proposal executable. Verify config PDA, vault-authority PDA, vault ATA, mint, quote key, config version, and authority at `finalized`.

- [ ] **Step 4: Update manifest and evidence**

Record finalized public identifiers and signatures, then run the Solana setup verifier.

### Task 4: Real settlement and Shelby upload evidence

**Files:**
- Create: `docs/verification/aptos-contract-settlement-testnet.md`
- Complete: `docs/verification/solana-contract-settlement-devnet.md`
- Modify: `docs/verification/contract-settlement-release-checklist.md`

- [ ] **Step 1: Run native Aptos flow**

Use a non-sensitive test file, pay the Move contract, verify `SettlementReceiptV1`, register the blob, read the bytes back, compare SHA-256, retry verification, and prove replay rejection without a second debit.

- [ ] **Step 2: Run Solana DAA flow**

Pay the Program vault in Devnet USDC, verify the receipt PDA, sponsor Aptos registration, read the bytes back, compare SHA-256, retry verification, and prove replay rejection without a second debit.

- [ ] **Step 3: Run every local gate**

Run `npm run check`, 25 Move tests, Rust tests, Anchor integration, legacy-path scan, secret scan, and `git diff --check`. Expected: all pass and no secret or direct-transfer authorization remains.

### Task 5: Production release and browser acceptance

**Files:**
- Modify: `HANDOFF.md`
- Modify: `docs/verification/contract-settlement-release-checklist.md`

- [ ] **Step 1: Enable fail-closed production configuration**

Set the completed public manifest and signer secret in Vercel, set `SETTLEMENT_CONTRACTS_ENABLED=true`, and remove obsolete direct-treasury environment variables.

- [ ] **Step 2: Deploy and inspect public config**

Deploy production, confirm `/api/config` exposes both public contract deployments and no secrets, and confirm `/api/health` reports Shelby healthy.

- [ ] **Step 3: Run Chrome acceptance**

Connect Petra and a Solana wallet in the user's Chrome, exercise quote, settlement, upload, Gallery, delete popup, logout, reload recovery, explorer links, and all visible content. Wallet approvals remain user-controlled.

- [ ] **Step 4: Push and verify Git auto-deploy**

Push the verified commit, confirm Vercel's deployed Git SHA matches `git rev-parse HEAD`, and record the deployment ID and production URL.
