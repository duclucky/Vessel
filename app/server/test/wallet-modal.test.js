import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicDir } from './html-test-utils.js';

test('wallet UI declares dialog, live error, safe icons, switch, and disconnect contracts', () => {
  const source = fs.readFileSync(path.join(publicDir, 'wallet-modal.js'), 'utf8');
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /SWITCH WALLET/);
  assert.match(source, /DISCONNECT/);
  assert.match(source, /data-wallet-account-close/);
  assert.match(source, /document\.createElement\('img'\)/);
  assert.match(source, /event\.key [!=]== 'Tab'/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /querySelectorAll\('\.wallet-row'\)/);
  assert.match(source, /removeEventListener\('pointerdown'/);
  assert.doesNotMatch(source, /row\.innerHTML/);
});

test('wallet surfaces have centered, mobile-sheet, focus, and reduced-motion styles', () => {
  const css = fs.readFileSync(path.join(publicDir, 'vessel.css'), 'utf8');
  assert.match(css, /\.wallet-backdrop\s*\{/);
  assert.match(css, /\.wallet-dialog\s*\{/);
  assert.match(css, /\.wallet-row\s*\{[^}]*min-height:\s*56px/s);
  assert.match(css, /\.wallet-account-menu\s*\{/);
  assert.match(css, /@media \(max-width:\s*639px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
