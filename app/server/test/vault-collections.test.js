import test from 'node:test';
import assert from 'node:assert/strict';
import { groupVaultCollections } from '../public/vault-collections.js';

const ADDRESS = '0xabc';

const image = (sourcePath, overrides = {}) => ({
  key: `media/${sourcePath.replaceAll('/', '-')}`,
  url: `https://vessel.example/${encodeURIComponent(sourcePath)}`,
  sourcePath,
  contentType: 'image/png',
  size: 10,
  storageAddress: ADDRESS,
  state: 'active',
  isWritten: true,
  isDeleted: false,
  expiresAt: 20_000,
  ...overrides,
});

test('groups active wallet-owned images by source root and sorts naturally', () => {
  const collections = groupVaultCollections([
    image('genesis/images/10.png'),
    image('genesis/images/2.png'),
    image('other/1.png'),
  ], { storageAddress: ADDRESS, now: 10_000 });

  assert.deepEqual(collections.map((entry) => entry.id), ['genesis', 'other']);
  assert.deepEqual(collections[0].items.map((entry) => entry.sourcePath), [
    'genesis/images/2.png',
    'genesis/images/10.png',
  ]);
});

test('filters foreign, expired, deleted, unwritten, non-image, malformed, and duplicate records', () => {
  const valid = image('genesis/1.png');
  const [collection] = groupVaultCollections([
    valid,
    { ...valid },
    image('genesis/2.png', { storageAddress: '0xdef' }),
    image('genesis/3.png', { expiresAt: 9_999 }),
    image('genesis/4.png', { isDeleted: true }),
    image('genesis/5.png', { isWritten: false, state: 'finalizing' }),
    image('genesis/6.json', { contentType: 'application/json' }),
    image('single.png'),
  ], { storageAddress: ADDRESS, now: 10_000 });

  assert.equal(collection.itemCount, 1);
  assert.equal(collection.totalBytes, 10);
  assert.equal(collection.earliestExpiry, 20_000);
});

test('requires an active wallet storage address and a usable Shelby URL', () => {
  assert.deepEqual(groupVaultCollections([image('genesis/1.png')]), []);
  assert.deepEqual(groupVaultCollections([
    image('genesis/1.png', { url: '' }),
  ], { storageAddress: ADDRESS, now: 10_000 }), []);
});
