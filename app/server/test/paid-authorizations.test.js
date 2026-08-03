import test from 'node:test';
import assert from 'node:assert/strict';
import { PaidAuthorizationManager } from '../src/lib/paid-authorizations.js';
import { QuoteManager } from '../src/lib/quotes.js';

const QUOTE_SECRET = 'quote-secret-that-is-at-least-32-bytes';
const PAID_SECRET = 'paid-secret-that-is-at-least-32-bytes';
const breakdown = {
  tierId: 0,
  configVersion: 'cfg-1',
  paymentEpochs: 7,
  storageShelbyUsdUnits: '294',
  storageAccountingMicro: '3',
  gasOctas: '700000',
  gasAccountingMicro: '35000',
  subtotalAccountingMicro: '35003',
  serviceFeeAccountingMicro: '701',
  totalAccountingMicro: '35704',
};
const context = {
  operation: 'upload',
  chain: 'solana',
  sourceNetwork: 'solana-devnet',
  storageNetwork: 'shelby-testnet',
  sourceAddress: 'Source111',
  storageAddress: '0xdaa',
  fileHash: 'ab'.repeat(32),
  blobName: `media/${'ab'.repeat(32)}.bin`,
  sizeBytes: 42,
  contentType: 'application/octet-stream',
  encoding: 0,
  days: 7,
  expirationMicros: 604_801_000_000,
};

async function managers(clock) {
  const quoteManager = QuoteManager.forTest({
    secret: QUOTE_SECRET,
    now: () => clock.value,
    pricing: async () => breakdown,
  });
  const publicQuote = await quoteManager.issueUpload(context);
  return {
    quoteManager,
    quote: quoteManager.validate(publicQuote.quoteToken, context),
    paid: new PaidAuthorizationManager({
      quoteManager,
      secret: PAID_SECRET,
      now: () => clock.value,
      environment: 'test',
    }),
  };
}

test('paid authorization remains valid for 24 hours after its five-minute quote expires', async () => {
  const clock = { value: 1_000 };
  const { paid, quote } = await managers(clock);
  const token = paid.issue({
    quote,
    settlementChain: 'solana',
    settlementHash: 'sig-1',
  });

  clock.value += 5 * 60_000 + 1;
  assert.equal(paid.validate(token, quote).settlementHash, 'sig-1');
  clock.value = 1_000 + 24 * 60 * 60_000;
  assert.throws(() => paid.validate(token, quote), (error) => error.code === 'paid_authorization_expired');
});

test('paid authorization is bound to quote, file, wallet, and settlement evidence', async () => {
  const clock = { value: 1_000 };
  const { paid, quote, quoteManager } = await managers(clock);
  const token = paid.issue({ quote, settlementChain: 'solana', settlementHash: 'sig-1' });

  assert.throws(
    () => paid.validate(token, quote, { settlementHash: 'sig-2' }),
    /settlement/i,
  );

  for (const change of [
    { fileHash: 'cd'.repeat(32) },
    { sourceAddress: 'Other111' },
  ]) {
    clock.value += 1;
    const otherContext = { ...context, ...change };
    const otherPublic = await quoteManager.issueUpload(otherContext);
    const otherQuote = quoteManager.validate(otherPublic.quoteToken, otherContext);
    assert.throws(() => paid.validate(token, otherQuote), /quote|context/i);
  }
});

test('production paid authorization refuses a blank secret', () => {
  assert.throws(
    () => new PaidAuthorizationManager({
      quoteManager: {},
      secret: '',
      environment: 'production',
    }),
    /PAY_SECRET/,
  );
});
