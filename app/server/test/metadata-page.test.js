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

test('metadata controller delegates schema, batch, export, and directory behavior', () => {
  const source = fs.readFileSync(path.join(publicDir, 'metadata-page.js'), 'utf8');
  assert.match(source, /createNftMetadata/);
  assert.match(source, /buildMetadataBatch/);
  assert.match(source, /buildMetadataZip/);
  assert.match(source, /downloadBlob/);
  assert.match(source, /collectDirectoryFiles/);
  assert.match(source, /showDirectoryPicker/);
  assert.match(source, /ArrowLeft|ArrowRight/);
  assert.match(source, /clearTimeout\(pendingBatchRebuild\).*setTimeout\([^)]*rebuildBatch/s);
  assert.doesNotMatch(source, /\b(?:alert|confirm)\s*\(/);
});
