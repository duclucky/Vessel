import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicDir } from './html-test-utils.js';

const read = (name) => fs.readFileSync(path.join(publicDir, name), 'utf8');

test('confirmation dialog exposes the accessible modal contract', () => {
  const source = read('confirm-dialog.js');
  assert.match(source, /export function confirmAction/);
  assert.match(source, /role', 'dialog'/);
  assert.match(source, /aria-modal', 'true'/);
  assert.match(source, /vessel-dialog-title/);
  assert.match(source, /keydown/);
  assert.match(source, /Escape/);
  assert.match(source, /shiftKey/);
  assert.match(source, /opener\?\.focus/);
});

test('dialog and text fields do not let long hashes overflow the viewport', () => {
  const css = read('vessel.css');
  const app = read('app.js');

  assert.match(css, /\.vessel-dialog-title\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /input\.vessel-input\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(css, /textarea\.vessel-input\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(app, /metadataHostDisplayName/);
  assert.doesNotMatch(app, /title:\s*`Host \$\{file\.name\}/);
});

test('Gallery uses Vessel copy and never opens a browser confirmation', () => {
  const source = read('app.js');
  assert.match(source, /confirmAction\(\{/);
  assert.match(source, /GALLERY ACTION/);
  assert.match(source, /Remove artifact\?/);
  assert.match(source, /REMOVE FROM GALLERY/);
  assert.doesNotMatch(source, /\bconfirm\s*\(/);
});
