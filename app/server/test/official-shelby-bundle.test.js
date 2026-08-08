import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('official Shelby React island is bundled and loaded before wallet controller', () => {
  const build = readFileSync('build-client.mjs', 'utf8');
  assert.match(build, /client-src\/vessel-official-shelby\.jsx/);
  assert.match(build, /public\/vessel-official-shelby\.js/);

  for (const page of ['identity.html', 'upload.html', 'metadata.html', 'gallery.html']) {
    const html = readFileSync(`public/${page}`, 'utf8');
    const island = html.indexOf('vessel-official-shelby.js');
    const wallets = html.indexOf('vessel-wallets.js');
    assert.ok(island > 0, `${page} loads official Shelby island`);
    assert.ok(wallets > island, `${page} loads wallet controller after official Shelby island`);
  }
});

test('official Shelby bridge exposes the stable browser API surface', () => {
  const bridge = readFileSync('client-src/official-shelby/bridge.jsx', 'utf8');
  for (const method of [
    'scanWallets',
    'connectWallet',
    'disconnect',
    'getSession',
    'upload',
    'resumeUpload',
    'isReady',
  ]) {
    assert.match(bridge, new RegExp(`${method}\\s*\\(`));
  }
  assert.match(bridge, /window\.VesselOfficialShelby/);
});
