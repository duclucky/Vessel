import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFeeReceipts } from '../public/fee-accounting.js';

test('batch items that share one approval contribute one fee receipt', () => {
  const totals = summarizeFeeReceipts([{
    key: 'media/single.svg',
    totalAccountingMicro: '151504',
    storageCostAccountingMicro: '3',
    serviceFeeAccountingMicro: '1501',
  }, {
    key: 'media/a.svg',
    paymentMode: 'one-approval-beta-batch',
    lastReconciledAt: 42,
    totalAccountingMicro: '151504',
    storageCostAccountingMicro: '3',
    serviceFeeAccountingMicro: '1501',
  }, {
    key: 'media/b.svg',
    paymentMode: 'one-approval-beta-batch',
    lastReconciledAt: 42,
    totalAccountingMicro: '151504',
    storageCostAccountingMicro: '3',
    serviceFeeAccountingMicro: '1501',
  }]);

  assert.deepEqual(totals, {
    total: 303_008n,
    storage: 6n,
    service: 3_002n,
    unitemized: 0n,
    breakdownCount: 2,
  });
});

test('explicit payment group IDs deduplicate batch receipts across different timestamps', () => {
  const totals = summarizeFeeReceipts([{
    key: 'media/a.svg',
    paymentGroupId: 'batch-auth-1',
    lastReconciledAt: 42,
    totalAccountingMicro: '10000',
    storageCostAccountingMicro: '2',
    serviceFeeAccountingMicro: '100',
  }, {
    key: 'media/b.svg',
    paymentGroupId: 'batch-auth-1',
    lastReconciledAt: 43,
    totalAccountingMicro: '10000',
    storageCostAccountingMicro: '2',
    serviceFeeAccountingMicro: '100',
  }]);

  assert.equal(totals.total, 10_000n);
  assert.equal(totals.breakdownCount, 1);
});
