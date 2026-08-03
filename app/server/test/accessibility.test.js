import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getIds, getLinks, hasInlineTailwindConfig, publicDir, readPage } from './html-test-utils.js';

const pages = [
  'index.html', 'identity.html', 'upload.html', 'gallery.html',
  'latency.html', 'metadata.html',
];

test('all six journeys share the accessible Ethereal shell', () => {
  for (const page of pages) {
    const html = readPage(page);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, `${page}: viewport`);
    assert.match(html, /class="skip-link" href="#main-content"/, `${page}: skip link`);
    assert.equal(getIds(html).has('main-content'), true, `${page}: main landmark target`);
    assert.match(html, /<h1\b/, `${page}: h1`);
    assert.match(html, /<footer\b/, `${page}: footer`);
    assert.match(html, /Shelby Testnet · [^<]+ · Data is Ephemeral/, `${page}: honest environment status`);
    assert.match(html, /src="\/theme\.js"/, `${page}: shared theme`);
    assert.match(html, /href="\/vessel\.css"/, `${page}: shared CSS`);
    assert.equal(hasInlineTailwindConfig(html), false, `${page}: no divergent Tailwind config`);
    assert.equal(getLinks(html).some((link) => link.href === '#'), false, `${page}: no placeholder links`);
    assert.doesNotMatch(html, /\bimmutable\b|\bencrypted\b/i, `${page}: no unsupported storage claim`);
    const mobileIconOnlyLinks = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
      .filter((match) => /class="[^"]*\bhidden\b[^"]*\bsm:inline\b/.test(match[2]))
      .filter((match) => !/\baria-label=/.test(match[1]));
    assert.equal(mobileIconOnlyLinks.length, 0, `${page}: mobile icon-only link needs an accessible name`);
  }
});

test('shared CSS provides keyboard, touch, disabled, and reduced-motion states', () => {
  const css = fs.readFileSync(path.join(publicDir, 'vessel.css'), 'utf8');
  assert.match(css, /:focus-visible/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /:disabled/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /details\[open\]\s*>\s*\.vessel-nav/);
  assert.match(css, /max-height:\s*500px/);
  assert.match(
    css,
    /input\.vessel-input[^\{]*\{[^}]*background:\s*rgba\(12,\s*14,\s*19,\s*0\.7\)[^}]*color:\s*#e2e2e9/s,
  );
  assert.doesNotMatch(css, /\.vessel-input[^}]*!important/s);
  assert.match(readPage('index.html'), /vessel-landing-hero/);
});

test('browser modules parse after the shell consolidation', async () => {
  const { spawnSync } = await import('node:child_process');
  for (const file of ['theme.js', 'ledger.js', 'app.js']) {
    const result = spawnSync(process.execPath, ['--check', path.join(publicDir, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test('wallet bundle source is present and every dApp page loads it before app.js', () => {
  assert.equal(fs.existsSync(path.join(publicDir, 'vessel-wallets.js')), true);
  for (const page of ['identity.html', 'upload.html', 'gallery.html', 'latency.html', 'metadata.html']) {
    const html = readPage(page);
    assert.match(html, /<script src="\/vessel-wallets\.js"><\/script>/, page);
    assert.ok(
      html.indexOf('/vessel-wallets.js') < html.indexOf('/app.js'),
      `${page}: wallet bundle must load before app.js`,
    );
  }
});

test('every dApp page uses a real wallet-summary button', () => {
  for (const page of ['identity.html', 'upload.html', 'gallery.html', 'latency.html', 'metadata.html']) {
    const html = readPage(page);
    assert.match(html, /<button\b[^>]*data-wallet-summary[^>]*>/, `${page}: wallet button`);
    assert.doesNotMatch(html, /<a\b[^>]*data-wallet-summary/, `${page}: wallet action must not be a link`);
    assert.doesNotMatch(html, /href="#sign-btn"/, `${page}: no fragment proxy for wallet action`);
  }
});
