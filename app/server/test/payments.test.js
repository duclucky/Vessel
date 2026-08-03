import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentManager } from '../src/lib/payments.js';

const quote = {
  quoteId: 'quote-1',
  solanaAmountMicro: '10000',
  sourceAddress: 'Source111',
};

const transaction = ({
  source = 'Source111',
  treasury = 'Treasury111',
  mint = 'Mint111',
  received = '10000',
  debited = '10000',
  memo = 'quote-1',
  failed = false,
} = {}) => ({
  meta: {
    err: failed ? { InstructionError: [0, 'failed'] } : null,
    preTokenBalances: [
      { owner: source, mint, uiTokenAmount: { amount: '20000' } },
      { owner: treasury, mint, uiTokenAmount: { amount: '0' } },
    ],
    postTokenBalances: [
      { owner: source, mint, uiTokenAmount: { amount: String(20_000 - Number(debited)) } },
      { owner: treasury, mint, uiTokenAmount: { amount: received } },
    ],
  },
  transaction: {
    message: {
      instructions: [{ program: 'spl-memo', parsed: memo }],
    },
  },
});

const managerFor = (tx) => PaymentManager.forTest({
  treasury: 'Treasury111',
  treasuryAta: 'Ata111',
  mint: 'Mint111',
  tx,
});

test('Solana quote payment verifies treasury receipt, source debit, mint, and quote memo', async () => {
  const manager = managerFor(transaction());
  const result = await manager.verifyQuotePayment({ quote, signature: 'sig-1' });

  assert.deepEqual(result, {
    ok: true,
    signature: 'sig-1',
    receivedMicro: '10000',
  });
});

test('Solana quote payment rejects wrong source, mint, treasury amount, debit, memo, or failed tx', async () => {
  for (const [tx, reason] of [
    [transaction({ source: 'Other111' }), 'source_mismatch'],
    [transaction({ mint: 'OtherMint' }), 'insufficient_amount'],
    [transaction({ received: '9999' }), 'insufficient_amount'],
    [transaction({ debited: '9999' }), 'insufficient_source_debit'],
    [transaction({ memo: 'other-quote' }), 'memo_mismatch'],
    [transaction({ failed: true }), 'tx_failed'],
  ]) {
    assert.equal(
      (await managerFor(tx).verifyQuotePayment({ quote, signature: 'sig-1' })).reason,
      reason,
    );
  }
});

test('Solana quote payment rejects malformed quote bindings before querying chain', async () => {
  const manager = managerFor(transaction());
  for (const changed of [
    { quoteId: '' },
    { sourceAddress: '' },
    { solanaAmountMicro: '0' },
    { solanaAmountMicro: 'bad' },
  ]) {
    await assert.rejects(
      () => manager.verifyQuotePayment({ quote: { ...quote, ...changed }, signature: 'sig-1' }),
      (error) => error.code === 'invalid_payment_context',
    );
  }
});
