import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../client-src/vessel-solana.js', import.meta.url), 'utf8');

test('DAA client requires an explicitly selected provider', () => {
  assert.match(source, /function selectProvider\(nextProvider\)/);
  assert.match(source, /async function connect\(nextProvider\)/);
  assert.match(source, /function clearProvider\(\)/);
  assert.doesNotMatch(source, /provider\s*=\s*getPhantom\(\)/);
});

test('DAA client no longer exposes funding URLs', () => {
  assert.doesNotMatch(source, /faucet/i);
  assert.doesNotMatch(source, /faucets/);
});

test('DAA upload binds the sponsor request to quote, authorization, hash, tier, and expiration', () => {
  assert.match(source, /quoteToken/);
  assert.match(source, /paidAuthorization/);
  assert.match(source, /expectedFileHash/);
  assert.match(source, /paymentTier/);
  assert.match(source, /uploadContext\.expirationMicros !== expirationMicros/);
  assert.doesNotMatch(source, /paymentId/);
  assert.doesNotMatch(source, /uploadToken/);
  assert.doesNotMatch(source, /7\s*\*\s*24\s*\*\s*3600/);
});
