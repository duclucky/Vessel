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

test('every Landing wallet entry routes to Identity without MetaMask', () => {
  const entries = getLinks(readPage('index.html'))
    .filter((link) => /data-wallet-entry/.test(link.attrs));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((link) => link.href), ['/identity.html', '/identity.html']);
});

test('Landing serves crystal artwork locally and states three honest proofs', () => {
  const html = readPage('index.html');
  assert.match(html, /\/assets\/hero-crystals\.png/);
  assert.match(html, />\s*DAA\s*</);
  assert.match(html, />\s*Sub-second\s*</);
  assert.match(html, />\s*Ephemeral\s*</);
  assert.doesNotMatch(html, /encrypted|immutable|wiped weekly/i);
});
