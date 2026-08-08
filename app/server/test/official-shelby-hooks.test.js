import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('official Shelby hook wrapper uses the canonical React kit entrypoints', () => {
  const source = readFileSync('client-src/official-shelby/shelby-hooks.jsx', 'utf8');

  assert.match(source, /@shelby-protocol\/solana-kit\/react/);
  assert.match(source, /@shelby-protocol\/ethereum-kit\/react/);
  assert.match(source, /@shelby-protocol\/sdk\/browser/);
  assert.match(source, /useSolanaStorageAccount/);
  assert.match(source, /useEthereumStorageAccount/);
  assert.match(source, /new ShelbyClient\(\{\s*network: SolanaNetwork\.SHELBYNET\s*\}\)/s);
  assert.doesNotMatch(source, /apiKey/);
});

test('official Shelby hook wrapper normalizes chain sessions for the bridge', () => {
  const source = readFileSync('client-src/official-shelby/shelby-hooks.jsx', 'utf8');

  for (const field of [
    'storageAccountAddress',
    'signTransaction',
    'submitTransaction',
    'signAndSubmitTransaction',
    'storageAddress',
  ]) {
    assert.match(source, new RegExp(field));
  }

  assert.match(source, /chain: 'solana'/);
  assert.match(source, /chain: 'evm'/);
  assert.match(source, /storageNetwork: 'shelbynet'/);
  assert.match(source, /toString\(\)/);
});

test('official Shelby bridge consumes the hook wrapper instead of deriving storage itself', () => {
  const bridge = readFileSync('client-src/official-shelby/bridge.jsx', 'utf8');

  assert.match(bridge, /useOfficialShelbyStorageAccounts/);
  assert.doesNotMatch(bridge, /EIP1193DerivedPublicKey/);
  assert.doesNotMatch(bridge, /derived-wallet-solana/);
});

test('wallet bootstrap routes Solana DAA through the official Shelby bridge', () => {
  const source = readFileSync('client-src/vessel-wallets.js', 'utf8');
  const solanaBlockStart = source.indexOf("wallet.chain === 'solana'");
  const solanaBlockEnd = source.indexOf("wallet.chain === 'evm'", solanaBlockStart);
  const solanaBlock = source.slice(solanaBlockStart, solanaBlockEnd);

  assert.match(solanaBlock, /officialShelby:\s*window\.VesselOfficialShelby/);
  assert.doesNotMatch(solanaBlock, /daaClient:\s*window\.VesselSolana/);
});
