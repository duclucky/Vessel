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
