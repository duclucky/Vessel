import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeQuoteV1,
  normalizeQuoteV1,
  quoteDigest,
  quoteIdHex,
} from '../src/lib/settlement/quote-v1.js';

const fixture = Object.freeze({
  version: 1,
  chain: 1,
  network: 2,
  quoteId: '11'.repeat(32),
  payer: '22'.repeat(32),
  storageAddress: '33'.repeat(32),
  asset: '44'.repeat(32),
  amount: '84100',
  fileHash: '55'.repeat(32),
  retentionDays: 7,
  storageExpirationMicros: '1786354494000000',
  quoteExpiresAtSecs: '1785749994',
  configVersion: '1',
});

test('QuoteV1 BCS bytes and digest remain stable', () => {
  assert.equal(
    encodeQuoteV1(fixture).toString('hex'),
    '0101020000002011111111111111111111111111111111111111111111111111111111111111112022222222222222222222222222222222222222222222222222222222222222222033333333333333333333333333333333333333333333333333333333333333332044444444444444444444444444444444444444444444444444444444444444448448010000000000205555555555555555555555555555555555555555555555555555555555555555070080cb0e11ae580600ea61706a000000000100000000000000',
  );
  assert.equal(
    quoteDigest(fixture).toString('hex'),
    'b25001894f27c8433e0d5ae2d386745918a2f0805811d4d72f925b66f3270918',
  );
  assert.equal(quoteIdHex(fixture), fixture.quoteId);
});

test('QuoteV1 rejects non-canonical fields', () => {
  for (const patch of [
    { version: 2 },
    { chain: 4 },
    { network: -1 },
    { retentionDays: 0 },
    { retentionDays: 366 },
    { quoteId: 'aa' },
    { amount: '0' },
  ]) {
    assert.throws(() => normalizeQuoteV1({ ...fixture, ...patch }));
  }
});
