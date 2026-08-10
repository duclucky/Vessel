# One-Approval Security and Export Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one-approval uploads cryptographically authenticated on Aptos, Solana, and EVM, preserve nested batch TokenURIs, and expose one consistent styled XLSX export.

**Architecture:** A browser-safe shared module builds canonical single and batch authorization messages. A focused server verifier reconstructs those messages and applies chain-native signature verification before any Shelby write. Metadata export indexes hosted results by exact normalized path and unique basename, while UI copy consistently names the existing XLSX workbook.

**Tech Stack:** Node.js ESM, Express, Aptos TS SDK, tweetnacl Ed25519, bs58, ethers v6, browser Wallet Standard adapters, Node test runner, Vercel.

## Global Constraints

- Keep one user signature per upload or batch on Aptos, Solana, and EVM.
- Reject legacy non-cryptographic approvals instead of silently accepting them.
- Never expose or log wallet private keys, Shelby API keys, gas-station keys, or raw authorization material.
- Keep Aptos Testnet configuration present but disabled; ShelbyNet remains the live storage runtime.
- Use XLSX as the only styled manifest spreadsheet format.
- Preserve all unrelated user and untracked files.

---

### Task 1: Canonical session messages and wallet evidence

**Files:**
- Create: `app/server/public/one-approval-session.js`
- Modify: `app/server/public/wallet-owned-upload.js`
- Modify: `app/server/client-src/wallets/aptos-adapter.js`
- Modify: `app/server/client-src/wallets/solana-adapter.js`
- Modify: `app/server/client-src/wallets/evm-adapter.js`
- Test: `app/server/test/one-approval-session.test.js`
- Test: `app/server/test/aptos-adapter.test.js`
- Test: `app/server/test/solana-adapter.test.js`
- Test: `app/server/test/evm-daa-adapter.test.js`

**Interfaces:**
- Produces: `oneApprovalMessage({ intent, quote }): string`
- Produces: `oneApprovalBatchMessage({ intent, quote, manifest }): string`
- Produces: `parseAptosSignedMessage({ signedMessage, canonicalMessage }): { valid: boolean, nonce: string }`
- Wallet authorization result: `{ chain, address, message, signedMessage, signature, publicKey? }`

- [ ] **Step 1: Write failing canonical-message and adapter tests**

```js
test('Aptos approval preserves canonical and wallet-standard signed messages separately', async () => {
  const canonical = 'VESSEL_UPLOAD_SESSION\nQuoteId: quote-1';
  const fullMessage = `APTOS\nmessage: ${canonical}\nnonce: vessel-upload-session`;
  const signed = await connectedAdapter.signMessage(canonical);
  assert.equal(signed.message, canonical);
  assert.equal(signed.signedMessage, fullMessage);
  assert.match(signed.publicKey, /^0x[0-9a-f]{64}$/i);
});

test('Aptos parser extracts only an exact canonical message and fixed nonce', () => {
  const canonical = 'VESSEL_UPLOAD_SESSION\nQuoteId: quote-1';
  assert.equal(parseAptosSignedMessage({
    signedMessage: `APTOS\nmessage: ${canonical}\nnonce: vessel-upload-session`,
    canonicalMessage: canonical,
  }).valid, true);
  assert.equal(parseAptosSignedMessage({
    signedMessage: `APTOS\nmessage: ${canonical} changed\nnonce: vessel-upload-session`,
    canonicalMessage: canonical,
  }).valid, false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/one-approval-session.test.js test/aptos-adapter.test.js test/solana-adapter.test.js test/evm-daa-adapter.test.js`

Expected: FAIL because the shared module and `signedMessage` evidence do not exist.

- [ ] **Step 3: Add the shared canonical builders and preserve exact signed payloads**

```js
export const APTOS_UPLOAD_NONCE = 'vessel-upload-session';

export function oneApprovalMessage({ intent, quote }) {
  return [
    'VESSEL_UPLOAD_SESSION',
    `Chain: ${intent.chain}`,
    `Source: ${intent.sourceAddress}`,
    `Storage: ${intent.storageAddress}`,
    `FileHash: ${intent.fileHash}`,
    `BlobName: ${intent.blobName}`,
    `SizeBytes: ${intent.sizeBytes}`,
    `RetentionDays: ${intent.days}`,
    `ExpirationMicros: ${intent.expirationMicros}`,
    `MaxAccountingMicro: ${quote.totalAccountingMicro}`,
    `QuoteId: ${quote.quoteId}`,
    `QuoteExpiresAtMs: ${quote.expiresAtMs}`,
  ].join('\n');
}
```

Move the existing batch builder without changing its field order. Aptos returns canonical `message`, wallet `fullMessage` as `signedMessage`, and hex-normalized signature/public key. Solana and EVM return `signedMessage: message`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/one-approval-session.test.js test/aptos-adapter.test.js test/solana-adapter.test.js test/evm-daa-adapter.test.js`

Expected: PASS.

- [ ] **Step 5: Build browser bundles and commit checkpoint**

Run: `npm run build:client`

Expected: `BUNDLE OK` for wallet, Solana, official Shelby, and WASM assets.

```bash
git add app/server/public/one-approval-session.js app/server/public/wallet-owned-upload.js app/server/client-src/wallets/aptos-adapter.js app/server/client-src/wallets/solana-adapter.js app/server/client-src/wallets/evm-adapter.js app/server/test/one-approval-session.test.js app/server/test/aptos-adapter.test.js app/server/test/solana-adapter.test.js app/server/test/evm-daa-adapter.test.js app/server/public/vessel-wallets.js
git commit -m "Preserve canonical one-approval wallet evidence"
```

### Task 2: Strict server-side multi-chain signature verification

**Files:**
- Create: `app/server/src/lib/one-approval-authorization.js`
- Modify: `app/server/src/index.js`
- Modify: `app/server/package.json`
- Modify: `app/server/package-lock.json`
- Test: `app/server/test/one-approval-authorization.test.js`
- Test: `app/server/test/shelby-api-routes.test.js`

**Interfaces:**
- Consumes: canonical builders from `public/one-approval-session.js`
- Produces: `createOneApprovalAuthorizationVerifier({ getAptosAuthenticationKey }): async ({ authorization, context, quote, manifest? }) => boolean`

- [ ] **Step 1: Write failing real-cryptography tests**

```js
test('forged non-empty signatures fail closed on every enabled chain', async () => {
  for (const chain of ['aptos', 'solana', 'evm']) {
    assert.equal(await verifier({
      authorization: { chain, address: sourceFor(chain), message: canonicalFor(chain), signedMessage: canonicalFor(chain), signature: 'not-a-signature' },
      context: contextFor(chain),
      quote,
    }), false);
  }
});

test('valid Aptos, Solana, and EVM signatures verify against their quoted wallet', async () => {
  assert.equal(await verifier(validAptosFixture()), true);
  assert.equal(await verifier(validSolanaFixture()), true);
  assert.equal(await verifier(await validEvmFixture()), true);
});
```

Use generated test-only keys. Aptos fixtures sign the wallet-standard full message and return the matching authentication key; Solana fixtures use `nacl.sign.detached`; EVM fixtures use `Wallet.signMessage`.

- [ ] **Step 2: Run verifier tests and verify RED**

Run: `node --test test/one-approval-authorization.test.js`

Expected: FAIL because the verifier module does not exist.

- [ ] **Step 3: Implement the minimal strict verifier**

```js
export function createOneApprovalAuthorizationVerifier({ getAptosAuthenticationKey }) {
  return async function verifyOneApprovalAuthorization({ authorization, context, quote, manifest = null }) {
    const expected = manifest
      ? oneApprovalBatchMessage({ intent: context, quote, manifest })
      : oneApprovalMessage({ intent: context, quote });
    if (authorization?.message !== expected) return false;
    if (String(authorization?.chain || '').toLowerCase() !== context.chain) return false;
    if (String(authorization?.address || '').toLowerCase() !== String(context.sourceAddress).toLowerCase()) return false;
    if (context.chain === 'aptos') return verifyAptosAuthorization({ authorization, expected, getAptosAuthenticationKey });
    if (context.chain === 'solana') return verifySolanaAuthorization({ authorization, expected });
    if (context.chain === 'evm') return verifyEvmAuthorization({ authorization, expected });
    return false;
  };
}
```

Use Aptos SDK Ed25519 primitives and authentication-key derivation, tweetnacl for Ed25519 detached verification, bs58 for Solana keys, and `ethers.verifyMessage` for EVM recovery. Catch malformed encodings and return `false` without logging secrets.

- [ ] **Step 4: Await verification before all single and batch writes**

```js
if (!await verifyOneApprovalAuthorization({ authorization, context, quote })) {
  return send(res, 401, { error: 'Invalid upload session authorization', code: 'invalid_upload_authorization' });
}
```

Use the same awaited verifier with `manifest` in the batch route. Configure Aptos account binding with `aptos.getAccountInfo({ accountAddress }).authentication_key`.

- [ ] **Step 5: Run focused security and route tests**

Run: `node --test test/one-approval-authorization.test.js test/shelby-api-routes.test.js test/wallet-owned-upload.test.js`

Expected: PASS, including a source assertion that both upload routes await the strict verifier before `store.put`.

- [ ] **Step 6: Commit checkpoint**

```bash
git add app/server/src/lib/one-approval-authorization.js app/server/src/index.js app/server/package.json app/server/package-lock.json app/server/test/one-approval-authorization.test.js app/server/test/shelby-api-routes.test.js
git commit -m "Verify one-approval wallet signatures"
```

### Task 3: Nested batch TokenURI reconciliation

**Files:**
- Modify: `app/server/public/metadata-export.js`
- Test: `app/server/test/metadata-export.test.js`

**Interfaces:**
- Consumes: generated items with `outputPath` and hosted results with `sourcePath`, `metadataPath`, or `path`
- Produces: `buildCollectionManifest(...).tokenUris` containing every uniquely matched hosted result

- [ ] **Step 1: Write failing nested-path and collision tests**

```js
test('nested hosted result paths map to generated metadata basenames', () => {
  const manifest = buildCollectionManifest([
    { outputPath: '1.json', sourcePath: 'images/alpha.png', metadata: { name: 'Set #1', image: 'https://example/alpha.png' } },
    { outputPath: '2.json', sourcePath: 'images/beta.png', metadata: { name: 'Set #2', image: 'https://example/beta.png' } },
  ], [
    { sourcePath: 'Set/metadata/1.json', url: 'https://vessel/1.json' },
    { sourcePath: 'Set/metadata/2.json', url: 'https://vessel/2.json' },
  ], { collectionName: 'Set' });
  assert.deepEqual(manifest.tokenUris, ['https://vessel/1.json', 'https://vessel/2.json']);
});
```

Add a second test proving two hosted `1.json` basenames do not cross-link when no exact path matches.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test test/metadata-export.test.js`

Expected: FAIL with an empty TokenURI list for nested results.

- [ ] **Step 3: Implement exact-path plus unique-basename indexing**

```js
function hostedResultsIndex(results) {
  const exact = new Map();
  const byBasename = new Map();
  for (const result of results || []) {
    const path = normalizePath(result?.sourcePath || result?.metadataPath || result?.path);
    if (!path) continue;
    exact.set(path, result);
    const name = basename(path);
    byBasename.set(name, [...(byBasename.get(name) || []), result]);
  }
  return { exact, byBasename };
}
```

Resolve an exact normalized metadata path first. Use basename fallback only when the candidate array length is exactly one.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test test/metadata-export.test.js`

Expected: PASS.

- [ ] **Step 5: Commit checkpoint**

```bash
git add app/server/public/metadata-export.js app/server/test/metadata-export.test.js
git commit -m "Preserve nested batch TokenURI mappings"
```

### Task 4: XLSX-only export copy and final verification

**Files:**
- Modify: `app/server/public/gallery.html`
- Modify: `app/server/public/collection.html`
- Modify: `app/server/public/app.js`
- Test: `app/server/test/ledger-and-gallery.test.js`

**Interfaces:**
- Produces: UI labels that identify XLSX and downloads ending in `.xlsx` with `XLSX_MIME`

- [ ] **Step 1: Write failing UI consistency assertions**

```js
test('Gallery and Collection expose only XLSX manifest exports', () => {
  assert.match(readPage('gallery.html'), /Export Styled XLSX/);
  assert.match(readPage('collection.html'), /Export manifest XLSX/);
  assert.doesNotMatch(readPage('collection.html'), /Export manifest CSV/);
  assert.match(appSource, /-manifest\.xlsx/);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test test/ledger-and-gallery.test.js`

Expected: FAIL because Collection still says CSV and Gallery says Styled Sheet.

- [ ] **Step 3: Update labels without adding a second export format**

Change static labels to `Export Styled XLSX` and `Export manifest XLSX`. Change active-folder copy to `Export This Folder XLSX`. Keep `.xlsx`, `buildStyledWorkbook`, and the OpenXML MIME type unchanged.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test test/ledger-and-gallery.test.js`

Expected: PASS.

- [ ] **Step 5: Run complete verification**

Run: `npm run check`

Expected: all Node tests pass and client bundle prints `BUNDLE OK`.

Run: `git diff --check && git status --short`

Expected: no whitespace errors, no secrets, and only intended tracked changes plus pre-existing untracked directories.

- [ ] **Step 6: Commit checkpoint**

```bash
git add app/server/public/gallery.html app/server/public/collection.html app/server/public/app.js app/server/test/ledger-and-gallery.test.js app/server/public/vessel-wallets.js
git commit -m "Align manifest export labels with XLSX"
```

### Task 5: Production rollout and adversarial smoke

**Files:**
- No source changes expected

**Interfaces:**
- Consumes: production Vercel alias and testnet wallets
- Produces: structured evidence for authorization rejection and valid one-signature uploads

- [ ] **Step 1: Push verified commits**

Run: `git push origin main`

Expected: remote `main` advances to the verified local commit.

- [ ] **Step 2: Deploy production**

Run: `npx vercel --prod --yes`

Expected: deployment status `Ready` and alias `https://vessel-sage.vercel.app`.

- [ ] **Step 3: Verify forged authorization is rejected without a new blob**

Record the service-account artifact count, submit a quote-bound upload with `signature: "VESSEL_SECURITY_SMOKE_NONEMPTY"`, and require HTTP 401 `invalid_upload_authorization`. Re-read the artifact count and require it to remain unchanged.

- [ ] **Step 4: Verify valid wallet paths**

For Aptos Petra, Solana OKX or Phantom, and an EVM Sepolia wallet, request a fresh quote and approve once. Each request must return HTTP 200 and its resulting TokenURI or media URL must return HTTP 200. Do not claim a wallet family passed if its extension was unavailable.

- [ ] **Step 5: Verify nested collection export evidence**

Host two generated metadata JSON files with nested `sourcePath` values, build the collection manifest, and require two non-empty TokenURIs. Download the workbook and require `.xlsx`, OpenXML MIME, and a non-empty ZIP payload.

- [ ] **Step 6: Record final evidence**

Run: `npx vercel logs --environment production --since 30m --status-code 500 --limit 50 --json --no-branch`

Expected: no new HTTP 500 logs from the smoke window.
