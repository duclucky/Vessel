import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readme = fs.readFileSync(path.resolve(here, '../../..', 'README.md'), 'utf8');

test('README describes the deployed product and current degraded mode', () => {
  for (const claim of [
    'https://vessel-sage.vercel.app',
    'Shelby public API is temporarily paused',
    'browser-local Vault history',
    'Aptos Move contract',
    'Solana Program',
    'canonical NFT metadata',
    'batch collection',
  ]) assert.match(readme, new RegExp(claim, 'i'));
});

test('README exposes current testnet deployments and verification commands', () => {
  assert.match(readme, /0x9885a9a0e382335d0f801301d43b451facaa6e768d31e5c9903b2a0dd9efef15/i);
  assert.match(readme, /G2dA3Sz1XxvJ4ppkvwb95kfy5w6M9ip2KiZBmt7xbsBx/);
  assert.match(readme, /npm test/);
  assert.match(readme, /npm run build:client/);
  assert.match(readme, /Root Directory.*app\/server/i);
});

test('README no longer presents historical flows as release truth', () => {
  assert.doesNotMatch(readme, /working build.*Cách B|older sponsored-USDC walkthrough/i);
  assert.doesNotMatch(readme, /Ethereum DAA byte-upload is not yet possible upstream/i);
  assert.doesNotMatch(readme, /Gallery currently lists the server account/i);
});
