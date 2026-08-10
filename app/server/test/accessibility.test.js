import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getIds,
  getLinks,
  hasCompiledTailwindCss,
  hasInlineTailwindConfig,
  publicDir,
  readPage,
} from './html-test-utils.js';

const pages = [
  'index.html', 'identity.html', 'upload.html', 'gallery.html',
  'latency.html', 'metadata.html', 'launch.html',
];
const publicPages = fs.readdirSync(publicDir).filter((file) => file.endsWith('.html'));

test('all six journeys share the accessible Ethereal shell', () => {
  for (const page of pages) {
    const html = readPage(page);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, `${page}: viewport`);
    assert.match(html, /class="skip-link" href="#main-content"/, `${page}: skip link`);
    assert.equal(getIds(html).has('main-content'), true, `${page}: main landmark target`);
    assert.match(html, /<h1\b/, `${page}: h1`);
    assert.match(html, /<footer\b/, `${page}: footer`);
    assert.match(html, /Powered by Shelby · Live on ShelbyNet/, `${page}: Shelby attribution and live network status`);
    assert.doesNotMatch(html, /Shelby Testnet · [^<]+ · Data is Ephemeral/, `${page}: no stale beta status`);
    assert.equal(hasCompiledTailwindCss(html), true, `${page}: compiled CSS shell`);
    assert.equal(hasInlineTailwindConfig(html), false, `${page}: no divergent Tailwind config`);
    assert.equal(getLinks(html).some((link) => link.href === '#'), false, `${page}: no placeholder links`);
    assert.doesNotMatch(html, /\bimmutable\b|\bencrypted\b/i, `${page}: no unsupported storage claim`);
    const mobileIconOnlyLinks = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
      .filter((match) => /class="[^"]*\bhidden\b[^"]*\bsm:inline\b/.test(match[2]))
      .filter((match) => !/\baria-label=/.test(match[1]));
    assert.equal(mobileIconOnlyLinks.length, 0, `${page}: mobile icon-only link needs an accessible name`);
  }
});

test('public pages use compiled Tailwind CSS instead of the browser CDN', () => {
  for (const page of publicPages) {
    const html = readPage(page);
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com/, `${page}: Tailwind browser CDN must not ship`);
    assert.doesNotMatch(html, /src="\/theme\.js"/, `${page}: Tailwind runtime config must not ship`);
    assert.equal(hasCompiledTailwindCss(html), true, `${page}: compiled Tailwind should load before Vessel overrides`);
  }
  assert.equal(fs.existsSync(path.join(publicDir, 'tailwind.css')), true, 'compiled public/tailwind.css exists');
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
  for (const file of ['ledger.js', 'app.js']) {
    const result = spawnSync(process.execPath, ['--check', path.join(publicDir, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test('wallet bundle source is present and every dApp page loads it before app.js', () => {
  assert.equal(fs.existsSync(path.join(publicDir, 'vessel-wallets.js')), true);
  for (const page of ['identity.html', 'upload.html', 'gallery.html', 'latency.html', 'metadata.html', 'launch.html']) {
    const html = readPage(page);
    assert.match(html, /<script src="\/vessel-wallets\.js"><\/script>/, page);
    assert.ok(
      html.indexOf('/vessel-wallets.js') < html.indexOf('/app.js'),
      `${page}: wallet bundle must load before app.js`,
    );
  }
});

test('every dApp page uses a real wallet-summary button', () => {
  for (const page of ['identity.html', 'upload.html', 'gallery.html', 'latency.html', 'metadata.html', 'launch.html']) {
    const html = readPage(page);
    assert.match(html, /<button\b[^>]*data-wallet-summary[^>]*>/, `${page}: wallet button`);
    assert.doesNotMatch(html, /<a\b[^>]*data-wallet-summary/, `${page}: wallet action must not be a link`);
    assert.doesNotMatch(html, /href="#sign-btn"/, `${page}: no fragment proxy for wallet action`);
  }
});
