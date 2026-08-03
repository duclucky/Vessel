# Vessel Solana Program Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, deploy, and integrate a Solana Program that verifies the shared Ed25519 `QuoteV1`, moves exact Devnet USDC into a PDA-controlled vault, creates a replay-proof receipt PDA, and is governed by a 24-hour autonomous Squads multisig.

**Architecture:** The wallet transaction places Solana's native Ed25519 verification instruction immediately before the Anchor `settle` instruction. The program strictly introspects that instruction, reconstructs the same BCS digest, validates quote/account context, creates `["receipt", quote_id]`, and performs an atomic `transfer_checked` into the vault ATA. Squads owns program upgrades and administrative execution.

**Tech Stack:** WSL 2 Ubuntu, Agave/Solana CLI, Anchor 1.1.2, Rust, `anchor-lang`/`anchor-spl` 1.1.2, `@anchor-lang/core` 1.1.2, `@sqds/multisig` 2.1.4, `@solana/web3.js` 1.98.4.

## Global Constraints

- Windows Solana/Anchor work runs in WSL as required by official Anchor installation guidance.
- Solana Devnet discriminator is `1` in `QuoteV1`.
- Accepted mint is Devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- The program collects the full quoted Devnet USDC total.
- The Ed25519 instruction must be immediately before `settle` and must sign the exact domain-separated QuoteV1 digest.
- Receipt PDA creation precedes token movement and prevents a second debit.
- Squads is autonomous (`configAuthority = null`), threshold `2`, three distinct members, timelock `86400` seconds.
- No direct ATA transfer or memo-only transaction can authorize storage.

---

### Task 1: Install pinned WSL tooling and scaffold Anchor workspace

**Files:**
- Create: `contracts/solana/vessel-settlement/Anchor.toml`
- Create: `contracts/solana/vessel-settlement/Cargo.toml`
- Create: `contracts/solana/vessel-settlement/package.json`
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/Cargo.toml`
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/lib.rs`
- Create: `contracts/solana/vessel-settlement/.gitignore`

**Interfaces:**
- Produces Anchor program `vessel_settlement` and generated IDL/types.

- [ ] **Step 1: Verify WSL and install official Solana/Anchor tooling**

Run from PowerShell:

```powershell
wsl --status
wsl bash -lc "curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash"
wsl bash -lc "cargo install --git https://github.com/solana-foundation/anchor avm --force && avm install 1.1.2 && avm use 1.1.2"
wsl bash -lc "solana --version && anchor --version"
```

Expected: Solana CLI prints an installed Agave release and `anchor-cli 1.1.2`.

- [ ] **Step 2: Scaffold and pin dependencies**

Use:

```toml
[dependencies]
anchor-lang = "=1.1.2"
anchor-spl = { version = "=1.1.2", features = ["token", "associated_token"] }
```

Use Node dependencies:

```json
{
  "private": true,
  "scripts": { "test": "anchor test", "build": "anchor build" },
  "devDependencies": { "@anchor-lang/core": "1.1.2", "@solana/web3.js": "1.98.4", "typescript": "5.9.2" }
}
```

- [ ] **Step 3: Build the empty program**

Run:

```powershell
wsl bash -lc "cd /mnt/d/Visell/contracts/solana/vessel-settlement && anchor build"
```

Expected: `.so`, IDL JSON, and generated TypeScript types are created under `target/`; only IDL and types explicitly required by the webapp are later copied into tracked integration files.

- [ ] **Step 4: Commit scaffold**

```powershell
git add contracts/solana/vessel-settlement
git commit -m "feat(solana): scaffold Vessel settlement program"
```

### Task 2: Manual BCS QuoteV1 digest and Ed25519 instruction parser

**Files:**
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/quote_v1.rs`
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/ed25519_ix.rs`
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/error.rs`
- Modify: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/lib.rs`
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/tests/quote_v1.rs`

**Interfaces:**
- Produces `QuoteV1::digest() -> [u8; 32]` and `verify_preceding_ed25519(instructions, key, digest) -> Result<()>`.
- Golden digest is `b25001894f27c8433e0d5ae2d386745918a2f0805811d4d72f925b66f3270918`.

- [ ] **Step 1: Write failing Rust golden-vector tests**

```rust
#[test]
fn quote_digest_matches_typescript_and_move() {
    let q = fixtures::quote_v1();
    assert_eq!(hex::encode(q.digest()), "b25001894f27c8433e0d5ae2d386745918a2f0805811d4d72f925b66f3270918");
}
```

Add parser tests for zero signatures, two signatures, wrong program ID, wrong instruction position, wrong public key, wrong message length, cross-instruction offsets, and mismatched digest.

- [ ] **Step 2: Run and confirm failure**

Run: `wsl bash -lc "cd /mnt/d/Visell/contracts/solana/vessel-settlement && cargo test -p vessel-settlement"`

Expected: FAIL because quote/parser modules are absent.

- [ ] **Step 3: Implement efficient fixed-schema BCS encoding**

Do not use bincode. Encode integers little-endian and each 32-byte vector as ULEB128 length byte `0x20` followed by its bytes:

```rust
impl QuoteV1 {
    pub fn bcs_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(256);
        out.push(self.version); out.push(self.chain); out.extend(self.network.to_le_bytes());
        for bytes in [&self.quote_id, &self.payer, &self.storage_address, &self.asset] {
            out.push(32); out.extend(bytes);
        }
        out.extend(self.amount.to_le_bytes()); out.push(32); out.extend(self.file_hash);
        out.extend(self.retention_days.to_le_bytes());
        out.extend(self.storage_expiration_micros.to_le_bytes());
        out.extend(self.quote_expires_at_secs.to_le_bytes());
        out.extend(self.config_version.to_le_bytes());
        out
    }
    pub fn digest(&self) -> [u8; 32] {
        hashv(&[b"VESSEL_SETTLEMENT_V1", &self.bcs_bytes()]).to_bytes()
    }
}
```

- [ ] **Step 4: Implement strict previous-instruction inspection**

Read `load_current_index_checked`, require index greater than zero, load index minus one, require program ID `Ed25519SigVerify111111111111111111111111111`, one signature, all three instruction indices equal `u16::MAX`, exactly 32 public-key bytes, 64 signature bytes, and a 32-byte message equal to `QuoteV1::digest()`.

- [ ] **Step 5: Run tests and commit**

Run: `wsl bash -lc "cd /mnt/d/Visell/contracts/solana/vessel-settlement && cargo test -p vessel-settlement"`

Expected: PASS.

```powershell
git add contracts/solana/vessel-settlement/programs/vessel-settlement/src contracts/solana/vessel-settlement/programs/vessel-settlement/tests/quote_v1.rs
git commit -m "feat(solana): verify canonical Vessel quote instruction"
```

### Task 3: Configuration PDA, vault ATA, settlement, and receipt PDA

**Files:**
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/state.rs`
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/instructions/initialize.rs`
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/instructions/settle.rs`
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/instructions/mod.rs`
- Modify: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/lib.rs`
- Create: `contracts/solana/vessel-settlement/tests/settlement.ts`

**Interfaces:**
- PDAs: `["config"]`, `["vault-authority"]`, and `["receipt", quote_id]`.
- Produces instructions `initialize` and `settle(quote: QuoteV1)`.

- [ ] **Step 1: Write failing Anchor integration tests**

Initialize with Devnet/local fixture mint, quote key, Squads authority fixture, config version `1`, network `1`, and paused `false`. Submit Ed25519 + settle, then assert exact payer/vault deltas and every receipt field. Resubmit and prove the receipt PDA collision prevents a second debit.

- [ ] **Step 2: Define compact state**

```rust
#[account]
pub struct Config {
    pub authority: Pubkey,
    pub quote_public_key: [u8; 32],
    pub accepted_mint: Pubkey,
    pub network: u32,
    pub config_version: u64,
    pub paused: bool,
    pub upgrade_lock_intent: bool,
    pub vault_bump: u8,
}

#[account]
pub struct SettlementReceiptV1 {
    pub quote_id: [u8; 32], pub payer: Pubkey, pub storage_address: [u8; 32],
    pub asset: Pubkey, pub amount: u64, pub file_hash: [u8; 32],
    pub storage_expiration_micros: u64, pub config_version: u64,
    pub settled_slot: u64, pub settled_at_secs: i64,
}
```

- [ ] **Step 3: Implement validation-before-CPI**

Require version `1`, chain `2`, network/config match, payer bytes equal signer key, asset equals mint, amount greater than zero, retention 1–365, quote not expired, instruction proof matches, and receipt PDA initializes successfully. Then invoke:

```rust
token_interface::transfer_checked(
    CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.payer_ata.to_account_info(),
        to: ctx.accounts.vault_ata.to_account_info(),
        authority: ctx.accounts.payer.to_account_info(),
    }), quote.amount, ctx.accounts.mint.decimals,
)?;
```

Write receipt fields and emit an equivalent Anchor event after CPI success.

- [ ] **Step 4: Add every negative test**

Cover wrong program/signature instruction, payer, network, mint, amount, expiry, retention, storage/file length at client serialization, config version, paused state, receipt PDA, token program, and replay. Assert payer/vault balances never change on failure.

- [ ] **Step 5: Run tests and commit**

Run: `wsl bash -lc "cd /mnt/d/Visell/contracts/solana/vessel-settlement && anchor test"`

Expected: PASS.

```powershell
git add contracts/solana/vessel-settlement/programs/vessel-settlement contracts/solana/vessel-settlement/tests/settlement.ts
git commit -m "feat(solana): settle USDC into receipt-backed vault"
```

### Task 4: Squads-only administration and withdrawal

**Files:**
- Create: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/instructions/admin.rs`
- Modify: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/state.rs`
- Modify: `contracts/solana/vessel-settlement/programs/vessel-settlement/src/lib.rs`
- Create: `contracts/solana/vessel-settlement/tests/admin.ts`

**Interfaces:**
- Produces `schedule_config_change`, `execute_config_change`, `pause`, `unpause`, `withdraw`, and `lock_upgrade_intent`.
- Requires `authority: Signer` equal to `Config.authority`, which is the Squads vault PDA.

- [ ] **Step 1: Write failing admin tests**

Prove non-authority failure, 86,399-second early execution failure, 86,400-second success, quote-key rotation with config-version increment, pause behavior, exact vault withdrawal signed by PDA seeds, and one-way lock intent.

- [ ] **Step 2: Implement pending change state**

Use one `PendingChange` PDA `["pending-change"]` containing kind, 32-byte value, and `execute_after_secs`. The program-level 24-hour delay is additive to the Squads timelock and protects misconfigured Squads execution.

- [ ] **Step 3: Implement exact withdrawal**

Use vault-authority seeds to sign `transfer_checked` from the vault ATA to the multisig-proposed destination ATA. Emit asset, destination, amount, and slot. Never allow a quote signer to be an admin account.

- [ ] **Step 4: Run tests and commit**

Run: `wsl bash -lc "cd /mnt/d/Visell/contracts/solana/vessel-settlement && anchor test"`

Expected: PASS.

```powershell
git add contracts/solana/vessel-settlement/programs/vessel-settlement/src contracts/solana/vessel-settlement/tests/admin.ts
git commit -m "feat(solana): govern settlement program through Squads"
```

### Task 5: Browser Solana Program transaction builder

**Files:**
- Create: `app/server/client-src/wallets/solana-contract-settlement.js`
- Create: `app/server/test/solana-contract-settlement.test.js`
- Modify: `app/server/client-src/vessel-solana.js`
- Modify: `app/server/package.json`
- Modify: `app/server/build-client.mjs`

**Interfaces:**
- Produces `submitSolanaContractSettlement({ provider, connection, deployment, contractQuote, contractSignature }) -> { transactionId }`.
- Replaces `payUSDC` direct transfer + memo.

- [ ] **Step 1: Add pinned client dependencies and failing instruction-order tests**

Add `@anchor-lang/core` `1.1.2`. Assert instruction zero is `Ed25519Program`, instruction one is the configured Vessel Program, no memo instruction exists, receipt/config/vault PDAs derive from the configured program ID, and the payer remains the wallet signer.

- [ ] **Step 2: Implement the atomic transaction**

```js
const digest = quoteDigest(contractQuote);
const verifyIx = Ed25519Program.createInstructionWithPublicKey({
  publicKey: hexBytes(deployment.quotePublicKey),
  message: digest,
  signature: hexBytes(contractSignature),
});
const settleIx = await program.methods.settle(toAnchorQuote(contractQuote)).accounts({
  payer: owner, config: configPda, receipt: receiptPda, mint,
  payerAta, vaultAta, vaultAuthority, instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
}).instruction();
const tx = new Transaction().add(verifyIx, settleIx);
```

Submit with the selected wallet and return the signature immediately after RPC submission. Finality belongs to the server adapter.

- [ ] **Step 3: Remove direct-transfer client capability**

Delete `payUSDC`, memo construction, `treasuryAta`, and direct `createTransferInstruction` usage from the exported payment surface. Preserve `usdcBalance` as a read-only funding gate.

- [ ] **Step 4: Build, test, and commit**

Run: `cd app/server && node --test test/solana-contract-settlement.test.js test/solana-daa-client.test.js && npm run build:client`

Expected: PASS and `public/vessel-solana.js` rebuilds.

```powershell
git add app/server/client-src/wallets/solana-contract-settlement.js app/server/client-src/vessel-solana.js app/server/public/vessel-solana.js app/server/test/solana-contract-settlement.test.js app/server/package.json app/server/package-lock.json app/server/build-client.mjs
git commit -m "feat(solana): settle quotes through Vessel Program"
```

### Task 6: Solana receipt PDA adapter

**Files:**
- Create: `app/server/src/lib/settlement/solana-adapter.js`
- Create: `app/server/test/solana-contract-receipt.test.js`
- Modify: `app/server/src/index.js`

**Interfaces:**
- Produces `SolanaSettlementAdapter.verify({ quote, transactionId })` returning normalized receipt.

- [ ] **Step 1: Write finality/account/token-delta tests**

Use fixtures for missing/pending transactions, failed meta, wrong program ID, wrong receipt PDA owner/discriminator, wrong quote fields, wrong vault ATA delta, wrong mint, and valid finalized receipt.

- [ ] **Step 2: Implement strict verification**

Fetch the transaction at `finalized`, derive the receipt PDA from the configured program ID and quote ID, fetch/decode the account with the generated IDL, verify transaction inclusion of the program, and compare the vault's post/pre token delta to the exact receipt amount. Return `receipt_pending` until both transaction finality and receipt account visibility are present.

- [ ] **Step 3: Register adapter and commit**

Run: `cd app/server && node --test test/solana-contract-receipt.test.js test/settlement-adapters.test.js test/payment-routes.test.js`

Expected: PASS.

```powershell
git add app/server/src/lib/settlement/solana-adapter.js app/server/src/index.js app/server/test/solana-contract-receipt.test.js
git commit -m "feat(solana): verify finalized Vessel receipt PDAs"
```

### Task 7: Autonomous Squads multisig and Devnet deployment

**Files:**
- Create: `app/server/scripts/solana-squads-setup.mjs`
- Create: `app/server/test/solana-squads-setup.test.js`
- Modify: `deployments/vessel-settlement.testnet.json`
- Modify: `contracts/solana/vessel-settlement/README.md`

**Interfaces:**
- Script modes: `derive`, `create-payload`, `verify`, `program-authority-payload`, and `lock-payload`.
- Inputs: `SOLANA_SQUADS_MEMBERS` containing three distinct public keys and threshold fixed at two.

- [ ] **Step 1: Install and test Squads payload generation**

Add `@sqds/multisig` `2.1.4` to `app/server`. Test that creation uses `configAuthority: null`, `timeLock: 86400`, threshold `2`, and three unique members with explicit proposer/voter/executor permissions.

- [ ] **Step 2: Implement non-custodial setup script**

The script builds and prints transactions but never reads member private keys. It derives the Squads multisig and vault PDA, verifies on-chain threshold/timelock/config authority, and emits the upgrade-authority transfer instruction for user approval.

- [ ] **Step 3: Deploy Program and transfer authority before enabling it**

Run in WSL:

```powershell
wsl bash -lc "cd /mnt/d/Visell/contracts/solana/vessel-settlement && anchor build && solana config set --url devnet && anchor deploy --provider.cluster devnet"
```

Initialize `Config.authority` to the verified Squads vault PDA. Transfer upgrade authority through Safe Authority Transfer or the reviewed `solana program set-upgrade-authority` instruction executed by the current authority and Squads. Do not enable the webapp until `solana program show` reports Squads as upgrade authority.

- [ ] **Step 4: Verify and record public deployment data**

Run `node app/server/scripts/solana-squads-setup.mjs verify` and assert autonomous config, threshold 2, 86,400-second timelock, expected vault PDA/ATA, accepted USDC mint, quote key, and config version.

- [ ] **Step 5: Commit deployment evidence**

```powershell
git add app/server/scripts/solana-squads-setup.mjs app/server/test/solana-squads-setup.test.js app/server/package.json app/server/package-lock.json contracts/solana/vessel-settlement/README.md deployments/vessel-settlement.testnet.json
git commit -m "chore(solana): record Squads settlement deployment"
```

### Task 8: Solana real-flow checkpoint

**Files:**
- Create: `docs/verification/solana-contract-settlement-devnet.md`

**Interfaces:**
- Produces evidence required by the rollout plan.

- [ ] **Step 1: Execute a 30-day UI upload with an installed Solana wallet**

Confirm the wallet transaction contains Ed25519 verification followed by the configured Vessel Program, exact Devnet USDC amount, correct receipt PDA, and no direct treasury transfer/memo path.

- [ ] **Step 2: Verify receipt, sponsorship, and bytes**

Record transaction signature, program ID, quote ID, receipt PDA, vault balance delta, Aptos sponsored registration transaction, storage expiration, HTTP 200 read, byte count, and SHA-256 equality. Do not record wallet/quote signatures or secret keys.

- [ ] **Step 3: Prove replay and recovery**

Interrupt backend verification after submission, resume from the stored signature, and verify no second USDC debit. Resubmit the same quote and record the receipt-account collision.

- [ ] **Step 4: Run full checks and commit evidence**

Run:

```powershell
wsl bash -lc "cd /mnt/d/Visell/contracts/solana/vessel-settlement && anchor test"
cd app/server
npm run check
```

Expected: all Rust/Anchor/Node tests PASS and browser bundles build.

```powershell
git add docs/verification/solana-contract-settlement-devnet.md
git commit -m "test(solana): record Program settlement evidence"
```
