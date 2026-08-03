import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementAdapterRegistry } from '../src/lib/settlement/adapters.js';

const contractQuote = Object.freeze({
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

const receiptFixture = (patch = {}) => ({
  chain: 'aptos',
  network: 2,
  deploymentId: `0x${'aa'.repeat(32)}::vessel_settlement`,
  quoteId: contractQuote.quoteId,
  payer: contractQuote.payer,
  storageAddress: contractQuote.storageAddress,
  asset: contractQuote.asset,
  amount: contractQuote.amount,
  fileHash: contractQuote.fileHash,
  storageExpirationMicros: contractQuote.storageExpirationMicros,
  transactionId: `0x${'bb'.repeat(32)}`,
  blockReference: '12345',
  finalizedAtMs: 1_785_749_700_000,
  configVersion: contractQuote.configVersion,
  ...patch,
});

test('registry returns an immutable receipt only from the selected chain adapter', async () => {
  const aptos = {
    deploymentId: receiptFixture().deploymentId,
    verify: async () => receiptFixture(),
  };
  const registry = new SettlementAdapterRegistry({
    aptos,
    solana: { verify: async () => assert.fail('wrong adapter selected') },
  });

  const receipt = await registry.verify({
    chain: 'aptos',
    quote: { contractQuote },
    transactionId: receiptFixture().transactionId,
  });

  assert.equal(receipt.quoteId, contractQuote.quoteId);
  assert.equal(Object.isFrozen(receipt), true);
  assert.deepEqual(Object.keys(receipt), [
    'chain', 'network', 'deploymentId', 'quoteId', 'payer', 'storageAddress',
    'asset', 'amount', 'fileHash', 'storageExpirationMicros', 'transactionId',
    'blockReference', 'finalizedAtMs', 'configVersion',
  ]);
});

test('registry rejects any receipt field that differs from the signed quote', async () => {
  const mismatches = [
    ['deploymentId', `0x${'cc'.repeat(32)}::vessel_settlement`],
    ['quoteId', '99'.repeat(32)],
    ['payer', '99'.repeat(32)],
    ['storageAddress', '99'.repeat(32)],
    ['asset', '99'.repeat(32)],
    ['amount', '84101'],
    ['fileHash', '99'.repeat(32)],
    ['storageExpirationMicros', '1786354494000001'],
    ['configVersion', '2'],
    ['transactionId', `0x${'dd'.repeat(32)}`],
  ];

  for (const [field, value] of mismatches) {
    const expectedDeployment = receiptFixture().deploymentId;
    const registry = new SettlementAdapterRegistry({
      aptos: {
        deploymentId: expectedDeployment,
        verify: async () => receiptFixture({ [field]: value }),
      },
    });
    await assert.rejects(() => registry.verify({
      chain: 'aptos',
      quote: { contractQuote },
      transactionId: receiptFixture().transactionId,
    }), /receipt|settlement/i);
  }
});

test('registry rejects unsupported chains and raw RPC-shaped receipts', async () => {
  const registry = new SettlementAdapterRegistry({
    aptos: { verify: async () => ({ result: receiptFixture() }) },
  });
  await assert.rejects(() => registry.verify({ chain: 'evm', quote: { contractQuote }, transactionId: 'x' }));
  await assert.rejects(() => registry.verify({
    chain: 'aptos',
    quote: { contractQuote },
    transactionId: receiptFixture().transactionId,
  }));
});
