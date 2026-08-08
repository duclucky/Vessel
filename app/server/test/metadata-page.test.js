import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getIds, publicDir, readPage } from './html-test-utils.js';
import {
  joinMetadataBaseUri,
  metadataImageMimeType,
} from '../public/metadata-page.js';

test('custom base URI preserves relative paths and encodes every segment', () => {
  assert.equal(
    joinMetadataBaseUri('https://cdn.example/collection/', 'images/One #1.png'),
    'https://cdn.example/collection/images/One%20%231.png',
  );
  assert.equal(
    joinMetadataBaseUri('ipfs://bafy-root', 'nested/001.png'),
    'ipfs://bafy-root/nested/001.png',
  );
  assert.throws(
    () => joinMetadataBaseUri('http://insecure.example', '001.png'),
    (error) => error.code === 'metadata_base_uri_invalid',
  );
});

test('image MIME type uses the browser value then a safe extension fallback', () => {
  assert.equal(metadataImageMimeType({ name: 'one.bin', type: 'image/avif' }), 'image/avif');
  assert.equal(metadataImageMimeType({ name: 'two.webp', type: '' }), 'image/webp');
  assert.equal(metadataImageMimeType({ name: 'three.unknown', type: '' }), 'image/png');
});

test('metadata controller delegates schema, batch, export, and Shelby collection behavior', () => {
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  assert.match(source, /createNftMetadata/);
  assert.match(source, /buildMetadataBatch/);
  assert.match(source, /buildMetadataZip/);
  assert.match(source, /downloadBlob/);
  assert.match(source, /loadCollections/);
  assert.match(source, /refreshCollections/);
  assert.match(source, /metadataFilesFromCollection/);
  assert.match(source, /file\.url/);
  assert.match(source, /previousAddress.*nextAddress/s);
  assert.match(source, /selectedCollectionId = ''/);
  assert.match(source, /Shelby API is paused/);
  assert.match(source, /vault-cache/);
  assert.doesNotMatch(source, /collectDirectoryFiles|showDirectoryPicker|metadata-folder-input/);
  assert.match(source, /ArrowLeft|ArrowRight/);
  assert.match(source, /clearTimeout\(pendingBatchRebuild\).*setTimeout\([^)]*rebuildBatch/s);
  assert.doesNotMatch(source, /\b(?:alert|confirm)\s*\(/);
});

test('single hosting serializes canonical JSON and delegates to wallet-owned upload', () => {
  const page = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const singleStart = page.indexOf('async function hostSingle()');
  const singleEnd = page.indexOf('async function hostBatch()', singleStart);
  const single = page.slice(singleStart, singleEnd);

  assert.match(single, /metadataJsonFile\(current\.metadata/);
  assert.match(single, /hostFiles\(\[file\]/);
  assert.match(single, /application\/json|metadataJsonFile/);
  assert.match(app, /walletOwnedUpload\.quote/);
  assert.match(app, /walletOwnedUpload\.validate/);
  assert.match(app, /walletOwnedUpload\.upload/);
  assert.doesNotMatch(app, /api\('\/api\/metadata/);
});

test('single metadata hosting shows receipt finality progress instead of raw pending toast', () => {
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  const singleStart = source.indexOf('async function hostSingle()');
  const singleEnd = source.indexOf('async function hostBatch()', singleStart);
  const single = source.slice(singleStart, singleEnd);

  assert.match(source, /function renderSingleHostingProgress/);
  assert.match(single, /onUpdate:\s*renderSingleHostingProgress/);
  assert.match(source, /Vessel is checking it automatically/);
  assert.match(source, /do not approve again/);
  assert.match(source, /Vessel fee receipt/);
  assert.doesNotMatch(source, /Vessel settlement receipt/);
  assert.doesNotMatch(source, /No second settlement/);
});

test('metadata hosting auto-resumes pending Vessel fee receipts without another approval', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const metadataStart = source.indexOf('async function initMetadata()');
  const metadataEnd = source.indexOf('const metadataPage = initMetadataPage', metadataStart);
  const metadata = source.slice(metadataStart, metadataEnd);

  assert.match(metadata, /function findMetadataRecoveryRecord/);
  assert.match(metadata, /async function resumePendingMetadataReceipt/);
  assert.equal(metadata.includes("error?.code !== 'receipt_pending'"), true);
  assert.match(metadata, /walletOwnedUpload\.resume\(file, recoveryRecord/);
  assert.match(metadata, /No second payment/);
  assert.match(metadata, /phase: 'receiptPending'/);
});

test('single hosting keeps local download enabled while writes are paused', () => {
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  assert.match(source, /singleHost\.disabled = isHosting \|\| !\(canHost && walletReady && singleValid\)/);
  assert.match(source, /singleDownload\.disabled = !ready/);
  assert.match(source, /ShelbyNet beta hosting is temporarily paused/);
});

test('metadata page sends designer preset fields into schema builders', () => {
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  assert.match(source, /preset: element\.preset\?\.value \|\| 'marketplace'/);
  assert.match(source, /animationUrl: element\.animationUrl\?\.value/);
  assert.match(source, /backgroundColor: element\.backgroundColor\?\.value/);
  assert.match(source, /category: element\.category\?\.value/);
  assert.match(source, /vesselProof: element\.vesselProof\?\.checked/);
  assert.match(source, /itemNamePattern: element\.batchItemNamePattern\?\.value/);
  assert.match(source, /renderCardPreview\(metadata\)/);
});

test('metadata form fields expose accessible help tooltips', () => {
  const html = readPage('metadata.html');
  const expectedHelpIds = [
    'metadata-preset',
    'nft-name',
    'nft-desc',
    'nft-link',
    'nft-animation-url',
    'nft-background-color',
    'nft-category',
    'single-retention-days',
    'batch-preset',
    'batch-item-name-pattern',
    'batch-name-prefix',
    'batch-external-url',
    'batch-description',
    'batch-base-uri',
    'batch-start-number',
    'batch-retention-days',
    'batch-background-color',
    'batch-animation-url',
    'batch-csv-input',
  ];

  for (const id of expectedHelpIds) {
    assert.match(html, new RegExp(`for="${id}"[\\s\\S]*aria-describedby="help-${id}"`), `${id} label should include a help trigger`);
    assert.match(html, new RegExp(`id="help-${id}"[\\s\\S]*role="tooltip"`), `${id} should have a tooltip panel`);
  }

  assert.match(html, /aria-label="Help: Template preset"/);
  assert.doesNotMatch(html, /placeholder-only/i);
});

test('metadata help tooltips are visible on hover and keyboard focus', () => {
  const css = fs.readFileSync(path.join(publicDir, 'vessel.css'), 'utf8');

  assert.match(css, /\.metadata-help-trigger/);
  assert.match(css, /\.metadata-help-popover/);
  assert.match(css, /\.metadata-help:hover\s+\.metadata-help-popover/);
  assert.match(css, /\.metadata-help:focus-within\s+\.metadata-help-popover/);
});

test('batch metadata hosting uses the retryable sequential queue and preserves successful items', () => {
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  assert.match(source, /createBatchQueue/);
  assert.match(source, /runBatchQueue/);
  assert.match(source, /vesselRelativePath/);
  assert.match(source, /batchHostQueue\.retryFailed\(\)/);
  assert.match(source, /entry\.status === 'succeeded'/);
  assert.match(source, /receipt_pending/);
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /recovery\.loadForWallet\(session\)/);
  assert.match(app, /walletOwnedUpload\.resume\(file, recoveryRecord/);
});

test('batch metadata page exposes hosted collection manifest actions', () => {
  const html = readPage('metadata.html');
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');

  for (const id of [
    'batch-manifest-panel',
    'batch-manifest-summary',
    'batch-copy-tokenuris',
    'batch-download-manifest',
  ]) {
    assert.equal(getIds(html).has(id), true, `${id} hook should exist`);
  }
  assert.match(source, /buildCollectionManifest/);
  assert.match(source, /batchCopyTokenUris/);
  assert.match(source, /batchDownloadManifest/);
  assert.match(source, /copyText\(batchManifest\.copyText\)/);
  assert.match(source, /downloadBlob\(batchManifest\.workbook/);
  assert.match(source, /\.xlsx/);
  assert.match(source, /saveCollectionManifest\(batchManifest/);
});

test('app passes collection manifest persistence into metadata page', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const metadataStart = app.indexOf('async function initMetadata()');
  const metadataEnd = app.indexOf('/* ------------------------------- boot', metadataStart);
  const metadata = app.slice(metadataStart, metadataEnd);

  assert.match(metadata, /saveCollectionManifest:/);
  assert.match(metadata, /ledger\.rememberCollectionManifest/);
  assert.match(metadata, /storageAddress:.*session\.storageAddress/s);
});
