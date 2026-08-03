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
  assert.match(html, /Aptos wallets sign directly and pay APT \+ ShelbyUSD/i);
  assert.match(html, /Solana wallets use sponsored DAA/i);
  assert.match(html, /testnet USDC/i);
  assert.match(html, /Test tokens — no real monetary value/);
  assert.match(html, /role="radiogroup"[^>]*aria-labelledby="retention-title"/);
  assert.match(html, /id="custom-days"[^>]*min="1"[^>]*max="365"[^>]*step="1"/);
  assert.match(html, /id="quote-status"[^>]*aria-live="polite"/);
  assert.doesNotMatch(html, /faucet/i);
  assert.doesNotMatch(html, /AES|encrypted|immutable|weekly/i);
});

test('Upload routes through wallet sessions without funding links or server-managed fallback', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(source, /walletController\(\)\.upload\(file/);
  assert.match(source, /insufficient_apt/);
  assert.match(source, /insufficient_shelby_usd/);
  assert.doesNotMatch(source, /\/api\/upload/);
  assert.doesNotMatch(source, /faucet/i);
});

test('Upload hashes the selected file and validates an immutable signed quote before approval', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(source, /mountQuoteUi/);
  assert.match(source, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(source, /\/api\/quotes\/upload/);
  assert.match(source, /\/api\/quotes\/validate/);
  assert.match(source, /quoteToken/);
  assert.match(source, /requiresConfirmation/);
  assert.match(source, /pendingWalletWork\.abort\(\)/);
});
