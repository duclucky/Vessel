import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUploadQuoteContext,
  QuoteManager,
} from '../src/lib/quotes.js';

const SECRET = 'test-quote-secret-that-is-at-least-32-bytes';
const baseContext = {
  operation: 'upload',
  chain: 'solana',
  sourceNetwork: 'solana-devnet',
  storageNetwork: 'shelby-testnet',
  sourceAddress: 'Source111',
  storageAddress: '0xdaa',
  fileHash: 'ab'.repeat(32),
  blobName: `media/${'ab'.repeat(32)}.png`,
  sizeBytes: 42,
  contentType: 'image/png',
  encoding: 0,
  days: 30,
  expirationMicros: 2_592_001_000_000,
};

const breakdown = {
  tierId: 0,
  configVersion: 'cfg-1',
  paymentEpochs: 30,
  chunksetCount: '1',
  storageSpShelbyUsdUnits: '1170',
  storageAdminShelbyUsdUnits: '90',
  storageShelbyUsdUnits: '1260',
  storageAccountingMicro: '13',
  gasOctas: '700000',
  gasAccountingMicro: '35000',
  subtotalAccountingMicro: '35013',
  serviceFeeAccountingMicro: '701',
  totalAccountingMicro: '35714',
  minimumApplied: false,
};

test('upload quote is signed, wallet-bound, and valid for five minutes', async () => {
  let now = 1_000;
  const manager = QuoteManager.forTest({
    secret: SECRET,
    now: () => now,
    pricing: async () => breakdown,
  });

  const quote = await manager.issueUpload(baseContext);
  assert.equal(quote.expiresAtMs, now + 5 * 60_000);
  assert.equal(quote.notice, 'Test tokens — no real monetary value');
  assert.equal(quote.settlementToken, 'Devnet USDC');
  assert.equal(manager.validate(quote.quoteToken, baseContext).quoteId, quote.quoteId);

  for (const change of [
    { fileHash: 'cd'.repeat(32) },
    { sizeBytes: 43 },
    { sourceAddress: 'Other111' },
    { storageAddress: '0xother' },
    { expirationMicros: baseContext.expirationMicros + 1 },
    { days: 31 },
    { chain: 'aptos', sourceNetwork: 'aptos-testnet' },
  ]) {
    assert.throws(
      () => manager.validate(quote.quoteToken, { ...baseContext, ...change }),
      /context/i,
    );
  }

  now += 5 * 60_000;
  assert.throws(
    () => manager.validate(quote.quoteToken, baseContext),
    (error) => error.code === 'quote_expired',
  );
});

test('public quote reports the retention clock used to calculate expiration', async () => {
  const manager = QuoteManager.forTest({
    secret: SECRET,
    now: () => 99_999,
    pricing: async () => breakdown,
  });

  const quote = await manager.issueUpload(baseContext);

  assert.equal(quote.issuedAtMs, 99_999);
  assert.equal(quote.serverTimeMs, 1_000);
});

test('quote validation rejects a tampered payload before trusting its fields', async () => {
  const manager = QuoteManager.forTest({ secret: SECRET, pricing: async () => breakdown });
  const quote = await manager.issueUpload(baseContext);
  const [prefix, payload, signature] = quote.quoteToken.split('.');
  const replacement = payload.at(-1) === 'A' ? 'B' : 'A';
  const tampered = `${prefix}.${payload.slice(0, -1)}${replacement}.${signature}`;

  assert.throws(
    () => manager.validate(tampered, baseContext),
    (error) => error.code === 'invalid_quote',
  );
});

test('native Aptos quote itemizes direct protocol cost and Vessel fee', async () => {
  const manager = QuoteManager.forTest({ secret: SECRET, pricing: async () => breakdown });
  const context = {
    ...baseContext,
    chain: 'aptos',
    sourceNetwork: 'aptos-testnet',
    sourceAddress: '0xaptos',
    storageAddress: '0xaptos',
  };
  const quote = await manager.issueUpload(context);

  assert.equal(quote.settlementToken, 'APT + ShelbyUSD');
  assert.equal(quote.storageShelbyUsdUnits, '1260');
  assert.equal(quote.nativeServiceFeeShelbyUsdUnits, '70100');
  assert.equal(quote.solanaAmountMicro, '0');
});

test('production quote manager refuses missing or weak signing secrets', () => {
  for (const secret of ['', 'short-secret']) {
    assert.throws(
      () => new QuoteManager({ secret, environment: 'production', priceUpload: async () => breakdown }),
      /PAY_SECRET/,
    );
  }
});

test('upload quote includes contract evidence without reading live pricing twice', async () => {
  let pricingCalls = 0;
  const contractCalls = [];
  const manager = new QuoteManager({
    secret: SECRET,
    environment: 'test',
    now: () => 1_000,
    priceUpload: async () => {
      pricingCalls += 1;
      return breakdown;
    },
    contractQuoteManager: {
      issueUploadFromBreakdown: async (context, quotedBreakdown) => {
        contractCalls.push({ context, quotedBreakdown });
        return {
          contractQuote: { quoteId: '11'.repeat(32) },
          contractSignature: '22'.repeat(64),
          quotePublicKey: '33'.repeat(32),
        };
      },
    },
  });

  const quote = await manager.issueUpload(baseContext);

  assert.equal(pricingCalls, 1);
  assert.equal(contractCalls.length, 1);
  assert.deepEqual(contractCalls[0].quotedBreakdown, breakdown);
  assert.equal(contractCalls[0].context.fileHash, baseContext.fileHash);
  assert.equal(quote.contractQuote.quoteId, '11'.repeat(32));
  assert.equal(quote.contractSignature, '22'.repeat(64));
  assert.equal(quote.quotePublicKey, '33'.repeat(32));
});

test('a fresh server instance validates a quote issued with the same HMAC key', async () => {
  const issuer = QuoteManager.forTest({
    secret: SECRET,
    now: () => 1_000,
    pricing: async () => breakdown,
  });
  const verifier = QuoteManager.forTest({
    secret: SECRET,
    now: () => 2_000,
    pricing: async () => breakdown,
  });

  const quote = await issuer.issueUpload(baseContext);

  assert.equal(verifier.validate(quote.quoteToken, baseContext).quoteId, quote.quoteId);
});

test('quote context normalizes defaults and rejects malformed bindings', () => {
  const context = normalizeUploadQuoteContext({
    ...baseContext,
    sourceNetwork: undefined,
    storageNetwork: undefined,
  });
  assert.equal(context.sourceNetwork, 'solana-devnet');
  assert.equal(context.storageNetwork, 'shelby-testnet');
  assert.equal(Object.isFrozen(context), true);

  for (const change of [
    { fileHash: 'bad' },
    { sizeBytes: 0 },
    { days: 366 },
    { encoding: -1 },
    { expirationMicros: 0 },
    { sourceAddress: '' },
  ]) {
    assert.throws(() => normalizeUploadQuoteContext({ ...baseContext, ...change }));
  }
});
