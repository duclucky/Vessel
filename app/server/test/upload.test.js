import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicDir, readPage, getIds, hasInlineTailwindConfig } from './html-test-utils.js';

test('Upload preserves every runtime state and explains both payment paths', () => {
  const html = readPage('upload.html');
  const ids = getIds(html);
  for (const id of [
    'main-content',
    'upload-initial-view',
    'drop-zone',
    'file-input',
    'folder-picker',
    'folder-input',
    'batch-summary',
    'batch-file-count',
    'batch-total-size',
    'batch-status',
    'batch-progress',
    'batch-current-file',
    'batch-results',
    'batch-retry',
    'batch-reset',
    'upload-progress-view',
    'progress-percentage',
    'progress-bar',
    'upload-filename',
    'upload-success-view',
    'result-thumb',
    'result-key',
    'result-url',
    'copy-url',
    'result-size',
    'to-metadata',
    'retention-options',
    'retention-7',
    'retention-30',
    'retention-90',
    'retention-custom',
    'custom-days',
    'custom-days-error',
    'quote-panel',
    'quote-status',
    'quote-storage-cost',
    'quote-gas-cost',
    'quote-service-fee',
    'quote-total',
    'quote-expiration',
    'quote-countdown',
    'quote-confirm',
  ]) {
    assert.equal(ids.has(id), true, id);
  }
  assert.equal(hasInlineTailwindConfig(html), false);
  assert.match(html, /Wallet-owned upload/i);
  assert.match(html, /source-chain Vessel charge/i);
  assert.match(html, /Aptos, Solana, and Ethereum wallets/i);
  assert.match(html, /official Shelby DAA/i);
  assert.match(html, /Vessel service fee \(1%\)/i);
  assert.match(html, /Shelby storage cost/i);
  assert.match(html, /testnet DAA gas funding/i);
  assert.match(html, /Vessel fee receipt/i);
  assert.doesNotMatch(html, /Aptos sends the Vessel contract fee/i);
  assert.match(html, /Test tokens — no real monetary value/);
  assert.match(html, /role="radiogroup"[^>]*aria-labelledby="retention-title"/);
  assert.match(html, /id="custom-days"[^>]*min="1"[^>]*max="365"[^>]*step="1"/);
  assert.match(html, /id="quote-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="folder-input"[^>]*type="file"[^>]*webkitdirectory[^>]*multiple/);
  assert.match(html, /id="folder-picker"[^>]*type="button"/);
  assert.doesNotMatch(html, /for="folder-input"/);
  assert.match(html, /id="batch-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="batch-progress"[^>]*max="100"/);
  assert.match(html, /1 GB beta limit/i);
  assert.match(html, /mainnet release will support larger batches/i);
  assert.match(html, /wallet may request approval for each file/i);
  assert.doesNotMatch(html, /faucet/i);
  assert.doesNotMatch(html, /Vessel service fee \(2%\)/i);
  assert.doesNotMatch(html, /AES|encrypted|immutable|weekly/i);
});

test('Upload routes through wallet sessions without funding links or server-managed fallback', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const service = fs.readFileSync(path.join(publicDir, 'wallet-owned-upload.js'), 'utf8');
  assert.match(service, /controllerInstance\.upload\(validated\.file/);
  assert.match(source, /insufficient_apt/);
  assert.match(source, /insufficient_shelby_usd/);
  assert.match(source, /settleContractQuote\(\{/);
  assert.match(service, /getAptosSettlementClient/);
  assert.match(service, /getSolanaSettlementClient/);
  assert.match(source, /settlementTransactionId/);
  assert.match(source, /CHECK FEE RECEIPT/);
  assert.doesNotMatch(source, /settleQuote\(\{/);
  assert.doesNotMatch(source, /VERIFYING USDC|treasury wallet|direct transfer/i);
  assert.doesNotMatch(source, /\/api\/upload/);
  assert.doesNotMatch(source, /faucet/i);
});

test('Upload hashes the selected file and validates an immutable signed quote before approval', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const service = fs.readFileSync(path.join(publicDir, 'wallet-owned-upload.js'), 'utf8');
  const contentAddressSource = fs.readFileSync(path.join(publicDir, 'content-address.js'), 'utf8');
  assert.match(source, /mountQuoteUi/);
  assert.match(source, /import \{[^}]*sha256FileHex[^}]*\} from '\.\/content-address\.js'/s);
  assert.match(contentAddressSource, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(source, /createWalletOwnedUploadService/);
  assert.match(source, /walletOwnedUpload\.quote/);
  assert.match(source, /walletOwnedUpload\.validate/);
  assert.match(service, /\/api\/quotes\/upload/);
  assert.match(service, /\/api\/quotes\/validate/);
  assert.match(service, /quoteToken/);
  assert.match(service, /requiresConfirmation/);
  assert.match(source, /pendingWalletWork\.abort\(\)/);
});

test('pre-submission wallet errors restore the signed quote for retry', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(
    source,
    /activeUploadContext = quotedContext;[\s\S]*quoteUi\.render\(\{ kind: 'ready', quote: quotedContext\.quote, message \}\)/,
  );
});

test('post-payment Solana upload errors remain visible instead of disappearing with the toast', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(
    source,
    /walletOwnedUpload\.upload\(quotedContext.*?catch \(error\).*?quoteUi\.render.*?await renderRecoveryPanel\(\)/s,
  );
});

test('recovery resume renders success when Shelby confirms the recovered artifact', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const matchedCheck = source.indexOf('if (matched?.isWritten)');
  const renderRecovered = source.indexOf('renderSuccess({', matchedCheck);
  const completeRecovered = source.indexOf('recovery.complete(record.id)', matchedCheck);

  assert.equal(matchedCheck >= 0 && renderRecovered > matchedCheck && completeRecovered > matchedCheck, true);
});

test('recovery resume failure restores the visible recovery panel', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(
    source,
    /catch \(error\) \{\s*recovery\.advance\(record\.id, 'recovery_required'[\s\S]*toast\(String\(error\?\.message \|\| error\)[\s\S]*await renderRecoveryPanel\(\);/s,
  );
  assert.match(
    source,
    /recovery\.advance\(record\.id, 'recovery_required', \{ errorCode: 'acknowledgement_timeout' \}\);[\s\S]*toast\('Bytes were resent; Shelby acknowledgement is still pending'[\s\S]*await renderRecoveryPanel\(\);/s,
  );
});

test('paid recovery rebuilds the upload context without losing wallet identity', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const paidRecovery = source.slice(
    source.indexOf("if (record.stage === 'paid')"),
    source.indexOf('const outcome = await doUpload(file, recoveredContext);'),
  );

  assert.match(paidRecovery, /walletKey:\s*\[/);
  assert.match(paidRecovery, /config:\s*Object\.freeze/);
  assert.match(paidRecovery, /settlementDeployment:\s*record\.settlementDeployment/);
  assert.match(paidRecovery, /settlementNetwork:\s*recoveredSettlementNetwork/);
  assert.match(paidRecovery, /storageAccountingMicro:\s*record\.storageCostAccountingMicro/);
  assert.match(paidRecovery, /gasAccountingMicro:\s*record\.gasAccountingMicro/);
  assert.match(paidRecovery, /serviceFeeAccountingMicro:\s*record\.serviceFeeAccountingMicro/);
  assert.match(paidRecovery, /targetExpirationUtc:\s*new Date\(recoveredExpirationMs\)\.toISOString\(\)/);
});

test('paid EVM recovery retains Sepolia settlement labels', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const paidRecovery = source.slice(
    source.indexOf("if (record.stage === 'paid')"),
    source.indexOf('const outcome = await doUpload(file, recoveredContext);'),
  );

  assert.match(paidRecovery, /record\.context\.chain === 'evm'\s*\? 'Ethereum Sepolia'/);
  assert.match(paidRecovery, /record\.context\.chain === 'evm'\s*\? 'Sepolia ETH'/);
});

test('folder uploads run through the existing quote and settlement path sequentially', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(source, /import \{[^}]*createBatchQueue[^}]*runBatchQueue[^}]*\} from '\.\/batch-upload\.js'/s);
  assert.match(source, /import \{[^}]*collectDirectoryFiles[^}]*supportsDirectoryPicker[^}]*\} from '\.\/directory-picker\.js'/s);
  assert.match(source, /showDirectoryPicker\(\{ mode: 'read' \}\)/);
  assert.match(source, /await collectDirectoryFiles\(directory\)/);
  assert.match(source, /folderInput\.click\(\)/);
  assert.match(source, /folderPicker\.addEventListener\('click'/);
  assert.match(source, /folderInput\.addEventListener\('change'/);
  assert.match(source, /createBatchQueue\(files, \{ maxFileBytes/);
  assert.match(source, /await runBatchQueue\(batchQueue, uploadBatchItem/);
  assert.match(source, /await requestQuote\(item\.file/);
  assert.match(source, /await validateUploadQuote\(current/);
  assert.match(source, /sourcePath: item\.relativePath/);
  assert.match(source, /batchQueue\.retryFailed\(\)/);
});

test('folder uploads auto-resume pending Vessel fee receipts without failing the batch item', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const uploadStart = source.indexOf('function initUpload()');
  const uploadEnd = source.indexOf('function initGallery()', uploadStart);
  const upload = source.slice(uploadStart, uploadEnd);

  assert.match(upload, /function findUploadRecoveryRecordForFile/);
  assert.match(upload, /async function resumePendingBatchUpload/);
  assert.match(upload, /outcome\.error\?\.code === 'receipt_pending'/);
  assert.match(upload, /walletOwnedUpload\.resume\(file, recoveryRecord/);
  assert.match(upload, /phase: 'receiptPending'/);
  assert.match(upload, /No second payment/);
});

test('batch progress uses the Vessel palette in Chromium and Firefox', () => {
  const css = fs.readFileSync(path.join(publicDir, 'vessel.css'), 'utf8');
  assert.match(css, /#batch-progress\s*\{/);
  assert.match(css, /#batch-progress::-webkit-progress-value/);
  assert.match(css, /#batch-progress::-moz-progress-bar/);
});
