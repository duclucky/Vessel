import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { publicDir, readPage } from './html-test-utils.js';

test('Launch Kit page exposes source, profile, target, validation, and output hooks', () => {
  const html = readPage('launch.html');
  for (const id of [
    'launch-root',
    'launch-wallet-status',
    'launch-storage-address',
    'launch-collection-list',
    'launch-profile-form',
    'launch-targets',
    'launch-validation',
    'launch-output-preview',
    'launch-download-package',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Prepare chain-specific NFT handoff files from a Shelby Vault collection/i);
  assert.match(html, /does not mint NFTs/i);
  assert.match(html, /ShelbyNet testnet beta/i);
});

test('all public pages include Launch Kit navigation', () => {
  for (const file of ['index.html', 'identity.html', 'upload.html', 'gallery.html', 'metadata.html', 'collection.html', 'proof.html', 'latency.html', 'launch.html']) {
    assert.match(readPage(file), /href="\/launch.html"[^>]*>Launch Kit</, file);
  }
});

test('Launch Kit does not ask for a local folder and does not claim minting', () => {
  const html = readPage('launch.html');
  assert.doesNotMatch(html, /webkitdirectory|type="file"|Select folder|Choose folder/i);
  assert.doesNotMatch(html, /Mint now|Deploy contract|OpenSea API|Magic Eden API/i);
});

test('app dispatch includes launch initializer hook', () => {
  const app = readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /initLaunchKitPage/);
  assert.match(app, /launch:\s*initLaunch/);
});
