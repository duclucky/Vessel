import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contentAddressedBlobName,
  createFileHashCache,
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

test('file hash cache shares in-flight work and retries after a failure', async () => {
  const file = new File(['hello'], 'hello.txt');
  let calls = 0;
  let fail = true;
  const cachedHash = createFileHashCache(async () => {
    calls += 1;
    if (fail) throw new Error('temporary failure');
    return 'ab'.repeat(32);
  });

  await assert.rejects(() => cachedHash(file), /temporary failure/);
  fail = false;
  const [first, second] = await Promise.all([cachedHash(file), cachedHash(file)]);
  assert.equal(first, 'ab'.repeat(32));
  assert.equal(second, first);
  assert.equal(calls, 2);
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

test('Vessel read URLs normalize Aptos-style @ accounts from legacy Shelby state', () => {
  const account = '4d'.repeat(32);
  assert.equal(
    vesselBlobUrl({
      origin: 'https://vessel.example/',
      storageAddress: `@${account}`,
      blobName: 'media/token.json',
    }),
    `https://vessel.example/api/shelby/blobs/0x${account}/media/token.json`,
  );
});
