import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFamilyCapabilities,
  createWalletRegistry,
} from '../client-src/wallets/registry.js';

const aptosFeatures = {
  'aptos:account': {},
  'aptos:connect': {},
  'aptos:disconnect': {},
  'aptos:network': {},
  'aptos:onAccountChange': {},
  'aptos:onNetworkChange': {},
  'aptos:signMessage': {},
  'aptos:signTransaction': {},
  'aptos:signAndSubmitTransaction': {},
};

const solanaFeatures = {
  'standard:connect': {},
  'standard:events': {},
  'solana:signMessage': {},
  'solana:signAndSendTransaction': {},
};

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      const registered = listeners.get(name) || new Set();
      registered.add(listener);
      listeners.set(name, registered);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
}

test('a multi-chain extension appears once in Aptos and once in Solana', async () => {
  const wallet = {
    name: 'Nightly',
    icon: 'data:image/png;base64,AA==',
    version: '1.0.0',
    chains: ['aptos:testnet', 'solana:devnet'],
    features: { ...aptosFeatures, ...solanaFeatures },
    accounts: [],
  };
  const registry = createWalletRegistry({
    aptosSource: { get: () => [wallet], on: () => () => {} },
    standardSource: { get: () => [wallet], on: () => () => {} },
    eventTarget: eventTarget(),
  });

  const rows = await registry.scan();

  assert.deepEqual(rows.map(({ chain, name }) => ({ chain, name })), [
    { chain: 'aptos', name: 'Nightly' },
    { chain: 'solana', name: 'Nightly' },
  ]);
});

test('EIP-6963 providers are ready when the EVM family is enabled', async () => {
  const target = eventTarget();
  const registry = createWalletRegistry({
    aptosSource: { get: () => [], on: () => () => {} },
    standardSource: { get: () => [], on: () => () => {} },
    eventTarget: target,
  });
  target.dispatchEvent({
    type: 'eip6963:announceProvider',
    detail: {
      info: {
        uuid: '2c40a1f7-9df0-4592-87bf-70f50bb6f36e',
        name: 'MetaMask',
        icon: 'data:image/png;base64,AA==',
        rdns: 'io.metamask',
      },
      provider: { request: async () => [] },
    },
  });

  const rows = await registry.scan();

  assert.equal(rows[0].chain, 'evm');
  assert.equal(rows[0].enabled, true);
  assert.equal(rows[0].status, 'ready');
});

test('Solana providers without legacy transaction support are incompatible', async () => {
  const wallet = {
    name: 'Versioned Only',
    version: '1.0.0',
    chains: ['solana:devnet'],
    features: {
      ...solanaFeatures,
      'solana:signAndSendTransaction': { supportedTransactionVersions: [0] },
    },
  };
  const registry = createWalletRegistry({
    aptosSource: { get: () => [], on: () => () => {} },
    standardSource: { get: () => [wallet], on: () => () => {} },
    eventTarget: eventTarget(),
  });

  const [row] = await registry.scan();

  assert.equal(row.enabled, false);
  assert.equal(row.status, 'incompatible');
});

test('server family flags can disable a discovered wallet without hiding it', () => {
  const rows = applyFamilyCapabilities([
    { id: 'aptos:petra', chain: 'aptos', enabled: true, status: 'ready' },
    { id: 'solana:phantom', chain: 'solana', enabled: true, status: 'ready' },
    { id: 'evm:metamask', chain: 'evm', enabled: true, status: 'ready' },
  ], { aptos: false, solana: true, evm: false });

  assert.deepEqual(rows.map(({ enabled, status }) => ({ enabled, status })), [
    { enabled: false, status: 'unavailable' },
    { enabled: true, status: 'ready' },
    { enabled: false, status: 'unavailable' },
  ]);
});
