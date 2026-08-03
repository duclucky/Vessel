import test from 'node:test';
import assert from 'node:assert/strict';
import { settleContractQuote } from '../public/contract-settlement-client.js';

const quote = Object.freeze({
  quoteToken: 'vquote.context',
  uploadContext: Object.freeze({ chain: 'aptos', fileHash: '55'.repeat(32) }),
  contractQuote: Object.freeze({ quoteId: '11'.repeat(32), amount: '84100' }),
  contractSignature: '66'.repeat(64),
});

test('submission is persisted before receipt verification begins', async () => {
  const calls = [];
  const result = await settleContractQuote({
    quote,
    chainClient: {
      submit: async (input) => {
        calls.push(['submit', input]);
        return { transactionId: 'tx-1' };
      },
    },
    onSubmitted: async (input) => calls.push(['saved', input]),
    request: async (path, options) => {
      calls.push(['verify', path, options]);
      return { paidAuthorization: 'vpaid.receipt', transactionId: 'tx-1' };
    },
  });

  assert.deepEqual(calls.map(([type]) => type), ['submit', 'saved', 'verify']);
  assert.deepEqual(calls[0][1], {
    contractQuote: quote.contractQuote,
    contractSignature: quote.contractSignature,
  });
  assert.equal(calls[1][1].quoteId, quote.contractQuote.quoteId);
  assert.equal(calls[2][1], '/api/settlements/verify');
  assert.equal(calls[2][2].body.transactionId, 'tx-1');
  assert.equal(result.paidAuthorization, 'vpaid.receipt');
});

test('retry verifies the recorded transaction without submitting another payment', async () => {
  let submits = 0;
  const saved = [];
  const chainClient = {
    submit: async () => ({ transactionId: `tx-${++submits}` }),
  };
  const pendingRequest = async () => {
    throw Object.assign(new Error('pending'), { code: 'receipt_pending' });
  };

  await assert.rejects(() => settleContractQuote({
    quote,
    chainClient,
    request: pendingRequest,
    onSubmitted: (input) => saved.push(input),
  }), (error) => error.code === 'receipt_pending');
  assert.equal(submits, 1);
  assert.deepEqual(saved, [{ quoteId: quote.contractQuote.quoteId, transactionId: 'tx-1' }]);

  let verifiedTransaction;
  await settleContractQuote({
    quote,
    chainClient,
    transactionId: saved[0].transactionId,
    request: async (_path, options) => {
      verifiedTransaction = options.body.transactionId;
      return { paidAuthorization: 'vpaid.recovered' };
    },
  });
  assert.equal(submits, 1);
  assert.equal(verifiedTransaction, 'tx-1');
});

test('missing transaction ID fails before verification', async () => {
  let verified = false;
  await assert.rejects(() => settleContractQuote({
    quote,
    chainClient: { submit: async () => ({}) },
    request: async () => { verified = true; },
  }), (error) => error.code === 'settlement_submission_failed');
  assert.equal(verified, false);
});
