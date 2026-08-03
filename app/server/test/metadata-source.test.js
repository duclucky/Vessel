import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assertMetadataImageAvailable,
  resolveMetadataImageUrl,
} from '../src/lib/metadata-source.js';

test('metadata image URLs are absolute and stay on the configured VESSEL origin', () => {
  assert.equal(resolveMetadataImageUrl({
    imageUrl: '/api/shelby/blobs/0xabc/media/cover.png',
    publicBase: 'https://vessel.example',
  }), 'https://vessel.example/api/shelby/blobs/0xabc/media/cover.png');

  assert.equal(resolveMetadataImageUrl({
    imageKey: 'media/cover one.png',
    publicBase: 'https://vessel.example',
  }), 'https://vessel.example/api/media/media/cover%20one.png');

  assert.equal(resolveMetadataImageUrl({
    imageUrl: 'https://vessel.example/api/media/media/cover.png',
    publicBase: 'https://vessel.example',
  }), 'https://vessel.example/api/media/media/cover.png');
});

test('metadata image URLs reject untrusted origins and paths', () => {
  for (const imageUrl of [
    'https://attacker.example/private',
    'https://vessel.example/api/config',
    '//attacker.example/api/media/cover.png',
  ]) {
    assert.throws(
      () => resolveMetadataImageUrl({ imageUrl, publicBase: 'https://vessel.example' }),
      (error) => error.code === 'invalid_metadata_source' && error.status === 400,
    );
  }
});

test('metadata source probe requests only the first byte and accepts images', async () => {
  const calls = [];
  await assertMetadataImageAvailable({
    imageUrl: 'https://vessel.example/api/media/cover.png',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(new Uint8Array([0x89]), {
        status: 206,
        headers: { 'content-type': 'image/png' },
      });
    },
  });

  assert.deepEqual(calls, [{
    url: 'https://vessel.example/api/media/cover.png',
    options: { headers: { Range: 'bytes=0-0' } },
  }]);
});

test('metadata source probe rejects missing or non-image artifacts', async () => {
  for (const response of [
    new Response('', { status: 404 }),
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ]) {
    await assert.rejects(
      assertMetadataImageAvailable({
        imageUrl: 'https://vessel.example/api/media/missing.png',
        fetchImpl: async () => response,
      }),
      (error) => error.code === 'metadata_source_unavailable' && error.status === 422,
    );
  }
});

test('metadata route validates the normalized image before storing JSON', () => {
  const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const start = server.indexOf("app.post('/api/metadata'");
  const end = server.indexOf('// ---- Latency', start);
  const route = server.slice(start, end);
  const normalized = route.indexOf('resolveMetadataImageUrl');
  const available = route.indexOf('assertMetadataImageAvailable', normalized);
  const stored = route.indexOf('store.put', available);

  assert.equal(normalized >= 0 && available > normalized && stored > available, true);
});
