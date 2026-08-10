import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhantomCompatibilityAdapter } from '../client-src/wallets/phantom-compat.js';

test('Phantom compatibility adapter normalizes the existing DAA connection', async () => {
  let connectCalls = 0;
  const descriptor = { id: 'solana:phantom:1', name: 'Phantom', chain: 'solana' };
  const adapter = createPhantomCompatibilityAdapter({
    descriptor,
    vesselSolana: {
      network: 'testnet',
      connect: async () => {
        connectCalls += 1;
        return { solana: 'SOLANA_ADDRESS', storageAccount: '0xDAA', network: 'testnet' };
      },
    },
  });

  assert.equal(await adapter.connect({ silent: true }), null);
  assert.equal(connectCalls, 0, 'silent restore must not open an extension prompt');
  assert.deepEqual(await adapter.connect({ silent: false }), {
    chain: 'solana',
    walletId: descriptor.id,
    walletName: 'Phantom',
    sourceAddress: 'SOLANA_ADDRESS',
    sourceNetwork: 'testnet',
    storageAddress: '0xdaa',
    mode: 'daa',
  });
  assert.equal(connectCalls, 1);
});

test('Phantom compatibility adapter delegates disconnect when available', async () => {
  let disconnected = false;
  const adapter = createPhantomCompatibilityAdapter({
    descriptor: { id: 'solana:phantom:1', name: 'Phantom' },
    vesselSolana: { disconnect: async () => { disconnected = true; } },
  });
  const off = adapter.subscribe(() => {});
  assert.equal(typeof off, 'function');
  await adapter.disconnect();
  assert.equal(disconnected, true);
});
