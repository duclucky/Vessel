import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const paidUploadAccess = fs.readFileSync(new URL('../src/lib/paid-upload-access.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const solana = fs.readFileSync(new URL('../client-src/vessel-solana.js', import.meta.url), 'utf8');

test('contract settlement is the only route that can issue paid authorization', () => {
  assert.match(server, /app\.post\('\/api\/settlements\/verify'/);
  assert.match(server, /verifyContractQuoteSignature/);
  assert.match(server, /settlementAdapters\.verify/);
  assert.match(server, /paidAuthorizations\.issue\(\{\s*quote:\s*contractEvidence,\s*receipt/s);
  assert.match(server, /quoteManager\.validate\(quoteToken/);
  assert.match(server, /paidAuthorizations\.issue/);
  assert.match(server, /validatePaidUploadAuthorization/);
  assert.match(paidUploadAccess, /paidAuthorizations\.validate/);
  assert.match(server, /expectedSender:\s*quote\.context\.storageAddress/);
  assert.doesNotMatch(server, /app\.post\('\/api\/pay\/quote'/);
  assert.doesNotMatch(server, /createIntent/);
  assert.doesNotMatch(server, /app\.post\('\/api\/pay\/(?:solana|aptos)\/verify'/);
});

test('upload quotes are dual-signed with the configured deployment key', () => {
  assert.match(server, /new ContractQuoteManager\(\{/);
  assert.match(server, /privateKeyFromPkcs8Base64\(config\.quoteSignerPrivateKeyBase64\)/);
  assert.match(server, /contractQuoteManager,/);
  assert.match(server, /assertContractQuoteMatchesContext\(contractQuote, signedQuote, settlementDeployments\)/);
});

test('contract receipt verification emits redacted submitted, pending, verified, and failed stages', () => {
  for (const stage of [
    'settlement_submitted',
    'receipt_pending',
    'receipt_verified',
    'settlement_failed',
  ]) {
    assert.match(server, new RegExp(`stage: '${stage}'`));
  }
  assert.match(server, /deploymentId/);
  assert.match(server, /finalityLatencyMs/);
});

test('browser payment flow creates one immutable context and reuses its expiration', () => {
  assert.match(app, /activeUploadContext = Object\.freeze\(\{ file, intent, quote \}\)/);
  assert.match(app, /settleContractQuote\(\{/);
  assert.match(app, /expirationMicros:\s*quotedContext\.quote\.expirationMicros/);
  assert.match(solana, /uploadContext\.expirationMicros !== expirationMicros/);
  assert.match(solana, /paidAuthorization/);
  assert.doesNotMatch(app, /\/api\/pay\/quote/);
  assert.doesNotMatch(app, /\/api\/pay\/verify/);
  assert.doesNotMatch(app, /7\s*\*\s*24\s*\*\s*3600/);
});

test('HTTP helper accepts an abort signal for wallet invalidation', () => {
  assert.match(app, /form, signal/);
  assert.match(app, /opts\.signal = signal/);
});

test('dynamic upload quote routes use live Shelby pricing, gas price, and SDK chunksets', () => {
  assert.match(server, /app\.post\('\/api\/quotes\/upload'/);
  assert.match(server, /app\.post\('\/api\/quotes\/validate'/);
  assert.match(server, /createShelbyPricingReader/);
  assert.match(server, /getGasPriceEstimation/);
  assert.match(server, /expectedTotalChunksets/);
  assert.match(server, /requiresConfirmation:\s*Math\.abs\(driftPercentBps\) > 500/);
});

test('first-party production sources contain no legacy direct-transfer payment path', () => {
  const files = [
    '../src/index.js',
    '../src/config.js',
    '../src/lib/payments.js',
    '../src/lib/aptos-settlement.js',
    '../public/app.js',
    '../public/settlement-client.js',
    '../client-src/vessel-solana.js',
    '../client-src/vessel-wallets.js',
    '../.env.example',
  ];
  const combined = files
    .filter((file) => fs.existsSync(new URL(file, import.meta.url)))
    .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
    .join('\n');
  for (const forbidden of [
    ['SOLANA', 'TREASURY', 'SECRET', 'KEY'].join('_'),
    ['APTOS', 'TREASURY', 'ADDRESS'].join('_'),
    ['treasury', 'Ata'].join(''),
    'primary_fungible_store::transfer',
    ['create', 'Transfer', 'Instruction'].join(''),
    ['/api/pay/', 'solana', '/verify'].join(''),
    ['/api/pay/', 'aptos', '/verify'].join(''),
    ['verify', 'Quote', 'Payment'].join(''),
    ['verify', 'Aptos', 'Shelby', 'Usd', 'Transfer'].join(''),
  ]) {
    assert.equal(combined.includes(forbidden), false, forbidden);
  }
});
