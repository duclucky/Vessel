import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRetentionDays,
  targetExpirationMicros,
  createUploadIntent,
} from '../public/retention.js';

test('retention accepts only integer days from 1 through 365', () => {
  for (const value of [1, '7', 30, 90, 365]) {
    assert.equal(normalizeRetentionDays(value), Number(value));
  }
  for (const value of ['', 0, -1, 1.5, '1.5', 366, Number.NaN]) {
    assert.throws(() => normalizeRetentionDays(value), /1 and 365/);
  }
});

test('expiration is based on quote server time in microseconds', () => {
  assert.equal(targetExpirationMicros({ serverTimeMs: 1_000, days: 7 }), 604_801_000_000);
});

test('upload intent binds file and wallet identity', () => {
  const intent = createUploadIntent({
    file: { size: 42, type: 'image/png' },
    fileHash: 'ab'.repeat(32),
    blobName: `media/${'ab'.repeat(32)}.png`,
    session: { chain: 'solana', sourceAddress: 'Source111', storageAddress: '0xdaa' },
    days: 30,
    serverTimeMs: 1_000,
    encoding: 0,
  });
  assert.equal(intent.operation, 'upload');
  assert.equal(intent.days, 30);
  assert.equal(intent.sizeBytes, 42);
  assert.equal(intent.fileHash, 'ab'.repeat(32));
  assert.equal(intent.expirationMicros, 2_592_001_000_000);
});
