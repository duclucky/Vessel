import test from 'node:test';
import assert from 'node:assert/strict';
import { getIds, hasInlineTailwindConfig, readPage } from './html-test-utils.js';

test('Latency keeps proof hooks inside the Ethereal shell', () => {
  const html = readPage('latency.html');
  const ids = getIds(html);
  for (const id of [
    'main-content', 'shelby-ms', 'shelby-bar', 'ipfs-ms', 'ipfs-unavailable',
    'ipfs-bar', 'shelby-median', 'shelby-min', 'shelby-p90', 'ipfs-median',
    'ipfs-min', 'ipfs-p90', 'rerun-btn',
  ]) assert.equal(ids.has(id), true, `missing #${id}`);
  assert.match(html, /Latency Proof/);
  assert.match(html, /Real reads/i);
  assert.match(html, /src="\/theme\.js"/);
  assert.equal(hasInlineTailwindConfig(html), false);
});

test('Metadata keeps generator hooks and accurately describes testnet storage', () => {
  const html = readPage('metadata.html');
  const ids = getIds(html);
  for (const id of [
    'main-content', 'meta-image-key', 'nft-name', 'nft-desc', 'nft-link',
    'json-preview', 'generate-btn', 'result-area', 'result-uri', 'copy-uri',
  ]) assert.equal(ids.has(id), true, `missing #${id}`);
  assert.match(html, /Metadata Atelier/);
  assert.match(html, /ephemeral/i);
  assert.doesNotMatch(html, /immutable/i);
  assert.match(html, /src="\/theme\.js"/);
  assert.equal(hasInlineTailwindConfig(html), false);
});
