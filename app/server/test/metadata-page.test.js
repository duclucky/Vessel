import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicDir } from './html-test-utils.js';
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

test('single hosting keeps local download enabled while writes are paused', () => {
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  assert.match(source, /singleHost\.disabled = isHosting \|\| !\(canHost && walletReady && singleValid\)/);
  assert.match(source, /singleDownload\.disabled = !ready/);
  assert.match(source, /Shelby testnet hosting is temporarily paused/);
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
