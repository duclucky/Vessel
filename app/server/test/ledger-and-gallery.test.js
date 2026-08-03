import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLedger } from '../public/ledger.js';
import { readPage, getIds, publicDir } from './html-test-utils.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('successful owned upload records authoritative expiration, cost, and transaction evidence', () => {
  const ledger = createLedger(memoryStorage());
  ledger.commitUpload({
    key: 'media/a.png',
    url: 'https://shelby.example/a.png',
    size: 42,
    contentType: 'image/png',
    ownedByYou: true,
    account: '0xabc',
    expirationMicros: 2_592_001_000_000,
    transactionHash: '0xregister',
    acknowledgementHash: '0xack',
    settlementHash: '0xpayment',
    actualStorageUnits: '4200',
    actualGasUsed: '718',
  });
  assert.deepEqual(ledger.selected(), {
    key: 'media/a.png',
    url: 'https://shelby.example/a.png',
  });
  assert.equal(ledger.loadMine()[0].expiresAt, 2_592_001_000);
  assert.equal(ledger.loadMine()[0].account, '0xabc');
  assert.equal(ledger.loadMine()[0].registerTransactionHash, '0xregister');
  assert.equal(ledger.loadMine()[0].acknowledgementHash, '0xack');
  assert.equal(ledger.loadMine()[0].paymentSignature, '0xpayment');
  assert.equal(ledger.loadMine()[0].actualStorageUnits, '4200');
});

test('server-managed result is selected but not represented as wallet-owned', () => {
  const ledger = createLedger(memoryStorage(), () => 1_000);
  ledger.commitUpload({
    key: 'media/fallback.png',
    url: 'https://shelby.example/fallback.png',
    size: 7,
    ownedByYou: false,
  });
  assert.equal(ledger.selected().key, 'media/fallback.png');
  assert.deepEqual(ledger.loadMine(), []);
});

test('Gallery retains its grid hook and Vault composition', () => {
  const html = readPage('gallery.html');
  assert.equal(getIds(html).has('gallery-grid'), true);
  assert.match(html, />\s*The Vault\s*</);
  assert.match(html, /Your wallet-owned artifacts/i);
});

test('Gallery removes local state only after awaited confirmation', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const confirmation = source.indexOf('await confirmAction({');
  const guard = source.indexOf('if (!confirmed) return;', confirmation);
  const removal = source.indexOf('forgetMine(b.dataset.key)', guard);
  assert.equal(confirmation >= 0 && guard > confirmation && removal > guard, true);
});
