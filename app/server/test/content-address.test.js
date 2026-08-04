import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contentAddressedBlobName,
  sha256FileHex,
  vesselBlobUrl,
} from '../public/content-address.js';

test('SHA-256 and content-addressed names are deterministic', async () => {
  const file = new File(['hello'], 'Portrait.PN-G', { type: 'image/png' });
  const hash = await sha256FileHex(file);

  assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(contentAddressedBlobName(file, hash), `media/${hash}.png`);
  assert.equal(contentAddressedBlobName(new File(['x'], 'README'), 'ab'.repeat(32)), `media/${'ab'.repeat(32)}.bin`);
});

test('content-addressed names reject malformed hashes', () => {
  assert.throws(
    () => contentAddressedBlobName(new File(['x'], 'x.png'), '../bad'),
    (error) => error.code === 'content_hash_invalid',
  );
});

test('Vessel read URLs encode the account and every blob path segment', () => {
  assert.equal(
    vesselBlobUrl({
      origin: 'https://vessel.example/',
      storageAddress: '0xabc',
      blobName: 'media/cover one#.png',
    }),
    'https://vessel.example/api/shelby/blobs/0xabc/media/cover%20one%23.png',
  );
});
