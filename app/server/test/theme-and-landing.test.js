import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  publicDir,
  readPage,
  getLinks,
  hasInlineTailwindConfig,
} from './html-test-utils.js';

test('shared theme scripts parse and Landing uses them', () => {
  const theme = fs.readFileSync(path.join(publicDir, 'theme.js'), 'utf8');
  new Function(theme);
  const html = readPage('index.html');
  assert.match(html, /<script src="\/theme\.js"><\/script>/);
  assert.match(html, /<link[^>]+href="\/vessel\.css"/);
  assert.equal(hasInlineTailwindConfig(html), false);
});

test('Landing CTAs describe navigation and route to Identity', () => {
  const entries = getLinks(readPage('index.html'))
    .filter((link) => /data-dapp-entry/.test(link.attrs));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((link) => link.href), ['/identity.html', '/identity.html']);
  const labels = entries.map((link) => link.text.toUpperCase().replace(/^(APPS|ROCKET_LAUNCH)\s+/, ''));
  assert.deepEqual(labels, ['OPEN DAPP', 'LAUNCH STORAGE APP']);
  assert.doesNotMatch(readPage('index.html'), /data-wallet-summary|connect wallet to start/i);
});

test('dApp wallet actions no longer use the legacy MetaMask ownership path', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.doesNotMatch(source, /window\.ethereum|connectWallet|proveOwnership/);
  assert.match(source, /openAccountMenu/);
});

test('Landing serves crystal artwork locally and states three honest proofs', () => {
  const html = readPage('index.html');
  assert.match(html, /\/assets\/hero-crystals\.png/);
  assert.match(html, /Aptos or Solana wallet/i);
  assert.doesNotMatch(html, /Your Phantom wallet/i);
  assert.match(html, />\s*DAA\s*</);
  assert.match(html, />\s*Sub-second\s*</);
  assert.match(html, />\s*Ephemeral\s*</);
  assert.doesNotMatch(html, /encrypted|immutable|wiped weekly/i);
});
