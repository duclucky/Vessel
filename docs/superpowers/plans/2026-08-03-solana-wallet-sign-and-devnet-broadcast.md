# Solana Wallet Sign and Devnet Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phantom's failing internal send path with wallet-only signing plus explicit Devnet RPC broadcast while retaining a compatibility fallback.

**Architecture:** Normalize Wallet Standard `solana:signTransaction` in the selected-wallet adapter. The settlement builder validates the signed transaction message/signature and sends the signed bytes through its configured `Connection`; existing `signAndSendTransaction` remains the fallback.

**Tech Stack:** Node.js ESM, Wallet Standard, `@solana/web3.js`, Node test runner, Vercel, Phantom on Solana Devnet.

## Global Constraints

- Preserve unrelated dirty files.
- Never broadcast bytes whose message differs from the wallet-reviewed transaction.
- Keep the Vessel Program, vault, quote signature, and server receipt verifier unchanged.
- Do not introduce private keys or a server relayer.

---

### Task 1: Normalize wallet-only transaction signing

**Files:**
- Modify: `app/server/client-src/wallets/solana-adapter.js`
- Test: `app/server/test/solana-adapter.test.js`

- [ ] Add a failing test whose Wallet Standard mock returns `signedTransaction` from `solana:signTransaction` for `solana:devnet`.
- [ ] Run `node --test --test-name-pattern="signTransaction" test/solana-adapter.test.js` and confirm RED.
- [ ] Add `daaProvider.signTransaction(transaction)` that serializes the unsigned legacy transaction and returns the wallet's signed bytes.
- [ ] Re-run the focused test and confirm GREEN.

### Task 2: Broadcast verified signed bytes through Devnet RPC

**Files:**
- Modify: `app/server/client-src/wallets/solana-contract-settlement.js`
- Test: `app/server/test/solana-contract-settlement.test.js`

- [ ] Add a failing test proving `signTransaction` is preferred, the exact signed bytes reach `connection.sendRawTransaction`, and `signAndSendTransaction` is not called.
- [ ] Add failing cases for a mutated message and invalid payer signature; neither may broadcast.
- [ ] Run `node --test test/solana-contract-settlement.test.js` and confirm RED.
- [ ] Parse and verify the wallet result with `Transaction.from`, compare `serializeMessage()` bytes, verify signatures, then call `connection.sendRawTransaction` with confirmed preflight.
- [ ] Retain `signAndSendTransaction` only when `signTransaction` is unavailable.
- [ ] Re-run the settlement tests and confirm GREEN.

### Task 3: Restore retryable quote UI after wallet failure

**Files:**
- Modify: `app/server/public/app.js`
- Test: `app/server/test/upload.test.js`

- [ ] Add a failing source regression test requiring the settlement catch path to render the current quote as ready with the safe error message.
- [ ] Run `node --test test/upload.test.js` and confirm RED.
- [ ] Restore `activeUploadContext` and render `kind: 'ready'` before showing the error toast when no transaction ID was submitted.
- [ ] Re-run the upload tests and confirm GREEN.

### Task 4: Release and end-to-end verification

**Files:**
- Verify all scoped source/tests and the approved spec/plan.

- [ ] Run `npm run check` from `app/server` and confirm all tests plus bundle pass.
- [ ] Review `git diff --check`, secrets, scope, and stage only scoped files.
- [ ] Commit, push `main`, and wait for Vercel Production alias readiness.
- [ ] In the user's Chrome, sign the 30-day transaction, confirm its Devnet receipt, complete the Shelby write, verify Gallery and latency, then record any external blocker exactly.
