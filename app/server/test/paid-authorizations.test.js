import test from 'node:test';
import assert from 'node:assert/strict';
import { PaidAuthorizationManager } from '../src/lib/paid-authorizations.js';

const PAID_SECRET = 'paid-secret-that-is-at-least-32-bytes';
const contractQuote = Object.freeze({
  version: 1,
  chain: 2,
  network: 1,
  quoteId: '11'.repeat(32),
  payer: '22'.repeat(32),
  storageAddress: '33'.repeat(32),
  asset: '44'.repeat(32),
  amount: '35854',
  fileHash: '55'.repeat(32),
  retentionDays: 30,
  storageExpirationMicros: '1786354494000000',
  quoteExpiresAtSecs: '1785749994',
  configVersion: '1',
});
const quote = Object.freeze({ contractQuote, contractSignature: '66'.repeat(64) });
const receipt = Object.freeze({
  chain: 'solana',
  network: 1,
  deploymentId: 'VesseL11111111111111111111111111111111111',
  quoteId: contractQuote.quoteId,
  payer: contractQuote.payer,
  storageAddress: contractQuote.storageAddress,
  asset: contractQuote.asset,
  amount: contractQuote.amount,
  fileHash: contractQuote.fileHash,
  storageExpirationMicros: contractQuote.storageExpirationMicros,
  transactionId: '5'.repeat(88),
  blockReference: '12345',
  finalizedAtMs: 1_785_749_700_000,
  configVersion: contractQuote.configVersion,
});

const manager = (clock) => new PaidAuthorizationManager({
  secret: PAID_SECRET,
  now: () => clock.value,
  environment: 'test',
  settlementContractsEnabled: true,
});

test('paid authorization is bound to a normalized contract receipt for 24 hours', () => {
  const clock = { value: 1_000 };
  const paid = manager(clock);
  const token = paid.issue({ quote, receipt });

  clock.value += 5 * 60_000 + 1;
  const authorized = paid.validate(token, quote, { transactionId: receipt.transactionId });
  assert.equal(authorized.transactionId, receipt.transactionId);
  assert.equal(authorized.settlementChain, 'solana');
  assert.equal(authorized.receiptDigest.length, 64);

  clock.value = 1_000 + 24 * 60 * 60_000;
  assert.throws(() => paid.validate(token, quote), (error) => error.code === 'paid_authorization_expired');
});

test('paid authorization rejects mismatched receipts and ordinary wallet transfers', () => {
  const clock = { value: 1_000 };
  const paid = manager(clock);

  for (const patch of [
    { quoteId: '99'.repeat(32) },
    { payer: '99'.repeat(32) },
    { amount: '35855' },
    { fileHash: '99'.repeat(32) },
    { configVersion: '2' },
  ]) {
    assert.throws(() => paid.issue({ quote, receipt: { ...receipt, ...patch } }), /receipt|quote/i);
  }
  assert.throws(() => paid.issue({
    quote,
    receipt: { from: contractQuote.payer, to: receipt.deploymentId, amount: contractQuote.amount },
  }), /receipt|required/i);
});

test('paid authorization detects quote and transaction mutation', () => {
  const clock = { value: 1_000 };
  const paid = manager(clock);
  const token = paid.issue({ quote, receipt });

  assert.throws(
    () => paid.validate(token, quote, { transactionId: 'different' }),
    /settlement|transaction/i,
  );
  assert.throws(
    () => paid.validate(token, {
      ...quote,
      contractQuote: { ...contractQuote, amount: '35855' },
    }),
    /quote|context/i,
  );
});

test('contract mode rejects legacy version 1 paid authorizations', () => {
  const clock = { value: 1_000 };
  const paid = manager(clock);
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: 2_000 })).toString('base64url');
  const token = `vpaid.${payload}.${paid.sign(payload)}`;
  assert.throws(() => paid.validate(token, quote), /invalid/i);
});

test('production paid authorization refuses a blank secret', () => {
  assert.throws(
    () => new PaidAuthorizationManager({
      secret: '',
      environment: 'production',
      settlementContractsEnabled: true,
    }),
    /PAY_SECRET/,
  );
});
