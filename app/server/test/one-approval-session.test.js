import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APTOS_UPLOAD_NONCE,
  oneApprovalBatchMessage,
  oneApprovalMessage,
  parseAptosSignedMessage,
} from '../public/one-approval-session.js';

const intent = Object.freeze({
  chain: 'aptos',
  sourceAddress: '0xabc',
  storageAddress: '0xdef',
  fileHash: '11'.repeat(32),
  blobName: `media/${'11'.repeat(32)}.json`,
  sizeBytes: 42,
  days: 30,
  expirationMicros: 1_800_000_000_000_000,
});

const quote = Object.freeze({
  totalAccountingMicro: '151514',
  quoteId: 'quote-1',
  expiresAtMs: 1_799_999_999_000,
});

test('single one-approval message binds the complete immutable upload context', () => {
  assert.equal(oneApprovalMessage({ intent, quote }), [
    'VESSEL_UPLOAD_SESSION',
    'Chain: aptos',
    'Source: 0xabc',
    'Storage: 0xdef',
    `FileHash: ${'11'.repeat(32)}`,
    `BlobName: media/${'11'.repeat(32)}.json`,
    'SizeBytes: 42',
    'RetentionDays: 30',
    'ExpirationMicros: 1800000000000000',
    'MaxAccountingMicro: 151514',
    'QuoteId: quote-1',
    'QuoteExpiresAtMs: 1799999999000',
  ].join('\n'));
});

test('batch one-approval message binds manifest identity and total size', () => {
  const manifest = Object.freeze({ manifestHash: '22'.repeat(32), totalBytes: 84, items: [{}, {}] });
  assert.equal(oneApprovalBatchMessage({ intent, quote, manifest }), [
    'VESSEL_BATCH_UPLOAD_SESSION',
    'Chain: aptos',
    'Source: 0xabc',
    'Storage: 0xdef',
    `ManifestHash: ${'22'.repeat(32)}`,
    'ItemCount: 2',
    'TotalSizeBytes: 84',
    'RetentionDays: 30',
    'ExpirationMicros: 1800000000000000',
    'MaxAccountingMicro: 151514',
    'QuoteId: quote-1',
    'QuoteExpiresAtMs: 1799999999000',
  ].join('\n'));
});

test('Aptos signed-message parser requires the exact canonical message and fixed nonce', () => {
  const canonicalMessage = oneApprovalMessage({ intent, quote });
  const signedMessage = `APTOS\naddress: 0xabc\napplication: vessel-sage.vercel.app\nchainId: 118\nmessage: ${canonicalMessage}\nnonce: ${APTOS_UPLOAD_NONCE}`;

  assert.deepEqual(parseAptosSignedMessage({ signedMessage, canonicalMessage }), {
    valid: true,
    nonce: APTOS_UPLOAD_NONCE,
  });
  assert.equal(parseAptosSignedMessage({
    signedMessage: signedMessage.replace('QuoteId: quote-1', 'QuoteId: quote-2'),
    canonicalMessage,
  }).valid, false);
  assert.equal(parseAptosSignedMessage({
    signedMessage: signedMessage.replace(APTOS_UPLOAD_NONCE, 'different-nonce'),
    canonicalMessage,
  }).valid, false);
});
