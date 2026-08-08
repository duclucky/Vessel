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
    storageCostAccountingMicro: '13',
    gasAccountingMicro: '35000',
    serviceFeeAccountingMicro: '841',
    totalAccountingMicro: '35854',
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
  assert.equal(ledger.loadMine()[0].storageCostAccountingMicro, '13');
  assert.equal(ledger.loadMine()[0].gasAccountingMicro, '35000');
  assert.equal(ledger.loadMine()[0].serviceFeeAccountingMicro, '841');
  assert.equal(ledger.loadMine()[0].totalAccountingMicro, '35854');
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

test('single metadata hosting links the TokenURI back to the source artifact', () => {
  const ledger = createLedger(memoryStorage(), () => 9_999);
  ledger.commitUpload({
    key: 'media/source.png',
    url: 'https://shelby.example/media/source.png',
    size: 42,
    contentType: 'image/png',
    sourcePath: 'source.png',
    ownedByYou: true,
    account: '0xabc',
    expirationMicros: 2_592_001_000_000,
  });

  ledger.attachTokenUriToArtifact('media/source.png', 'https://shelby.example/metadata/source.json');

  assert.equal(ledger.loadMine()[0].key, 'media/source.png');
  assert.equal(ledger.loadMine()[0].tokenUri, 'https://shelby.example/metadata/source.json');
  assert.equal(ledger.loadMine()[0].metadataUrl, 'https://shelby.example/metadata/source.json');
  assert.equal(ledger.loadMine()[0].tokenUriUpdatedAt, 9_999);
});

test('Gallery retains its grid hook and Vault composition', () => {
  const html = readPage('gallery.html');
  assert.equal(getIds(html).has('gallery-grid'), true);
  assert.equal(getIds(html).has('image-gallery-grid'), true);
  assert.equal(getIds(html).has('metadata-gallery-grid'), true);
  assert.equal(getIds(html).has('gallery-search'), true);
  assert.equal(getIds(html).has('gallery-image-empty'), true);
  assert.equal(getIds(html).has('gallery-metadata-empty'), true);
  assert.equal(getIds(html).has('fee-total-paid'), true);
  assert.equal(getIds(html).has('fee-storage-cost'), true);
  assert.equal(getIds(html).has('fee-service-fee'), true);
  assert.equal(getIds(html).has('fee-unitemized'), true);
  assert.match(html, />\s*The Vault\s*</);
  assert.match(html, /Your wallet-owned artifacts/i);
});

test('Gallery renders an aggregate fee dashboard from local upload history', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(source, /renderFeeDashboard/);
  assert.match(source, /fee-total-paid/);
  assert.match(source, /storageCostAccountingMicro/);
  assert.match(source, /serviceFeeAccountingMicro/);
  assert.match(source, /totalAccountingMicro/);
  assert.match(source, /hasAccountingBreakdown/);
  assert.match(source, /Not recorded/);
  assert.match(source, /fee-unitemized/);
});

test('Gallery separates media collections from hosted metadata TokenURIs', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const html = readPage('gallery.html');
  const galleryStart = source.indexOf('async function initGallery()');
  const galleryEnd = source.indexOf('function accountingMicro', galleryStart);
  const gallery = source.slice(galleryStart, galleryEnd);

  assert.match(gallery, /splitGalleryArtifacts/);
  assert.match(gallery, /folderCollectionCard/);
  assert.match(gallery, /metadataCard/);
  assert.match(gallery, /activeGalleryCollection/);
  assert.match(source, /function sourceDisplayName/);
  assert.match(gallery, /gallery-search/);
  assert.match(html, /No media artifacts yet/);
  assert.match(html, /No hosted TokenURI metadata yet/);
  const metadataCardStart = source.indexOf('function metadataCard');
  const metadataCardEnd = source.indexOf('async function initGallery()', metadataCardStart);
  assert.doesNotMatch(source.slice(metadataCardStart, metadataCardEnd), /js-meta/);
});

test('Collection detail page exposes NFT set summary and TokenURI actions', () => {
  const html = readPage('collection.html');
  const ids = getIds(html);
  for (const id of [
    'collection-title',
    'collection-count',
    'collection-tokenuri-list',
    'collection-copy-tokenuris',
    'collection-export-manifest',
    'collection-table',
  ]) {
    assert.equal(ids.has(id), true, `${id} hook should exist`);
  }
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /async function initCollection/);
  assert.match(app, /loadCollectionManifests/);
  assert.match(app, /collection-copy-tokenuris/);
  assert.match(app, /collection-export-manifest/);
  assert.match(app, /collection: initCollection/);
});

test('Proof page exposes shareable artifact and collection evidence hooks', () => {
  const html = readPage('proof.html');
  const ids = getIds(html);
  for (const id of [
    'proof-title',
    'proof-status',
    'proof-media-url',
    'proof-tokenuri-url',
    'proof-copy-link',
    'proof-collection-list',
  ]) {
    assert.equal(ids.has(id), true, `${id} hook should exist`);
  }
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /async function initProof/);
  assert.match(app, /proof-copy-link/);
  assert.match(app, /proof: initProof/);
  assert.match(app, /Share proof/);
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

test('Gallery preview treats SVG and legacy image keys as renderable images', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(source, /isRenderableImageArtifact/);
  assert.match(source, /isRenderableVideoArtifact/);
  assert.match(source, /\(\?:avif\|gif\|jpe\?g\|png\|svg\|webp\)/);
  assert.match(source, /\(\?:mp4\|mov\|m4v\|webm\)/);
  assert.match(source, /image\/svg\+xml/);
  assert.match(source, /type\.startsWith\('video\/'\)/);
  assert.match(source, /<video class=/);
  assert.match(source, /src="\$\{url\}"/);
});

test('Gallery marks already-failed image previews as unavailable', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const listener = source.indexOf("$$('.js-artifact-image', grid)");
  const completeGuard = source.indexOf('img.complete && img.naturalWidth === 0', listener);
  const fallbackCopy = source.indexOf('Blob unavailable or expired', completeGuard);

  assert.equal(listener >= 0 && completeGuard > listener && fallbackCopy > completeGuard, true);
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

test('collection manifests are wallet scoped and preserve image to TokenURI mappings', () => {
  const ledger = createLedger(memoryStorage(), () => 1234);
  ledger.rememberCollectionManifest({
    id: 'genesis',
    name: 'Genesis',
    storageAddress: '0xabc',
    rows: [
      {
        itemName: 'Genesis #1',
        sourcePath: 'genesis/1.png',
        imageUrl: 'https://vessel.example/media/1.png',
        metadataPath: 'metadata/1.json',
        metadataUrl: 'https://vessel.example/metadata/1.json',
      },
    ],
    tokenUris: ['https://vessel.example/metadata/1.json'],
  });

  assert.deepEqual(ledger.loadCollectionManifests('0xabc'), [{
    id: 'genesis',
    name: 'Genesis',
    storageAddress: '0xabc',
    rows: [{
      itemName: 'Genesis #1',
      sourcePath: 'genesis/1.png',
      imageUrl: 'https://vessel.example/media/1.png',
      metadataPath: 'metadata/1.json',
      metadataUrl: 'https://vessel.example/metadata/1.json',
    }],
    tokenUris: ['https://vessel.example/metadata/1.json'],
    updatedAt: 1234,
  }]);
  assert.deepEqual(ledger.loadCollectionManifests('0xdef'), []);
});

test('Metadata hosting commits the wallet-owned JSON result to the same gallery ledger', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const metadataStart = source.indexOf('async function initMetadata()');
  const metadataEnd = source.indexOf('/* ------------------------------- boot', metadataStart);
  const metadata = source.slice(metadataStart, metadataEnd);
  const page = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');

  assert.match(metadata, /walletOwnedUpload\.upload/);
  assert.match(metadata, /ledger\.commitUpload\(result\)/);
  assert.match(metadata, /attachTokenUriToArtifact/);
  assert.match(page, /saveArtifactTokenUri/);
  assert.match(metadata, /sourcePath/);
  const uploader = fs.readFileSync(path.join(publicDir, 'wallet-owned-upload.js'), 'utf8');
  assert.match(uploader, /storageCostAccountingMicro: validated\.quote\.storageAccountingMicro/);
  assert.match(uploader, /serviceFeeAccountingMicro: validated\.quote\.serviceFeeAccountingMicro/);
});

test('Gallery proof links include a hosted TokenURI when metadata is attached', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const cardStart = source.indexOf('function gcard');
  const cardEnd = source.indexOf('function newSlot', cardStart);
  const card = source.slice(cardStart, cardEnd);
  const proofHandler = source.slice(
    source.indexOf("$$('.js-proof', grid)"),
    source.indexOf("$$('.js-del', grid)"),
  );

  assert.match(card, /data-tokenuri="\$\{tokenUri\}"/);
  assert.match(proofHandler, /proof\.searchParams\.set\('tokenuri', b\.dataset\.tokenuri \|\| ''\)/);
});

test('Proof page explains when an artifact has no hosted TokenURI yet', () => {
  const html = readPage('proof.html');
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');

  assert.equal(getIds(html).has('proof-tokenuri-helper'), true);
  assert.match(html, /Create TokenURI/);
  assert.match(source, /No TokenURI has been attached to this artifact yet/);
});

test('Metadata loader reconciles local collection paths with remote Shelby artifacts', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const start = source.indexOf('async function initMetadata()');
  const end = source.indexOf('/* ------------------------------- boot', start);
  const metadata = source.slice(start, end);

  assert.match(metadata, /listArtifacts\(\)/);
  assert.match(metadata, /reconcileArtifacts\(loadMine\(\), remote\)/);
  assert.match(metadata, /groupVaultCollections/);
  assert.match(metadata, /loadCollections/);
  assert.match(metadata, /cfg\.shelbyWritesEnabled === false/);
  assert.match(metadata, /verification: 'vault-cache'/);
});
