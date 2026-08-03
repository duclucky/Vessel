import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('Metadata is discoverable from desktop and mobile navigation on every page', () => {
  for (const page of [
    'index.html',
    'identity.html',
    'upload.html',
    'gallery.html',
    'latency.html',
    'metadata.html',
  ]) {
    const html = readPage(page);
    const links = html.match(/href="\/metadata\.html"[^>]*>Metadata<\/a>/g) || [];
    assert.equal(links.length >= 2, true, `${page} desktop and mobile Metadata links`);
  }
});

test('the five-link navigation stays collapsed until the large breakpoint', () => {
  for (const page of [
    'index.html',
    'identity.html',
    'upload.html',
    'gallery.html',
    'latency.html',
    'metadata.html',
  ]) {
    const html = readPage(page);
    assert.match(html, /hidden items-center gap-7 lg:flex/, page);
    assert.match(html, /relative lg:hidden/, page);
  }
});

test('Metadata previews the selected artifact and gates generation on image availability', () => {
  const html = readPage('metadata.html');
  const ids = getIds(html);
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  for (const id of ['meta-image-preview', 'meta-image-fallback', 'meta-image-status']) {
    assert.equal(ids.has(id), true, `missing #${id}`);
  }
  assert.match(html, /id="meta-image-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /disabled:opacity-50/);
  assert.match(source, /new URL\(url, window\.location\.origin\)\.href/);
  assert.match(source, /previewImage\.addEventListener\('load'/);
  assert.match(source, /previewImage\.addEventListener\('error'/);
  assert.match(source, /gen\.disabled = !sourceReady/);
  assert.match(source, /Source artifact is unavailable\. Choose another artifact from your Vault\./);
});
