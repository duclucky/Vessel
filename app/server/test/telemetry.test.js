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

test('operator error details redact API keys and stay bounded', () => {
  const rows = [];
  const telemetry = createTelemetry({ write: (row) => rows.push(row), walletSalt: 'salt' });
  telemetry.operation({
    stage: 'failed',
    operation: 'upload',
    network: 'shelbynet',
    errorCode: 'sponsor_failed',
    errorDetail: `Gas station rejected Bearer token aptoslabs_example_secret_${'x'.repeat(300)}`,
  });
  assert.equal(rows[0].severity, 'error');
  assert.match(rows[0].errorDetail, /aptoslabs_\[redacted\]/);
  assert.equal(rows[0].errorDetail.includes('example_secret'), false);
  assert.ok(rows[0].errorDetail.length <= 1200);
});

test('operator error details preserve Aptos VM abort payloads for diagnosis', () => {
  const rows = [];
  const telemetry = createTelemetry({ write: (row) => rows.push(row), walletSalt: 'salt' });
  const aptosError = `Request to [Fullnode]: POST http://http-gw-shelbynet-node-api.api-gw-prod-shared.svc:8080/v1/transactions failed with: ${JSON.stringify({
    message: 'Invalid transaction: Type: Execution Code: ABORTED',
    error_code: 'vm_error',
    vm_error_code: '0x60001',
    filler: 'x'.repeat(420),
  })}`;
  telemetry.operation({
    stage: 'failed',
    operation: 'upload',
    network: 'shelbynet',
    errorCode: 'sponsor_failed',
    errorDetail: aptosError,
  });
  assert.match(rows[0].errorDetail, /vm_error_code/);
  assert.match(rows[0].errorDetail, /0x60001/);
  assert.ok(rows[0].errorDetail.length <= 1200);
});

test('settlement telemetry hashes quote IDs and records only public finality metadata', () => {
  const rows = [];
  const telemetry = createTelemetry({ write: (row) => rows.push(row), walletSalt: 'salt' });
  telemetry.operation({
    stage: 'receipt_verified',
    operation: 'settlement',
    chain: 'solana',
    network: 'solana-devnet',
    deploymentId: 'VesselProgram111',
    quoteId: 'private-quote-id',
    configVersion: '1',
    finalityLatencyMs: 4_200,
    contractSignature: 'do-not-log-contract-signature',
    walletSignature: 'do-not-log-wallet-signature',
    signedQuoteBytes: 'do-not-log-quote-bytes',
    paidAuthorization: 'do-not-log-paid-authorization',
  });

  assert.equal(rows[0].chain, 'solana');
  assert.equal(rows[0].deploymentId, 'VesselProgram111');
  assert.equal(rows[0].quoteRef.length, 12);
  assert.equal(rows[0].finalityLatencyMs, 4_200);
  assert.equal(JSON.stringify(rows).includes('private-quote-id'), false);
  assert.equal(JSON.stringify(rows).includes('do-not-log'), false);
});
