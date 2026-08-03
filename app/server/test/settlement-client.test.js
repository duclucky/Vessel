import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { settleContractQuote } from '../public/settlement-client.js';

const quote = Object.freeze({
  quoteToken: 'vquote.context',
  uploadContext: Object.freeze({ chain: 'solana', fileHash: '55'.repeat(32) }),
  contractQuote: Object.freeze({ quoteId: '11'.repeat(32), amount: '35714' }),
  contractSignature: '66'.repeat(64),
});

test('public settlement entrypoint submits to a chain contract and verifies its receipt', async () => {
  const calls = [];
  const result = await settleContractQuote({
    quote,
    chainClient: {
      submit: async (input) => {
        calls.push(['submit', input]);
        return { transactionId: 'solana-contract-tx' };
      },
    },
    onSubmitted: async (input) => calls.push(['persist', input]),
    request: async (path, options) => {
      calls.push(['verify', path, options]);
      return {
        paidAuthorization: 'vpaid.receipt',
        receipt: { transactionId: 'solana-contract-tx' },
      };
    },
  });

  assert.deepEqual(calls.map(([kind]) => kind), ['submit', 'persist', 'verify']);
  assert.equal(calls[2][1], '/api/settlements/verify');
  assert.equal(result.receipt.transactionId, 'solana-contract-tx');
});

test('recorded transaction recovery verifies without another wallet approval', async () => {
  let submits = 0;
  let verifiedTransaction = '';
  await settleContractQuote({
    quote,
    transactionId: 'recorded-contract-tx',
    chainClient: { submit: async () => { submits += 1; } },
    request: async (_path, options) => {
      verifiedTransaction = options.body.transactionId;
      return { paidAuthorization: 'vpaid.recovered', receipt: { transactionId: verifiedTransaction } };
    },
  });

  assert.equal(submits, 0);
  assert.equal(verifiedTransaction, 'recorded-contract-tx');
});

test('legacy direct-transfer settlement code is absent from the browser entrypoint', () => {
  const source = fs.readFileSync(new URL('../public/settlement-client.js', import.meta.url), 'utf8');
  for (const legacy of [
    ['pay', 'USDC'].join(''),
    'primary_fungible_store::transfer',
    ['treasury', 'Ata'].join(''),
    '/api/pay/',
  ]) {
    assert.equal(source.includes(legacy), false, legacy);
  }
});
