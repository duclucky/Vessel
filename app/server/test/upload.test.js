import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage, getIds, hasInlineTailwindConfig } from './html-test-utils.js';

test('Upload preserves every runtime state and honest sponsorship copy', () => {
  const html = readPage('upload.html');
  const ids = getIds(html);
  for (const id of [
    'main-content',
    'upload-initial-view',
    'drop-zone',
    'file-input',
    'upload-progress-view',
    'progress-percentage',
    'progress-bar',
    'upload-filename',
    'upload-success-view',
    'result-thumb',
    'result-key',
    'result-url',
    'copy-url',
    'result-size',
    'to-metadata',
  ]) {
    assert.equal(ids.has(id), true, id);
  }
  assert.equal(hasInlineTailwindConfig(html), false);
  assert.match(html, /Sponsored DAA upload/i);
  assert.match(html, /testnet USDC/i);
  assert.doesNotMatch(html, /AES|encrypted|immutable|weekly/i);
});
