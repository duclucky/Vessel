import test from 'node:test';
import assert from 'node:assert/strict';
import { extractShelbyTransactionEvidence } from '../client-src/wallets/transaction-evidence.js';

const registered = {
  success: true,
  hash: '0xabc123',
  gas_used: '718',
  events: [{
    type: '0x42::blob_metadata::BlobRegisteredEvent',
    data: { payment_amount: '4200', blob_name: 'media/proof.png' },
  }],
};

test('Shelby registration evidence returns exact on-chain decimal strings', () => {
  assert.deepEqual(extractShelbyTransactionEvidence(registered), {
    actualStorageUnits: '4200',
    actualGasUsed: '718',
    transactionHash: '0xabc123',
  });
});

test('Shelby registration evidence rejects failed or eventless transactions', () => {
  assert.throws(
    () => extractShelbyTransactionEvidence({ ...registered, success: false }),
    (error) => error.code === 'transaction_failed',
  );
  assert.throws(
    () => extractShelbyTransactionEvidence({ ...registered, events: [] }),
    (error) => error.code === 'registration_evidence_missing',
  );
});
