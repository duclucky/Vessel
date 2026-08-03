import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileArtifacts } from '../client-src/wallets/artifact-reconciler.js';

test('remote Shelby metadata is authoritative for ownership, expiration, and lifecycle', () => {
  const identity = { chain: 'aptos', sourceAddress: '0xabc', storageAddress: '0xabc' };
  const local = [{
    key: 'media/proof.png', url: 'https://shelby/proof', contentType: 'image/png',
    expiresAt: 123, storageAddress: '0xabc', state: 'quoted',
  }];
  const remote = [{
    owner: '0xabc', name: '0xabc/media/proof.png', blobNameSuffix: 'media/proof.png',
    size: 42, encoding: { variant: 'clay' }, creationMicros: 1_000_000,
    expirationMicros: 2_592_001_000_000, isWritten: true, isDeleted: false,
  }, {
    owner: '0xattacker', blobNameSuffix: 'media/foreign.png',
    expirationMicros: 9_000_000, isWritten: true, isDeleted: false,
  }];

  const merged = reconcileArtifacts(local, remote, identity);
  assert.equal(merged[0].expiresAt, Number(remote[0].expirationMicros / 1_000));
  assert.equal(merged[0].state, remote[0].isWritten ? 'active' : 'finalizing');
  assert.equal(merged[0].registerTransactionHash, undefined);
  assert.equal(merged.some((item) => item.storageAddress !== identity.storageAddress), false);
});

test('remote unwritten and deleted blobs are mapped without trusting stale local state', () => {
  const identity = { chain: 'solana', sourceAddress: 'Solana1', storageAddress: '0xdaa' };
  const merged = reconcileArtifacts([], [{
    owner: '0xdaa', blobNameSuffix: 'media/pending.bin', size: 3,
    encoding: { variant: 'clay' }, creationMicros: 2_000_000,
    expirationMicros: 3_000_000, isWritten: false, isDeleted: false,
  }], identity);
  assert.equal(merged[0].state, 'finalizing');
  assert.equal(merged[0].createdAt, 2_000);
});
