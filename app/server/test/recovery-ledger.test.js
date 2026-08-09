import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryLedger, normalizeWalletIdentity } from '../public/recovery-ledger.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => JSON.stringify([...map]),
  };
}

const identity = {
  chain: 'aptos',
  sourceAddress: '0xABC',
  storageAddress: '0xABC',
};

test('recovery ledger advances allowlisted upload stages without storing file or key material', () => {
  const storage = memoryStorage();
  let current = 1_000;
  const ledger = createRecoveryLedger(storage, () => current);
  const record = ledger.save({
    id: 'quote-1',
    stage: 'quoted',
    walletIdentity: identity,
    quoteId: 'quote-1',
    quoteToken: 'vquote.signed',
    context: {
      operation: 'upload', chain: 'aptos', sourceAddress: '0xABC', storageAddress: '0xABC',
      fileHash: 'ab'.repeat(32), blobName: 'media/proof.png', sizeBytes: 3,
      expirationMicros: 2_592_001_000_000, days: 30, encoding: 0,
    },
    file: new Uint8Array([1, 2, 3]),
    seedPhrase: 'never store this',
    privateKey: 'never store this either',
    contractQuote: { quoteId: '11'.repeat(32), amount: '84100' },
    contractSignature: '66'.repeat(64),
    quotePublicKey: '77'.repeat(32),
    settlementDeployment: { moduleAddress: `0x${'88'.repeat(32)}` },
    quotedAccountingMicro: '35854',
    storageCostAccountingMicro: '13',
    gasAccountingMicro: '35000',
    serviceFeeAccountingMicro: '841',
    totalAccountingMicro: '35854',
  });

  for (const stage of ['settlement_submitted', 'paid', 'registered', 'uploading', 'committed', 'finalizing', 'active', 'recovery_required']) {
    current += 1_000;
    ledger.advance(record.id, stage, {
      paidAuthorization: 'vpaid.signed',
      settlementHash: '0xsettled',
      settlementTransactionId: '0xcontract-transaction',
      registerTransactionHash: '0xregistered',
      commitTransactionHash: '0xcommitted',
      fileBytes: [9, 9, 9],
      privateKey: 'secret',
    });
    assert.equal(ledger.loadForWallet(identity)[0].stage, stage);
  }

  const serialized = storage.dump();
  assert.equal(serialized.includes('never store this'), false);
  assert.equal(serialized.includes('fileBytes'), false);
  assert.equal(serialized.includes('privateKey'), false);
  assert.equal(ledger.loadForWallet(identity)[0].paidAuthorization, 'vpaid.signed');
  assert.equal(ledger.loadForWallet(identity)[0].registerTransactionHash, '0xregistered');
  assert.equal(ledger.loadForWallet(identity)[0].commitTransactionHash, '0xcommitted');
  assert.equal(ledger.loadForWallet(identity)[0].settlementTransactionId, '0xcontract-transaction');
  assert.equal(ledger.loadForWallet(identity)[0].contractQuote.amount, '84100');
  assert.equal(ledger.loadForWallet(identity)[0].contractSignature, '66'.repeat(64));
  assert.equal(ledger.loadForWallet(identity)[0].quotePublicKey, '77'.repeat(32));
  assert.equal(ledger.loadForWallet(identity)[0].storageCostAccountingMicro, '13');
  assert.equal(ledger.loadForWallet(identity)[0].gasAccountingMicro, '35000');
  assert.equal(ledger.loadForWallet(identity)[0].serviceFeeAccountingMicro, '841');
  assert.equal(ledger.loadForWallet(identity)[0].totalAccountingMicro, '35854');
  assert.equal(normalizeWalletIdentity(identity), 'aptos:0xabc:0xabc');
});

test('a submitted contract transaction remains recoverable for 24 hours', () => {
  const storage = memoryStorage();
  let current = 1_000;
  const ledger = createRecoveryLedger(storage, () => current);
  ledger.save({
    id: 'quote-submitted',
    stage: 'settlement_submitted',
    walletIdentity: identity,
    context: { operation: 'upload', chain: 'aptos' },
    settlementTransactionId: '0xcontract-transaction',
  });

  current += 23 * 60 * 60 * 1_000;
  assert.equal(ledger.loadForWallet(identity).length, 1);
  current += 2 * 60 * 60 * 1_000;
  assert.equal(ledger.loadForWallet(identity).length, 0);
});

test('recovery ledger is capped, wallet scoped, and complete removes a record', () => {
  const storage = memoryStorage();
  const ledger = createRecoveryLedger(storage, () => 1_000);
  for (let index = 0; index < 35; index += 1) {
    ledger.save({
      id: `quote-${index}`,
      stage: 'quoted',
      walletIdentity: identity,
      quoteId: `quote-${index}`,
      context: { operation: 'upload', chain: 'aptos' },
    });
  }
  assert.equal(ledger.loadForWallet(identity).length, 30);
  assert.deepEqual(ledger.loadForWallet({ ...identity, sourceAddress: '0xother' }), []);
  const id = ledger.loadForWallet(identity)[0].id;
  ledger.complete(id);
  assert.equal(ledger.loadForWallet(identity).some((item) => item.id === id), false);
});

test('a repeated quote cannot overwrite a durable recovery checkpoint with the same id', () => {
  const storage = memoryStorage();
  let current = 1_000;
  const ledger = createRecoveryLedger(storage, () => current);
  ledger.save({
    id: 'quote-reused',
    stage: 'quoted',
    walletIdentity: identity,
    quoteId: 'quote-reused',
    quoteToken: 'vquote.original',
    context: { operation: 'upload', chain: 'aptos', fileHash: 'ab'.repeat(32) },
  });
  current += 1_000;
  ledger.advance('quote-reused', 'paid', {
    paidAuthorization: 'vpaid.original',
    settlementTransactionId: '0xpaid',
  });

  current += 1_000;
  ledger.save({
    id: 'quote-reused',
    stage: 'quoted',
    walletIdentity: identity,
    quoteId: 'quote-reused',
    quoteToken: 'vquote.repeated',
    context: { operation: 'upload', chain: 'aptos', fileHash: 'ab'.repeat(32) },
  });

  const [record] = ledger.loadForWallet(identity);
  assert.equal(record.stage, 'paid');
  assert.equal(record.paidAuthorization, 'vpaid.original');
  assert.equal(record.settlementTransactionId, '0xpaid');
});
