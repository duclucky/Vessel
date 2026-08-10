import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function packageJson(path) {
  return JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
}

test('official Shelby Solana kit uses the current UID-based Shelby SDK contract interface', () => {
  const solanaKit = packageJson('../node_modules/@shelby-protocol/solana-kit/package.json');

  assert.equal(solanaKit.version, '0.2.12');
  assert.equal(solanaKit.dependencies['@shelby-protocol/sdk'], '0.6.0');
});

test('official Shelby Ethereum kit uses the current UID-based Shelby SDK contract interface', () => {
  const ethereumKit = packageJson('../node_modules/@shelby-protocol/ethereum-kit/package.json');

  assert.equal(ethereumKit.version, '0.1.13');
  assert.equal(ethereumKit.dependencies['@shelby-protocol/sdk'], '0.6.0');
});
