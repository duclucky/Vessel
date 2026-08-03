import test from 'node:test';
import assert from 'node:assert/strict';
import { submitAptosContractSettlement } from '../client-src/wallets/aptos-contract-settlement.js';

const payer = '22'.repeat(32);
const quote = Object.freeze({
  version: 1,
  chain: 1,
  network: 2,
  quoteId: '11'.repeat(32),
  payer,
  storageAddress: '33'.repeat(32),
  asset: '44'.repeat(32),
  amount: '84100',
  fileHash: '55'.repeat(32),
  retentionDays: 7,
  storageExpirationMicros: '1786354494000000',
  quoteExpiresAtSecs: '1785749994',
  configVersion: '1',
});
const signature = '66'.repeat(64);
const deployment = Object.freeze({ moduleAddress: `0x${'aa'.repeat(32)}` });

test('Petra submits the exact Vessel settlement entry payload', async () => {
  let submitted;
  const result = await submitAptosContractSettlement({
    adapter: {
      signAndSubmitTransaction: async ({ data }) => {
        submitted = data;
        return { hash: '0xcontract-tx' };
      },
    },
    session: { chain: 'aptos', sourceAddress: `0x${payer}` },
    deployment,
    contractQuote: quote,
    contractSignature: signature,
  });

  assert.equal(submitted.function, `${deployment.moduleAddress}::vessel_settlement::settle`);
  assert.deepEqual(submitted.typeArguments, ['0x1::fungible_asset::Metadata']);
  assert.equal(submitted.functionArguments.length, 15);
  assert.equal(submitted.functionArguments[0], `0x${quote.asset}`);
  assert.deepEqual(submitted.functionArguments.slice(1, 4), [1, 1, 2]);
  assert.deepEqual([...submitted.functionArguments[4]], Array(32).fill(0x11));
  assert.deepEqual([...submitted.functionArguments[5]], Array(32).fill(0x22));
  assert.deepEqual([...submitted.functionArguments[6]], Array(32).fill(0x33));
  assert.deepEqual([...submitted.functionArguments[7]], Array(32).fill(0x44));
  assert.equal(submitted.functionArguments[8], '84100');
  assert.deepEqual([...submitted.functionArguments[9]], Array(32).fill(0x55));
  assert.deepEqual(submitted.functionArguments.slice(10, 14), [
    7, '1786354494000000', '1785749994', '1',
  ]);
  assert.deepEqual([...submitted.functionArguments[14]], Array(64).fill(0x66));
  assert.deepEqual(result, { transactionId: '0xcontract-tx' });
});

test('payer mismatch fails before opening Petra', async () => {
  let approvals = 0;
  await assert.rejects(() => submitAptosContractSettlement({
    adapter: { signAndSubmitTransaction: async () => { approvals += 1; } },
    session: { chain: 'aptos', sourceAddress: `0x${'99'.repeat(32)}` },
    deployment,
    contractQuote: quote,
    contractSignature: signature,
  }), (error) => error.code === 'settlement_context_mismatch');
  assert.equal(approvals, 0);
});

test('undeployed module and malformed signatures fail closed', async () => {
  for (const patch of [
    { deployment: { moduleAddress: '0x0' } },
    { contractSignature: 'aa' },
  ]) {
    await assert.rejects(() => submitAptosContractSettlement({
      adapter: { signAndSubmitTransaction: async () => assert.fail('must not open wallet') },
      session: { chain: 'aptos', sourceAddress: `0x${payer}` },
      deployment,
      contractQuote: quote,
      contractSignature: signature,
      ...patch,
    }));
  }
});
