import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicNetworkDescriptor,
  resolveShelbyKeys,
  resolveShelbyNetwork,
} from '../src/lib/shelby-network.js';

test('resolves Aptos Testnet without deleting its runtime values', () => {
  const runtime = resolveShelbyNetwork('testnet');
  assert.equal(runtime.name, 'testnet');
  assert.equal(runtime.displayName, 'Aptos Testnet');
  assert.equal(runtime.status, 'maintenance');
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.chainId, 2);
  assert.equal(runtime.rpcBaseUrl, 'https://api.testnet.shelby.xyz/shelby');
  assert.equal(runtime.aptosNetwork, 'testnet');
});

test('resolves ShelbyNet as the live runtime', () => {
  const runtime = resolveShelbyNetwork('shelbynet');
  assert.equal(runtime.name, 'shelbynet');
  assert.equal(runtime.displayName, 'ShelbyNet');
  assert.equal(runtime.status, 'live');
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.chainId, 118);
  assert.equal(runtime.rpcBaseUrl, 'https://api.shelbynet.shelby.xyz/shelby');
  assert.equal(runtime.aptosNetwork, 'shelbynet');
});

test('unknown Shelby network fails closed', () => {
  assert.throws(() => resolveShelbyNetwork('devnet'), /Unsupported Shelby network/);
});

test('split Shelby keys fall back to legacy SHELBY_API_KEY', () => {
  const keys = resolveShelbyKeys({
    SHELBY_API_KEY: 'legacy',
    SHELBY_RPC_API_KEY: 'rpc',
    SHELBY_INDEXER_API_KEY: '',
  });
  assert.deepEqual(keys, {
    legacyApiKey: 'legacy',
    rpcApiKey: 'rpc',
    indexerApiKey: 'legacy',
    aptosApiKey: 'legacy',
  });
});

test('split Shelby keys ignore documented placeholders and fall back to legacy key', () => {
  const keys = resolveShelbyKeys({
    SHELBY_API_KEY: 'legacy',
    SHELBY_RPC_API_KEY: '<ShelbyNet API key>',
    SHELBY_INDEXER_API_KEY: 'replace-me',
    SHELBY_APTOS_API_KEY: '',
  });
  assert.deepEqual(keys, {
    legacyApiKey: 'legacy',
    rpcApiKey: 'legacy',
    indexerApiKey: 'legacy',
    aptosApiKey: 'legacy',
  });
});

test('public descriptor contains no secret values', () => {
  const descriptor = publicNetworkDescriptor(resolveShelbyNetwork('shelbynet'));
  assert.deepEqual(descriptor, {
    active: 'shelbynet',
    displayName: 'ShelbyNet',
    status: 'live',
    chainId: 118,
    storageNetwork: 'shelbynet',
    aptos: { name: 'shelbynet', chainId: 118 },
    options: [
      { name: 'testnet', displayName: 'Aptos Testnet', status: 'maintenance', enabled: false },
      { name: 'shelbynet', displayName: 'ShelbyNet', status: 'live', enabled: true },
    ],
  });
});
