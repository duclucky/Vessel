import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readme = fs.readFileSync(path.resolve(here, '../../..', 'README.md'), 'utf8');

test('README describes the deployed product and current network availability', () => {
  for (const claim of [
    'https://vessel-sage.vercel.app',
    'Supported storage runtimes',
    'Aptos Testnet and ShelbyNet',
    'Currently available runtime',
    'ShelbyNet',
    'Aptos Testnet is implemented',
    'browser-local Vault history',
    'Aptos Move fee contract',
    'Solana fee program',
    'Sepolia EVM fee contract',
    'official Shelby DAA',
    'canonical NFT metadata',
    'batch collection',
    'mainnet readiness',
    'weekly wipe',
    'not permanent storage',
  ]) assert.match(readme, new RegExp(claim, 'i'));

  assert.doesNotMatch(readme, /Shelby public API is temporarily paused/i);
  assert.doesNotMatch(readme, /Production currently runs with `SHELBY_WRITES_ENABLED=false`/i);
});

test('README documents the current one percent Vessel fee policy', () => {
  assert.match(readme, /1% Vessel service fee/i);
  assert.match(readme, /USD 0\.01 minimum/i);
  assert.match(readme, /source-chain Vessel charge/i);
  assert.match(readme, /sponsored ShelbyNet gas/i);
  assert.doesNotMatch(readme, /2% Vessel service fee/i);
  assert.doesNotMatch(readme, /holds only the Vessel service fee/i);
});

test('README exposes current testnet deployments and verification commands', () => {
  assert.match(readme, /0x9885a9a0e382335d0f801301d43b451facaa6e768d31e5c9903b2a0dd9efef15/i);
  assert.match(readme, /6K7MzA7zbRkgxKmQikZzawYxmDHv3LWK8XFjHhqChi1b/);
  assert.match(readme, /0x71D48A95c55d3eBd260A2dF52dc41F9DbaBD0F64/i);
  assert.match(readme, /npm test/);
  assert.match(readme, /npm run build:client/);
  assert.match(readme, /Root Directory.*app\/server/i);
});

test('README no longer presents historical flows as release truth', () => {
  assert.doesNotMatch(readme, /working build.*Cách B|older sponsored-USDC walkthrough/i);
  assert.doesNotMatch(readme, /Ethereum DAA byte-upload is not yet possible upstream/i);
  assert.doesNotMatch(readme, /Gallery currently lists the server account/i);
});
