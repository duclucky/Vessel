import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLedger } from '../public/ledger.js';
import { reconcileArtifacts } from '../client-src/wallets/artifact-reconciler.js';
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
    sourcePath: 'collection/images/1.png',
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
  assert.equal(ledger.loadMine()[0].sourcePath, 'collection/images/1.png');
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

test('Gallery can select an existing wallet-owned artifact for Metadata Atelier', () => {
  const storage = memoryStorage();
  const ledger = createLedger(storage);

  ledger.selectArtifact({
    key: 'media/collection-cover.png',
    url: '/api/shelby/blobs/0xabc/media/collection-cover.png',
  });

  assert.deepEqual(ledger.selected(), {
    key: 'media/collection-cover.png',
    url: '/api/shelby/blobs/0xabc/media/collection-cover.png',
  });
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

test('Gallery exposes a Metadata action that selects the artifact before navigation', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const handler = source.indexOf("$$('.js-meta', grid)");
  const selection = source.indexOf('ledger.selectArtifact({', handler);
  const navigation = source.indexOf("location.href = '/metadata.html'", selection);

  assert.equal(handler >= 0 && selection > handler && navigation > selection, true);
  assert.match(source, /aria-label="Build artifact metadata"/);
});

test('Gallery infers image media types from Shelby blob names for remote previews', () => {
  const account = `0x${'a'.repeat(64)}`;
  const [artifact] = reconcileArtifacts([], [{
    owner: account,
    blobNameSuffix: 'media/photo.png',
    size: 42,
    creationMicros: 1_000_000,
    expirationMicros: 2_000_000,
    isWritten: true,
    isDeleted: false,
    url: `/api/shelby/blobs/${account}/media/photo.png`,
  }], { storageAddress: account });

  assert.equal(artifact.contentType, 'image/png');
});

test('wallet upload history retains collection-scale batches instead of truncating at 60 files', () => {
  const ledger = createLedger(memoryStorage());
  for (let index = 0; index < 75; index += 1) {
    ledger.commitUpload({
      key: `media/${index}.png`,
      url: `https://shelby.example/${index}.png`,
      size: 42,
      contentType: 'image/png',
      sourcePath: `collection/${index}.png`,
      ownedByYou: true,
      account: '0xabc',
      expirationMicros: 2_592_001_000_000,
    });
  }

  assert.equal(ledger.loadMine().length, 75);
  assert.equal(ledger.loadMine()[0].sourcePath, 'collection/74.png');
});

test('Metadata hosting commits the wallet-owned JSON result to the same gallery ledger', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const metadataStart = source.indexOf('async function initMetadata()');
  const metadataEnd = source.indexOf('/* ------------------------------- boot', metadataStart);
  const metadata = source.slice(metadataStart, metadataEnd);

  assert.match(metadata, /walletOwnedUpload\.upload/);
  assert.match(metadata, /ledger\.commitUpload\(result\)/);
  assert.match(metadata, /sourcePath/);
});
