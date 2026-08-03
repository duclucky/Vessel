import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const solana = fs.readFileSync(new URL('../client-src/vessel-solana.js', import.meta.url), 'utf8');

test('settlement and sponsor routes require signed quote and paid authorization context', () => {
  assert.match(server, /app\.post\('\/api\/pay\/solana\/verify'/);
  assert.match(server, /app\.post\('\/api\/pay\/aptos\/verify'/);
  assert.match(server, /quoteManager\.validate\(quoteToken/);
  assert.match(server, /payments\.verifyQuotePayment/);
  assert.match(server, /verifyAptosShelbyUsdTransfer/);
  assert.match(server, /paidAuthorizations\.issue/);
  assert.match(server, /paidAuthorizations\.validate/);
  assert.match(server, /expectedSender:\s*quote\.context\.storageAddress/);
  assert.doesNotMatch(server, /app\.post\('\/api\/pay\/quote'/);
  assert.doesNotMatch(server, /createIntent/);
});

test('browser payment flow creates one immutable context and reuses its expiration', () => {
  assert.match(app, /const uploadContext = Object\.freeze\(/);
  assert.match(app, /body:\s*uploadContext/);
  assert.match(app, /uploadContext,/);
  assert.match(solana, /expirationMicros = uploadContext\.expirationMicros/);
  assert.match(solana, /\.\.\.uploadContext/);
  assert.doesNotMatch(solana, /const expirationMicros = Date\.now\(\)/);
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
