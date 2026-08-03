# Vessel Contract Settlement Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate both chain-native settlement deployments into Vessel, remove every direct-transfer authorization path, verify real Aptos and Solana uploads, and deploy the contract-only beta to Vercel with automatic Git deployment enabled.

**Architecture:** Upload quotes contain two signed layers: the existing server context token for stateless upload orchestration and the Ed25519 `QuoteV1` that contracts verify on-chain. A single `/api/settlements/verify` route validates both layers, verifies the chain-native receipt through the configured adapter, and issues one receipt-bound paid authorization. The UI persists submission evidence before verification and resumes without charging twice.

**Tech Stack:** Existing Vessel Node/browser app, Aptos Move deployment, Solana Anchor deployment, Vercel CLI/Git integration, Chrome with installed wallets.

## Global Constraints

- This plan begins only after the foundation, Aptos, and Solana plans pass their local checkpoints.
- Production enables settlement only when both deployment records are complete and share the configured Ed25519 public key/config version.
- Direct Aptos FA transfers, Solana ATA transfers, and memo-only payments never authorize upload.
- Aptos UI distinguishes contract service fee from direct APT/Shelby protocol costs.
- Solana UI identifies the recipient as `Vessel Program vault`.
- Recovery retries a recorded transaction ID and never opens a new wallet approval automatically.
- Deployment waits for one real 7-day Aptos upload and one real 30-day Solana DAA upload.
- Testnet tokens are always labeled as having no real monetary value.

---

### Task 1: Stateless dual-signed quote and verification API

**Files:**
- Modify: `app/server/src/lib/quotes.js`
- Modify: `app/server/src/lib/settlement/contract-quotes.js`
- Modify: `app/server/src/index.js`
- Modify: `app/server/src/lib/telemetry.js`
- Modify: `app/server/test/quotes.test.js`
- Modify: `app/server/test/payment-routes.test.js`
- Modify: `app/server/test/telemetry.test.js`

**Interfaces:**
- `POST /api/quotes/upload` returns existing display/context fields plus `contractQuote`, `contractSignature`, `quotePublicKey`, and configured deployment summary.
- `POST /api/settlements/verify` accepts `{ quoteToken, uploadContext, contractQuote, contractSignature, transactionId }`.

- [ ] **Step 1: Write failing stateless verification tests**

Create the quote in one manager/server instance and verify it in a fresh instance with the same environment keys. Reject changed upload context, changed contract quote, changed signature, overlap mismatch, unsupported chain, unknown deployment, and missing transaction ID.

- [ ] **Step 2: Bind overlapping contexts before chain RPC**

Verify:

```js
assert(contractQuote.fileHash === uploadContext.fileHash);
assert(contractQuote.payer === addressBytes32(uploadContext.sourceAddress, uploadContext.chain));
assert(contractQuote.storageAddress === addressBytes32(uploadContext.storageAddress, 'aptos'));
assert(contractQuote.retentionDays === uploadContext.days);
assert(contractQuote.storageExpirationMicros === String(uploadContext.expirationMicros));
assert(contractQuote.amount === expectedSettlementAmount(uploadContext.chain, signedServerQuote.breakdown));
```

The server context token remains an internal stateless context envelope; it is never accepted without a valid contract signature and receipt.

- [ ] **Step 3: Route to adapter and issue authorization**

```js
const receipt = await settlementAdapters.verify({ chain: uploadContext.chain, quote, transactionId });
const paidAuthorization = paidAuthorizations.issue({ quote, receipt });
send(res, 200, { ok: true, paidAuthorization, receipt });
```

Return `receipt_pending` as HTTP 409/retriable and every immutable mismatch as non-retriable HTTP 400/402.

Emit redacted `settlement_submitted`, `receipt_pending`, `receipt_verified`, and `settlement_failed` telemetry with chain, deployment ID, hashed quote ID, config version, and finality latency. Never log contract signatures, wallet signatures, signed quote bytes, paid authorizations, or file content.

- [ ] **Step 4: Run tests and commit**

Run: `cd app/server && node --test test/quotes.test.js test/contract-quotes.test.js test/payment-routes.test.js test/paid-authorizations.test.js test/telemetry.test.js`

Expected: PASS.

```powershell
git add app/server/src/lib/quotes.js app/server/src/lib/settlement/contract-quotes.js app/server/src/index.js app/server/src/lib/telemetry.js app/server/test/quotes.test.js app/server/test/payment-routes.test.js app/server/test/telemetry.test.js
git commit -m "feat(payment): verify dual-signed contract settlements"
```

### Task 2: Contract-only upload UI and recovery wiring

**Files:**
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/settlement-client.js`
- Modify: `app/server/public/contract-settlement-client.js`
- Modify: `app/server/public/recovery-ledger.js`
- Modify: `app/server/public/upload.html`
- Modify: `app/server/test/settlement-client.test.js`
- Modify: `app/server/test/upload.test.js`
- Modify: `app/server/test/recovery-ledger.test.js`

**Interfaces:**
- Consumes Aptos/Solana chain clients from their implementation plans.
- Produces UI states `settlement_approval`, `settlement_pending`, `receipt_verified`, `registering`, `writing`, and `active`.

- [ ] **Step 1: Write failing chain-specific UI tests**

Assert Aptos copy says `Vessel contract fee` and separately lists protocol ShelbyUSD/APT. Assert Solana copy says `Vessel Program vault`. Assert no string says treasury wallet, `VERIFYING USDC` on Aptos, or direct transfer.

- [ ] **Step 2: Replace `settleQuote` dispatch**

```js
const chainClient = session.chain === 'aptos'
  ? walletController().getAptosSettlementClient()
  : SOL().contractSettlementClient();
const settlement = await settleContractQuote({
  quote: quotedContext.quote,
  chainClient,
  request: api,
  transactionId: recoveryRecord?.settlementTransactionId,
  onSubmitted: ({ transactionId }) => recovery.advance(quoteId, 'settlement_submitted', { settlementTransactionId: transactionId }),
});
```

Only an explicit user click may call `chainClient.submit`. Automatic recovery calls verification with the stored ID.

- [ ] **Step 3: Render durable pending and receipt states**

`receipt_pending` leaves the file/quote visible, displays the explorer transaction link, and offers `CHECK PAYMENT STATUS`. `receipt_exists` triggers receipt lookup and recovery, not a new payment.

- [ ] **Step 4: Run tests and commit**

Run: `cd app/server && node --test test/settlement-client.test.js test/contract-settlement-client.test.js test/recovery-ledger.test.js test/upload.test.js`

Expected: PASS.

```powershell
git add app/server/public/app.js app/server/public/settlement-client.js app/server/public/contract-settlement-client.js app/server/public/recovery-ledger.js app/server/public/upload.html app/server/test/settlement-client.test.js app/server/test/upload.test.js app/server/test/recovery-ledger.test.js
git commit -m "feat(upload): use contract receipts for every payment"
```

### Task 3: Remove legacy direct-transfer code and configuration

**Files:**
- Delete: `app/server/src/lib/payments.js`
- Delete: `app/server/src/lib/aptos-settlement.js`
- Delete: `app/server/test/payments.test.js`
- Delete: `app/server/test/aptos-settlement.test.js`
- Modify: `app/server/src/config.js`
- Modify: `app/server/src/index.js`
- Modify: `app/server/.env.example`
- Modify: `app/server/test/config.test.js`
- Modify: `app/server/test/payment-routes.test.js`

**Interfaces:**
- Removes `PaymentManager`, `verifyQuotePayment`, `verifyAptosShelbyUsdTransfer`, `/api/pay/solana/verify`, and `/api/pay/aptos/verify`.
- Contract adapter registry becomes the only settlement verifier.

- [ ] **Step 1: Write the release scan test**

Add assertions that production source does not contain:

```text
SOLANA_TREASURY_SECRET_KEY
APTOS_TREASURY_ADDRESS
treasuryAta
primary_fungible_store::transfer
createTransferInstruction
/api/pay/solana/verify
/api/pay/aptos/verify
verifyQuotePayment
verifyAptosShelbyUsdTransfer
```

Generated wallet bundles are checked after rebuilding; the Move contract's legitimate internal FA transfer is outside `app/server` and excluded from this scan.

- [ ] **Step 2: Delete legacy modules and routes**

Remove constructors, enrichers, public config fields, old verification endpoints, and old env documentation. Keep `GAS_STATION_ACCOUNT` because it sponsors Solana DAA registration, not because it receives user payment.

- [ ] **Step 3: Rebuild bundles and run exact scan**

Run:

```powershell
cd app/server
npm run build:client
rg -n "SOLANA_TREASURY_SECRET_KEY|APTOS_TREASURY_ADDRESS|treasuryAta|createTransferInstruction|/api/pay/(solana|aptos)/verify|verifyQuotePayment|verifyAptosShelbyUsdTransfer" . --glob '!node_modules/**'
```

Expected: no output.

- [ ] **Step 4: Run tests and commit**

Run: `cd app/server && npm run check`

Expected: all tests PASS and bundles build.

```powershell
git add -A app/server/src/lib/payments.js app/server/src/lib/aptos-settlement.js app/server/test/payments.test.js app/server/test/aptos-settlement.test.js app/server/src/config.js app/server/src/index.js app/server/.env.example app/server/test/config.test.js app/server/test/payment-routes.test.js app/server/public/vessel-wallets.js app/server/public/vessel-solana.js
git commit -m "refactor(payment): remove direct treasury settlement"
```

### Task 4: Cross-chain browser acceptance with mocked wallets

**Files:**
- Create: `app/server/test/contract-settlement-flow.test.js`
- Modify: `app/server/test/ledger-and-gallery.test.js`
- Modify: `app/server/test/transaction-evidence.test.js`

**Interfaces:**
- Produces deterministic end-to-end tests for both chain families without extension prompts.

- [ ] **Step 1: Add Aptos success/interruption scenarios**

Mock Petra submission, finalized Move receipt, Shelby registration, byte acknowledgement, and Gallery reconciliation. Interrupt after contract submission and after receipt verification; prove each resumes without another submit call.

- [ ] **Step 2: Add Solana success/interruption scenarios**

Mock Ed25519 + Program settlement, receipt PDA finality, sponsored Aptos registration, byte acknowledgement, and Gallery reconciliation. Prove direct transfer fixtures are rejected.

- [ ] **Step 3: Add wallet/network mutation scenarios**

Change wallet, account, network, file hash, retention, and expiration after quote issuance. Each change invalidates the active quote before any contract submission.

- [ ] **Step 4: Run tests and commit**

Run: `cd app/server && node --test test/contract-settlement-flow.test.js test/ledger-and-gallery.test.js test/transaction-evidence.test.js`

Expected: PASS.

```powershell
git add app/server/test/contract-settlement-flow.test.js app/server/test/ledger-and-gallery.test.js app/server/test/transaction-evidence.test.js
git commit -m "test(payment): cover contract settlement upload flows"
```

### Task 5: Security and release gate

**Files:**
- Create: `docs/verification/contract-settlement-release-checklist.md`
- Modify: `README.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Produces an auditable go/no-go decision before production deployment.

- [ ] **Step 1: Run all local suites**

```powershell
cd D:\Visell\app\server
npm run check
wsl bash -lc "cd /mnt/d/Visell/contracts/solana/vessel-settlement && anchor test"
& 'C:\Users\TBC\AppData\Local\VesselTools\aptos-9.5.0\aptos.exe' move test --package-dir D:\Visell\contracts\aptos\vessel_settlement --named-addresses vessel_settlement=0xcafe --coverage
```

Expected: every Node, Move, Rust, and Anchor test PASS.

- [ ] **Step 2: Verify deployment and governance state from chain**

Run both setup scripts in `verify` mode. Expected: configured module/program IDs, accepted assets, quote key, config version, 2-of-3 multisig thresholds, 86,400-second timelocks, vault identifiers, and upgrade authorities match the manifest.

- [ ] **Step 3: Verify real-flow evidence**

Both `docs/verification/aptos-contract-settlement-testnet.md` and `docs/verification/solana-contract-settlement-devnet.md` must contain transaction IDs, receipt IDs, byte hashes, expirations, replay rejection, and interruption recovery. Missing either chain is a no-go.

- [ ] **Step 4: Scan secrets and final diff**

```powershell
cd D:\Visell
git diff --check
git status --short
rg -n "BEGIN PRIVATE|PRIVATE KEY|QUOTE_SIGNER_PRIVATE_KEY_B64=.+|SOLANA_TREASURY_SECRET_KEY=.+|SHELBY_SOLANA_SECRET_KEY=\[[0-9]" --glob '!app/server/.env' --glob '!node_modules/**'
```

Expected: no secret values; only intended changes and preserved user-owned files.

- [ ] **Step 5: Write go/no-go evidence and commit**

Update README/HANDOFF to describe contract vaults and explorers. Commit only after every gate is green:

```powershell
git add docs/verification/contract-settlement-release-checklist.md README.md HANDOFF.md
git commit -m "docs(release): approve contract-only settlement beta"
```

### Task 6: Configure Vercel and deploy contract-only beta

**Files:**
- Modify: `app/server/vercel.json` only if environment routing requires no code-secret exposure.

**Interfaces:**
- Production variables: settlement enable flag, deployment manifest path/data, Ed25519 signer secret/public key, existing Shelby/gas-station secrets.

- [ ] **Step 1: Set production environment safely**

From `app/server`, use Vercel CLI interactive encrypted env input for `QUOTE_SIGNER_PRIVATE_KEY_B64`. Set non-secret `QUOTE_SIGNER_PUBLIC_KEY_HEX` and `SETTLEMENT_CONTRACTS_ENABLED=true`. Remove production `SOLANA_TREASURY_SECRET_KEY` and `APTOS_TREASURY_ADDRESS` after confirming no rollback relies on them.

- [ ] **Step 2: Deploy production and verify health**

Run:

```powershell
cd D:\Visell\app\server
vercel deploy --prod --yes
```

Expected: deployment succeeds; `/api/config` reports contract settlement enabled and only public module/program/vault identifiers.

- [ ] **Step 3: Smoke-test without spending**

Open the production Upload page in Google Chrome, connect each wallet family, select a non-sensitive file, request 7-day and 30-day quotes, and inspect that approval targets the configured contract/program. Do not approve another payment during this smoke test.

- [ ] **Step 4: Push and verify automatic Git deployment**

Run `git push origin main`. Confirm the linked Vercel project creates a deployment for the pushed commit and that its commit SHA matches `git rev-parse HEAD`. If Git integration is missing, link the existing repository/project in Vercel settings before considering auto-deploy enabled.

- [ ] **Step 5: Record deployment URL and commit hash**

Append the production URL, Vercel deployment ID, Git SHA, Aptos module, and Solana program ID to the release checklist without including secrets.

### Task 7: Final production acceptance and handoff

**Files:**
- Modify: `docs/verification/contract-settlement-release-checklist.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Produces the final operator handoff and unlocks the renewal/expiry implementation plan.

- [ ] **Step 1: Execute one production-hosted testnet flow per chain**

Repeat the real 7-day Aptos and 30-day Solana uploads from the deployed site. Approvals remain user-controlled. Verify receipts against public explorers and Shelby bytes against local SHA-256.

- [ ] **Step 2: Verify UX and recovery**

Read all visible Upload, Gallery, wallet modal, error, pending, success, and explorer-link content. Confirm no Chrome native confirm dialog, no direct treasury label, and no second charge after reload.

- [ ] **Step 3: Run final source verification**

Run `cd app/server && npm run check` and the exact legacy scan from Task 3.

Expected: all checks PASS and legacy scan has no output.

- [ ] **Step 4: Commit handoff and push**

```powershell
git add docs/verification/contract-settlement-release-checklist.md HANDOFF.md
git commit -m "docs(handoff): record contract settlement production run"
git push origin main
```

- [ ] **Step 5: Resume Phase 3 only after this checkpoint**

Open `docs/superpowers/plans/2026-08-03-vessel-renewal-expiry.md` and revise its payment steps to consume contract receipts before executing any renewal work.
