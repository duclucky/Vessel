# Vessel Aptos Move Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, deploy, and integrate an Aptos Move settlement contract that verifies `QuoteV1`, holds ShelbyUSD service fees in a contract-owned vault, emits receipts, rejects replay, and is governed by a 24-hour Aptos Multisig Account.

**Architecture:** A Move module reconstructs the approved `QuoteV1` struct from entry-function primitives, verifies the shared Ed25519 digest, and transfers the exact fee into an object-owned fungible store. Used quote IDs live in a table and receipts are emitted as module events. Browser and server adapters target only the deployment registered in `deployments/vessel-settlement.testnet.json`.

**Tech Stack:** Aptos CLI 9.5.0, Move, Aptos Framework pinned to testnet commit `b9c6e489be6c9a51ae2266a7f3ecec5b521d2f95`, `@aptos-labs/ts-sdk` 5.2.1, Node test runner.

## Global Constraints

- Aptos Testnet chain ID is `2`.
- Accepted asset is the configured ShelbyUSD FA metadata object.
- Only the Vessel service fee/minimum uplift enters the contract vault.
- Quote signature, payer, asset, amount, file hash, storage address, retention, expiry, and config version are verified before transfer.
- One `quote_id` can debit at most once.
- Aptos Multisig Account uses a 24-hour `timelock_period` and no override threshold.
- No private key, signer seed, or multisig approval material is committed.
- Direct transfer to `GAS_STATION_ACCOUNT` or `APTOS_TREASURY_ADDRESS` is never accepted as settlement.

---

### Task 1: Pin Aptos tooling and scaffold the Move package

**Files:**
- Create: `contracts/aptos/vessel_settlement/Move.toml`
- Create: `contracts/aptos/vessel_settlement/sources/vessel_settlement.move`
- Create: `contracts/aptos/vessel_settlement/README.md`
- Create: `contracts/aptos/vessel_settlement/.gitignore`

**Interfaces:**
- Produces Move package `VesselSettlement` at named address `vessel_settlement`.
- Pins Aptos Framework source used by unit tests and bytecode builds.

- [ ] **Step 1: Install the official Windows CLI outside the repository**

Run in PowerShell:

```powershell
$aptosToolDir = 'C:\Users\TBC\AppData\Local\VesselTools\aptos-9.5.0'
New-Item -ItemType Directory -Force -Path $aptosToolDir | Out-Null
Invoke-WebRequest 'https://github.com/aptos-labs/aptos-core/releases/download/aptos-cli-v9.5.0/aptos-cli-9.5.0-Windows-x86_64.zip' -OutFile "$aptosToolDir\aptos.zip"
Expand-Archive -LiteralPath "$aptosToolDir\aptos.zip" -DestinationPath $aptosToolDir -Force
& "$aptosToolDir\aptos.exe" --version
```

Expected: `aptos 9.5.0`.

- [ ] **Step 2: Create the pinned Move manifest**

```toml
[package]
name = "VesselSettlement"
version = "1.0.0"
upgrade_policy = "compatible"

[addresses]
vessel_settlement = "_"
aptos_framework = "0x1"

[dev-addresses]
vessel_settlement = "0xcafe"

[dependencies.AptosFramework]
git = "https://github.com/aptos-labs/aptos-framework.git"
rev = "b9c6e489be6c9a51ae2266a7f3ecec5b521d2f95"
subdir = "aptos-framework"
```

- [ ] **Step 3: Add an empty compile-safe module**

```move
module vessel_settlement::vessel_settlement {
    const VERSION: u8 = 1;
    #[view]
    public fun version(): u8 { VERSION }
}
```

- [ ] **Step 4: Compile and commit**

Run:

```powershell
& 'C:\Users\TBC\AppData\Local\VesselTools\aptos-9.5.0\aptos.exe' move compile --package-dir contracts/aptos/vessel_settlement --named-addresses vessel_settlement=0xcafe
```

Expected: `BUILDING VesselSettlement` followed by success.

```powershell
git add contracts/aptos/vessel_settlement
git commit -m "feat(aptos): scaffold Vessel settlement package"
```

### Task 2: QuoteV1 reconstruction and Ed25519 verification

**Files:**
- Modify: `contracts/aptos/vessel_settlement/sources/vessel_settlement.move`
- Create: `contracts/aptos/vessel_settlement/sources/quote_v1.move`
- Create: `contracts/aptos/vessel_settlement/tests/quote_v1_tests.move`

**Interfaces:**
- Produces: `quote_v1::digest(&QuoteV1): vector<u8>` and `quote_v1::verify(&QuoteV1, public_key, signature)`.
- Consumes the Task 1 golden fixture and must produce digest `b25001894f27c8433e0d5ae2d386745918a2f0805811d4d72f925b66f3270918`.

- [ ] **Step 1: Write failing Move golden-vector tests**

```move
#[test]
fun digest_matches_typescript_golden() {
    let q = fixture_quote_with_amount(84100);
    assert!(quote_v1::digest(&q) == x"b25001894f27c8433e0d5ae2d386745918a2f0805811d4d72f925b66f3270918", 1);
}

#[test, expected_failure(abort_code = 0x10002)]
fun tampered_amount_rejects_signature() {
    let q = fixture_quote_with_amount(84101);
    quote_v1::verify_for_test(
        &q,
        x"34b4d9043156cb6dcf0beb0a2949b7559c940d2bcb6dbe8c53a9b30278e3a746",
        x"3edb1c0446ffc93b53a1f7e8f0c7f3c013f6ddb695bc17f21b5c04fa3e98d82d405e771973f4c15a3ade8841eb667fac3d56ad036399a7c14921378ca8f8da01"
    );
}
```

`fixture_quote_with_amount` constructs all remaining fields from the Task 1 fixture. The deterministic test-only Ed25519 seed is `0x66` repeated 32 bytes; only its public key/signature above are used in Move tests.

- [ ] **Step 2: Run and confirm failure**

Run: `aptos move test --package-dir contracts/aptos/vessel_settlement --named-addresses vessel_settlement=0xcafe`

Expected: FAIL because `quote_v1` does not exist.

- [ ] **Step 3: Implement canonical struct and digest**

```move
module vessel_settlement::quote_v1 {
    use std::bcs;
    use std::vector;
    use aptos_std::ed25519;
    use aptos_std::hash;

    const DOMAIN: vector<u8> = b"VESSEL_SETTLEMENT_V1";
    const EINVALID_SIGNATURE: u64 = 0x10002;

    public struct QuoteV1 has copy, drop, store {
        version: u8, chain: u8, network: u32, quote_id: vector<u8>, payer: vector<u8>,
        storage_address: vector<u8>, asset: vector<u8>, amount: u64, file_hash: vector<u8>,
        retention_days: u16, storage_expiration_micros: u64,
        quote_expires_at_secs: u64, config_version: u64,
    }

    public fun digest(q: &QuoteV1): vector<u8> {
        let bytes = DOMAIN;
        vector::append(&mut bytes, bcs::to_bytes(q));
        hash::sha2_256(bytes)
    }

    public(friend) fun verify(q: &QuoteV1, public_key: vector<u8>, signature: vector<u8>) {
        let key = ed25519::new_unvalidated_public_key_from_bytes(public_key);
        let sig = ed25519::new_signature_from_bytes(signature);
        assert!(ed25519::signature_verify_strict(&sig, &key, digest(q)), EINVALID_SIGNATURE);
    }
}
```

- [ ] **Step 4: Run Move tests and commit**

Run: `aptos move test --package-dir contracts/aptos/vessel_settlement --named-addresses vessel_settlement=0xcafe`

Expected: golden digest PASS and tampered signature aborts with `0x10002`.

```powershell
git add contracts/aptos/vessel_settlement/sources contracts/aptos/vessel_settlement/tests/quote_v1_tests.move
git commit -m "feat(aptos): verify canonical Vessel quotes"
```

### Task 3: Contract-owned vault, receipt event, and replay table

**Files:**
- Modify: `contracts/aptos/vessel_settlement/sources/vessel_settlement.move`
- Create: `contracts/aptos/vessel_settlement/tests/settlement_tests.move`

**Interfaces:**
- Produces entry function `settle(&signer, metadata, fields..., signature)` and view functions `is_settled(quote_id)`, `vault_address()`, `config()`.
- Emits `SettlementReceiptV1` with the normalized receipt fields.

- [ ] **Step 1: Write failing debit-once tests**

Create a test FA metadata object, mint 1,000,000 units to a payer, initialize the module with the fixture quote key, call `settle`, and assert payer/vault balances, replay-table membership, and emitted receipt fields. A second call with the same quote ID must abort before balance changes.

```move
#[test(admin = @vessel_settlement, payer = @0x123)]
fun valid_quote_debits_once(admin: &signer, payer: &signer) {
    let metadata = test_asset::create_and_mint(admin, payer, 1000000);
    vessel_settlement::initialize_for_test(admin, metadata, fixture_public_key(), 1);
    vessel_settlement::settle(payer, metadata, fixture_args(), fixture_signature());
    assert!(vessel_settlement::is_settled(x"1111111111111111111111111111111111111111111111111111111111111111"), 10);
    assert!(test_asset::balance(payer, metadata) == 915900, 11);
    assert!(test_asset::balance_at(vessel_settlement::vault_address(), metadata) == 84100, 12);
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `aptos move test --package-dir contracts/aptos/vessel_settlement --named-addresses vessel_settlement=0xcafe`

Expected: FAIL because settlement state and entry function are absent.

- [ ] **Step 3: Implement configuration, vault object, and validation-before-transfer**

Use a named object `b"vessel-vault-v1"`; store its `ExtendRef` in `Config` so the module can generate the vault signer for multisig withdrawals. Create the vault's primary fungible store during initialization.

Validation order inside `settle` is fixed:

```move
assert!(!config.paused, EPAUSED);
assert!(quote.version == 1 && quote.chain == 1 && quote.network == chain_id::get(), EWRONG_DOMAIN);
assert!(quote.payer == account_address::to_bytes(signer::address_of(payer)), EWRONG_PAYER);
assert!(quote.asset == account_address::to_bytes(object::object_address(&metadata)), EWRONG_ASSET);
assert!(quote.retention_days >= 1 && quote.retention_days <= 365, EINVALID_RETENTION);
assert!(timestamp::now_seconds() < quote.quote_expires_at_secs, EQUOTE_EXPIRED);
assert!(quote.config_version == config.config_version, ESTALE_CONFIG);
assert!(!table::contains(&config.settled, quote.quote_id), ERECEIPT_EXISTS);
quote_v1::verify(&quote, config.quote_public_key, signature);
primary_fungible_store::transfer(payer, metadata, config.vault_address, quote.amount);
table::add(&mut config.settled, quote.quote_id, true);
event::emit(SettlementReceiptV1 { /* every normalized field copied from quote */ });
```

- [ ] **Step 4: Add negative tests**

Test wrong chain ID, payer, asset, amount zero, file hash length, storage-address length, quote-ID length, retention 0/366, expired quote, wrong config version, pause, signature, and replay. Each test records pre/post balances and proves no transfer on failure.

- [ ] **Step 5: Run tests and commit**

Run: `aptos move test --package-dir contracts/aptos/vessel_settlement --named-addresses vessel_settlement=0xcafe --coverage`

Expected: all tests PASS; every abort branch is exercised.

```powershell
git add contracts/aptos/vessel_settlement/sources/vessel_settlement.move contracts/aptos/vessel_settlement/tests/settlement_tests.move
git commit -m "feat(aptos): settle ShelbyUSD into replay-safe vault"
```

### Task 4: Multisig-administered pause, signer rotation, withdrawal, and lock

**Files:**
- Modify: `contracts/aptos/vessel_settlement/sources/vessel_settlement.move`
- Create: `contracts/aptos/vessel_settlement/tests/admin_tests.move`

**Interfaces:**
- Produces admin entry functions `schedule_change`, `execute_change`, `withdraw`, `pause`, `unpause`, `lock_upgrade_intent`.
- All admin calls require `signer::address_of(admin) == config.admin`.

- [ ] **Step 1: Write failing authorization and timelock tests**

Test that a non-admin cannot schedule or execute; execution at 86,399 seconds fails; execution at 86,400 succeeds; signer rotation increments `config_version`; pause blocks settlement but not views; withdrawal moves exact funds; permanent lock is one-way.

- [ ] **Step 2: Implement contract-level queued changes**

Store a single `PendingChange { kind, value, execute_after_secs }`. Scheduling replaces no active proposal and sets `execute_after_secs = timestamp::now_seconds() + 86400`. Execution requires the exact admin signer and elapsed time. The Aptos Multisig Account adds a second independent 24-hour timelock at transaction execution.

- [ ] **Step 3: Implement vault withdrawal with generated object signer**

```move
let vault_signer = object::generate_signer_for_extending(&config.vault_extend_ref);
primary_fungible_store::transfer(&vault_signer, metadata, destination, amount);
event::emit(Withdrawal { asset: object::object_address(&metadata), destination, amount });
```

- [ ] **Step 4: Run tests and commit**

Run: `aptos move test --package-dir contracts/aptos/vessel_settlement --named-addresses vessel_settlement=0xcafe`

Expected: PASS.

```powershell
git add contracts/aptos/vessel_settlement/sources/vessel_settlement.move contracts/aptos/vessel_settlement/tests/admin_tests.move
git commit -m "feat(aptos): govern settlement vault with timelock"
```

### Task 5: Petra settlement transaction builder

**Files:**
- Create: `app/server/client-src/wallets/aptos-contract-settlement.js`
- Create: `app/server/test/aptos-contract-settlement.test.js`
- Modify: `app/server/client-src/vessel-wallets.js`
- Modify: `app/server/build-client.mjs`

**Interfaces:**
- Produces `submitAptosContractSettlement({ adapter, deployment, contractQuote, contractSignature }) -> { transactionId }`.
- Uses wallet-standard `signAndSubmitTransaction({ data })`.

- [ ] **Step 1: Write failing payload-shape tests**

Assert one type argument `0x1::fungible_asset::Metadata`, exact configured module function, metadata object as the first function argument, all 13 quote fields in reviewed order, and signature bytes last. Reject a session/payer mismatch before opening Petra.

- [ ] **Step 2: Implement the builder**

```js
const data = {
  function: `${deployment.moduleAddress}::vessel_settlement::settle`,
  typeArguments: ['0x1::fungible_asset::Metadata'],
  functionArguments: [
    `0x${quote.asset}`, quote.version, quote.chain, quote.network, bytes(quote.quoteId),
    bytes(quote.payer), bytes(quote.storageAddress), bytes(quote.asset), quote.amount,
    bytes(quote.fileHash), quote.retentionDays, quote.storageExpirationMicros,
    quote.quoteExpiresAtSecs, quote.configVersion, bytes(signature),
  ],
};
const submitted = await adapter.signAndSubmitTransaction({ data });
return { transactionId: String(submitted.hash) };
```

- [ ] **Step 3: Rebuild browser bundle, run tests, and commit**

Run: `cd app/server && node --test test/aptos-contract-settlement.test.js test/aptos-adapter.test.js && npm run build:client`

Expected: PASS and `public/vessel-wallets.js` rebuilds.

```powershell
git add app/server/client-src/wallets/aptos-contract-settlement.js app/server/client-src/vessel-wallets.js app/server/build-client.mjs app/server/public/vessel-wallets.js app/server/test/aptos-contract-settlement.test.js
git commit -m "feat(aptos): submit Vessel settlement through Petra"
```

### Task 6: Aptos receipt adapter and verification route

**Files:**
- Create: `app/server/src/lib/settlement/aptos-adapter.js`
- Create: `app/server/test/aptos-contract-receipt.test.js`
- Modify: `app/server/src/index.js`

**Interfaces:**
- Produces `AptosSettlementAdapter.verify({ quote, transactionId })`.
- Returns the normalized receipt from the foundation plan.

- [ ] **Step 1: Write finalized/pending/mismatch tests**

Use real-shaped Aptos REST fixtures. First call returns not found and retries; finalized success with the configured module event passes; VM failure, wrong sender, wrong module, wrong event type, wrong quote ID, wrong vault movement, and wrong amount fail.

- [ ] **Step 2: Implement bounded finality and event verification**

Call `aptos.waitForTransaction({ transactionHash, options: { timeoutSecs: 20, checkSuccess: true } })`, fetch the transaction, select exactly one `${moduleAddress}::vessel_settlement::SettlementReceiptV1` event, normalize addresses/integers, and compare every receipt field to `quote.contractQuote`.

- [ ] **Step 3: Route through the adapter registry**

`POST /api/settlements/verify` accepts `{ quoteToken, uploadContext, contractQuote, contractSignature, transactionId }`, validates both signed layers statelessly, selects the Aptos adapter, issues a receipt-bound paid authorization, and returns `{ paidAuthorization, receipt }`. A not-yet-final transaction returns HTTP 409 with `code: receipt_pending` and `retriable: true`.

- [ ] **Step 4: Run tests and commit**

Run: `cd app/server && node --test test/aptos-contract-receipt.test.js test/payment-routes.test.js test/paid-authorizations.test.js`

Expected: PASS.

```powershell
git add app/server/src/lib/settlement/aptos-adapter.js app/server/src/index.js app/server/test/aptos-contract-receipt.test.js app/server/test/payment-routes.test.js
git commit -m "feat(aptos): verify finalized Vessel settlement receipts"
```

### Task 7: Aptos Multisig Account and Testnet deployment

**Files:**
- Create: `app/server/scripts/aptos-multisig-payload.mjs`
- Create: `app/server/test/aptos-multisig-payload.test.js`
- Modify: `deployments/vessel-settlement.testnet.json`
- Modify: `contracts/aptos/vessel_settlement/README.md`

**Interfaces:**
- Script modes: `create`, `publish-payload`, `status`, and `verify`.
- Inputs: `APTOS_MULTISIG_OWNERS` as three comma-separated public addresses and `APTOS_MULTISIG_THRESHOLD=2`.

- [ ] **Step 1: Test payloads without signing**

Assert `create` targets `0x1::multisig_account::create_with_owners_and_timelock`, uses threshold `2`, `Option<u64>` timelock `86400`, and `Option<u64>` override threshold `None`. Assert publish payload targets the package named address equal to the created multisig address.

- [ ] **Step 2: Implement payload generation and fail-closed validation**

The script prints JSON wallet payloads only; it never reads owner private keys. It refuses duplicate owners, fewer than three owners, a threshold other than two, a timelock other than 86,400, or a non-Testnet ledger.

- [ ] **Step 3: Create and approve the multisig interactively**

The user signs `create` with the bootstrapper wallet, then all three members verify the on-chain owner list, threshold, and timelock. The two required owners approve the package-publish proposal through their wallets. Codex does not accept extension prompts.

- [ ] **Step 4: Publish and verify**

Run build payload:

```powershell
& 'C:\Users\TBC\AppData\Local\VesselTools\aptos-9.5.0\aptos.exe' move build-publish-payload --package-dir contracts/aptos/vessel_settlement --named-addresses vessel_settlement=$env:APTOS_MULTISIG_ADDRESS --json-output-file contracts/aptos/vessel_settlement/build/publish-payload.json
node app/server/scripts/aptos-multisig-payload.mjs publish-payload
```

After two wallet approvals and execution, run `node app/server/scripts/aptos-multisig-payload.mjs verify`.

Expected: module bytecode exists at the multisig address, `version()` returns `1`, the configured quote public key matches the server key, ShelbyUSD metadata matches the SDK constant, and timelock is 86,400 seconds.

- [ ] **Step 5: Record public deployment evidence and commit**

Update only public identifiers in `deployments/vessel-settlement.testnet.json`, run `node --test test/settlement-deployments.test.js test/aptos-multisig-payload.test.js`, then commit:

```powershell
git add app/server/scripts/aptos-multisig-payload.mjs app/server/test/aptos-multisig-payload.test.js contracts/aptos/vessel_settlement/README.md deployments/vessel-settlement.testnet.json
git commit -m "chore(aptos): record multisig settlement deployment"
```

### Task 8: Aptos real-flow checkpoint

**Files:**
- Create: `docs/verification/aptos-contract-settlement-testnet.md`

**Interfaces:**
- Produces evidence required by the rollout plan.

- [ ] **Step 1: Execute a 7-day UI upload with Petra**

Use a non-sensitive test image. Confirm the first Petra prompt calls the configured Vessel module, charges the exact ShelbyUSD service fee to the contract vault, and includes the signed quote fields. Confirm the second prompt is the Shelby registration transaction.

- [ ] **Step 2: Verify receipt, registration, and bytes**

Record transaction IDs, module address, quote ID, vault balance delta, receipt fields, Shelby registration evidence, expiration, HTTP 200 read, byte count, and SHA-256 equality. Do not record signatures or secret keys.

- [ ] **Step 3: Prove replay and recovery**

Interrupt the backend after settlement submission, reload, resume verification from the stored transaction ID, and verify no second debit. Attempt the same quote again and record the `receipt_exists` rejection.

- [ ] **Step 4: Run full checks and commit evidence**

Run: `cd app/server && npm run check`

Expected: all tests PASS and bundles build.

```powershell
git add docs/verification/aptos-contract-settlement-testnet.md
git commit -m "test(aptos): record contract settlement evidence"
```
