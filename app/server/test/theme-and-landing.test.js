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

test('Landing CTAs route users into the app and the workflow explanation', () => {
  const html = readPage('index.html');
  const appEntries = getLinks(html).filter((link) => /data-dapp-entry/.test(link.attrs));
  assert.equal(appEntries.length, 3);
  assert.deepEqual(appEntries.map((link) => link.href), [
    '/identity.html', '/identity.html', '/identity.html',
  ]);
  const workflowEntry = getLinks(html).find((link) => link.href === '#how-it-works');
  assert.equal(workflowEntry?.text.toUpperCase().replace(/^SOUTH\s+/, ''), 'EXPLORE HOW IT WORKS');
  assert.doesNotMatch(html, /data-wallet-summary|connect wallet to start/i);
});

test('dApp wallet actions no longer use the legacy MetaMask ownership path', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.doesNotMatch(source, /window\.ethereum|connectWallet|proveOwnership/);
  assert.match(source, /openAccountMenu/);
});

test('Landing presents the implemented platform scale and workflow', () => {
  const html = readPage('index.html');
  assert.match(html, /Wallet-owned hot storage for NFT media/i);
  assert.match(html, />\s*2\s*<[^>]*>[\s\S]*Wallet ecosystems/i);
  assert.match(html, />\s*2\s*<[^>]*>[\s\S]*Settlement contracts/i);
  assert.match(html, />\s*1\s*<[^>]*>[\s\S]*Canonical NFT schema/i);
  assert.match(html, /id="how-it-works"/);
  for (const label of ['Connect', 'Store', 'Publish']) {
    assert.match(html, new RegExp(`>\\s*${label}\\s*<`, 'i'));
  }
});

test('Landing names current storage, metadata, and proof capabilities', () => {
  const html = readPage('index.html');
  for (const claim of [
    'Wallet-native identity',
    'Single and batch upload',
    'Wallet-scoped Vault',
    'NFT metadata',
    'Collection JSON export',
    'Latency proof',
    'Flexible retention',
    'Contract receipts',
  ]) {
    assert.match(html, new RegExp(claim, 'i'));
  }
});

test('Landing explains both chain paths and honest beta safeguards', () => {
  const html = readPage('index.html');
  assert.match(html, /\/assets\/hero-crystals\.png/);
  assert.match(html, /Aptos native/i);
  assert.match(html, /Solana DAA/i);
  assert.match(html, /Ed25519-signed quotes/i);
  assert.match(html, /Aptos Multisig Account/i);
  assert.match(html, /Squads/i);
  assert.match(html, /testnet beta/i);
  assert.doesNotMatch(html, /API is paused|public API is not available/i);
  assert.doesNotMatch(html, /permanent storage|production SLA|guaranteed availability|encrypted|immutable blobs/i);
});
