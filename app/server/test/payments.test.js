import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentManager } from '../src/lib/payments.js';

const context = {
  sizeBytes: 42,
  chain: 'solana',
  sourceAddress: 'Source111',
  storageAddress: '0xdaa',
  expirationMicros: 1_800_000_000_000_000,
};

const testManager = (options = {}) => PaymentManager.forTest({
  secret: 'secret',
  priceBaseUsdc: 0.01,
  pricePerMbUsdc: 0,
  treasury: 'Treasury111',
  treasuryAta: 'Ata111',
  ...options,
});

test('payment token is bound to the complete upload context', async () => {
  const manager = testManager();
  const quote = await manager.createIntent(context);
  const token = manager.uploadToken(quote.paymentId);

  assert.equal(manager.checkUploadToken(quote.paymentId, token, context), true);
  for (const changed of [
    { sourceAddress: 'OtherSource' },
    { storageAddress: '0xother' },
    { sizeBytes: 43 },
    { expirationMicros: context.expirationMicros + 1 },
    { chain: 'aptos' },
  ]) {
    assert.equal(
      manager.checkUploadToken(quote.paymentId, token, { ...context, ...changed }),
      false,
    );
  }
});

test('payment verification requires treasury receipt and a debit owned by the bound source', async () => {
  const tx = {
    meta: {
      err: null,
      preTokenBalances: [
        { owner: 'Source111', mint: 'Mint111', uiTokenAmount: { amount: '20000' } },
        { owner: 'Treasury111', mint: 'Mint111', uiTokenAmount: { amount: '0' } },
      ],
      postTokenBalances: [
        { owner: 'Source111', mint: 'Mint111', uiTokenAmount: { amount: '10000' } },
        { owner: 'Treasury111', mint: 'Mint111', uiTokenAmount: { amount: '10000' } },
      ],
    },
    transaction: { message: { instructions: [] } },
  };
  const manager = testManager({ mint: 'Mint111', tx });
  const quote = await manager.createIntent(context);
  tx.transaction.message.instructions.push({ memo: quote.paymentId });

  assert.equal((await manager.verify(quote.paymentId, 'sig')).ok, true);

  tx.meta.preTokenBalances[0].owner = 'Attacker111';
  assert.equal((await manager.verify(quote.paymentId, 'sig')).reason, 'source_mismatch');
});

test('payment verification rejects an insufficient source debit', async () => {
  const tx = {
    meta: {
      err: null,
      preTokenBalances: [
        { owner: 'Source111', mint: 'Mint111', uiTokenAmount: { amount: '20000' } },
        { owner: 'Treasury111', mint: 'Mint111', uiTokenAmount: { amount: '0' } },
      ],
      postTokenBalances: [
        { owner: 'Source111', mint: 'Mint111', uiTokenAmount: { amount: '19999' } },
        { owner: 'Treasury111', mint: 'Mint111', uiTokenAmount: { amount: '10000' } },
      ],
    },
    transaction: { message: { instructions: [] } },
  };
  const manager = testManager({ mint: 'Mint111', tx });
  const quote = await manager.createIntent(context);
  tx.transaction.message.instructions.push({ memo: quote.paymentId });

  assert.equal(
    (await manager.verify(quote.paymentId, 'sig')).reason,
    'insufficient_source_debit',
  );
});

test('invalid intent context is rejected before a quote is minted', async () => {
  const manager = testManager();
  await assert.rejects(
    () => manager.createIntent({ ...context, sourceAddress: '' }),
    (error) => error.code === 'invalid_payment_context',
  );
  await assert.rejects(
    () => manager.createIntent({ ...context, sizeBytes: 0 }),
    (error) => error.code === 'invalid_payment_context',
  );
});
