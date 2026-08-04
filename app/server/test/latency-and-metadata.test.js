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

test('Metadata exposes accessible single and batch composer hooks', () => {
  const html = readPage('metadata.html');
  const ids = getIds(html);
  for (const id of [
    'main-content', 'metadata-mode-tabs', 'metadata-single-tab', 'metadata-batch-tab',
    'metadata-single-panel', 'metadata-batch-panel', 'meta-image-key',
    'meta-image-preview', 'meta-image-fallback', 'meta-image-status',
    'nft-name', 'nft-desc', 'nft-link', 'single-traits', 'single-add-trait',
    'single-retention-days', 'json-preview', 'single-validation',
    'single-download-json', 'single-host-shelby', 'result-area', 'result-uri', 'copy-uri',
    'metadata-collection-list', 'metadata-collection-refresh', 'metadata-collection-status',
    'batch-name-prefix',
    'batch-description', 'batch-external-url', 'batch-uri-vessel',
    'batch-uri-custom', 'batch-base-uri', 'batch-csv-input',
    'batch-summary', 'batch-item-table', 'batch-json-preview',
    'batch-download-zip', 'batch-host-shelby', 'batch-host-progress',
    'batch-host-status', 'batch-host-current', 'batch-host-results',
    'batch-host-retry', 'metadata-hosting-status',
  ]) assert.equal(ids.has(id), true, `missing #${id}`);
  assert.match(html, /Metadata Atelier/);
  assert.match(html, /ephemeral/i);
  assert.match(html, /1 GB beta limit/i);
  assert.match(html, /mainnet/i);
  assert.doesNotMatch(html, /immutable/i);
  assert.equal(ids.has('metadata-folder-picker'), false);
  assert.equal(ids.has('metadata-folder-input'), false);
  assert.doesNotMatch(html, /Select collection folder|webkitdirectory/i);
  assert.match(html, /Select a Shelby collection/i);
  assert.match(html, /src="\/theme\.js"/);
  assert.match(html, /id="metadata-mode-tabs"[^>]*role="tablist"/);
  assert.match(html, /id="metadata-single-tab"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="metadata-single-panel"/);
  assert.match(html, /id="metadata-batch-tab"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="metadata-batch-panel"/);
  assert.match(html, /id="metadata-single-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="metadata-single-tab"/);
  assert.match(html, /id="metadata-batch-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="metadata-batch-tab"[^>]*hidden/);
  assert.match(html, /id="single-validation"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="metadata-hosting-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="batch-host-progress"[^>]*max="100"/);
  assert.match(html, /id="batch-host-status"[^>]*aria-live="polite"/);
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
  assert.match(source, /initMetadataPage/);
  assert.doesNotMatch(source, /api\('\/api\/metadata'/);
});
