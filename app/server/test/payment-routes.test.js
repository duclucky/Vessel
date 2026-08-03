import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const solana = fs.readFileSync(new URL('../client-src/vessel-solana.js', import.meta.url), 'utf8');

test('quote and sponsor routes require the complete normalized payment context', () => {
  assert.match(server, /normalizePaymentContext\(req\.body/);
  assert.match(server, /payments\.createIntent\(context\)/);
  assert.match(server, /payments\.checkUploadToken\(paymentId, uploadToken, context\)/);
  assert.match(server, /expectedSender:\s*context\.storageAddress/);
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
