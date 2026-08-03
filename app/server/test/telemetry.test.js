import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry } from '../src/lib/telemetry.js';

test('operation telemetry redacts wallets and drops authorization material', () => {
  const rows = [];
  const telemetry = createTelemetry({ write: (row) => rows.push(row), walletSalt: 'test-salt' });
  telemetry.operation({
    stage: 'paid', operation: 'upload', network: 'testnet',
    wallet: 'SourceWallet111', storageAddress: '0xdaa', quoteId: 'quote-1',
    configVersion: 'cfg-1', durationDays: 30, sizeBytes: 1_127_355,
    quotedMicro: '20751', actualStorageUnits: '106848', driftBps: 30,
    transactionHash: '0xtxn', paidAuthorization: 'vpaid.secret',
    quoteToken: 'vquote.secret', signature: 'signature.secret', fileBytes: [1, 2, 3],
  });
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes('SourceWallet111'), false);
  assert.equal(serialized.includes('0xdaa'), false);
  assert.equal(serialized.includes('vpaid.secret'), false);
  assert.equal(serialized.includes('vquote.secret'), false);
  assert.equal(serialized.includes('signature.secret'), false);
  assert.equal(rows[0].walletRef.length, 12);
  assert.equal(rows[0].storageRef.length, 12);
  assert.equal(rows[0].sizeBucket, '1-5mb');
  assert.equal(rows[0].severity, 'info');
});

test('normalized operator errors use error severity without stack traces', () => {
  for (const errorCode of [
    'pricing_unavailable',
    'quote_drift',
    'payment_verification_failed',
    'sponsor_failed',
    'acknowledgement_timeout',
  ]) {
    const rows = [];
    const telemetry = createTelemetry({ write: (row) => rows.push(row), walletSalt: 'salt' });
    telemetry.operation({
      stage: 'failed', operation: 'upload', network: 'testnet', errorCode,
      error: Object.assign(new Error('secret stack'), { stack: 'do not log' }),
    });
    assert.equal(rows[0].severity, 'error');
    assert.equal(rows[0].errorCode, errorCode);
    assert.equal('stack' in rows[0], false);
    assert.equal(JSON.stringify(rows[0]).includes('do not log'), false);
  }
});
