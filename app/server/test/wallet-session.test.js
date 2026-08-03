import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletController } from '../client-src/wallets/session.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    keys: () => [...values.keys()],
  };
}

test('connect persists only wallet id and chain and publishes one session', async () => {
  const store = storage();
  const descriptor = { id: 'solana:phantom:1', chain: 'solana', enabled: true };
  const registry = { scan: async () => [descriptor], subscribe: () => () => {} };
  const session = {
    chain: 'solana',
    walletId: descriptor.id,
    walletName: 'Phantom',
    sourceAddress: 'SOL',
    sourceNetwork: 'devnet',
    storageAddress: '0xDAA',
    mode: 'daa',
  };
  const controller = createWalletController({
    registry,
    storage: store,
    resolveAdapter: () => ({
      connect: async () => session,
      disconnect: async () => {},
      subscribe: () => () => {},
    }),
  });
  const published = [];
  controller.subscribe((next) => published.push(next));

  await controller.scan();
  await controller.connect(descriptor.id);

  assert.equal(controller.getState().session.storageAddress, '0xDAA');
  assert.equal(store.getItem('vessel.wallet.id'), descriptor.id);
  assert.equal(store.getItem('vessel.wallet.chain'), 'solana');
  assert.equal(store.getItem('vessel.wallet.session'), null);
  assert.deepEqual(store.keys().sort(), ['vessel.wallet.chain', 'vessel.wallet.id']);
  assert.equal(published.at(-1).session, session);
});

test('restore uses silent connection and disconnect clears hints', async () => {
  const store = storage();
  store.setItem('vessel.wallet.id', 'aptos:petra:1');
  store.setItem('vessel.wallet.chain', 'aptos');
  let silent;
  const descriptor = { id: 'aptos:petra:1', chain: 'aptos', enabled: true };
  const controller = createWalletController({
    registry: { scan: async () => [descriptor], subscribe: () => () => {} },
    storage: store,
    resolveAdapter: () => ({
      connect: async (input) => {
        silent = input.silent;
        return null;
      },
      disconnect: async () => {},
      subscribe: () => () => {},
    }),
  });

  await controller.restore();

  assert.equal(silent, true);
  assert.equal(controller.getState().status, 'disconnected');
  await controller.disconnect();
  assert.equal(store.getItem('vessel.wallet.id'), null);
  assert.equal(store.getItem('vessel.wallet.chain'), null);
});

test('adapter network events preserve the session and expose network-required state', async () => {
  const descriptor = { id: 'aptos:petra:1', chain: 'aptos', enabled: true };
  let onAdapterEvent;
  const initialSession = {
    chain: 'aptos', walletId: descriptor.id, walletName: 'Petra', sourceAddress: '0x1',
    sourceNetwork: 'mainnet', storageAddress: '0x1', mode: 'native',
  };
  const controller = createWalletController({
    registry: { scan: async () => [descriptor], subscribe: () => () => {} },
    storage: storage(),
    resolveAdapter: () => ({
      connect: async () => initialSession,
      disconnect: async () => {},
      subscribe: (listener) => { onAdapterEvent = listener; return () => {}; },
    }),
  });
  await controller.scan();
  await controller.connect(descriptor.id);

  onAdapterEvent({ session: initialSession, status: 'network_required', error: 'Switch to Aptos Testnet' });

  assert.equal(controller.getState().status, 'network_required');
  assert.equal(controller.getState().session, initialSession);
  assert.equal(controller.getState().error, 'Switch to Aptos Testnet');

  await controller.scan();
  assert.equal(controller.getState().status, 'network_required');
});

test('wrong-network connection keeps the Aptos account and can retry the active adapter', async () => {
  const store = storage();
  const descriptor = { id: 'aptos:petra:1', chain: 'aptos', enabled: true };
  const session = {
    chain: 'aptos', walletId: descriptor.id, walletName: 'Petra', sourceAddress: '0x1',
    sourceNetwork: 'testnet', storageAddress: '0x1', mode: 'native',
  };
  let networkReady = false;
  const controller = createWalletController({
    registry: { scan: async () => [descriptor], subscribe: () => () => {} },
    storage: store,
    resolveAdapter: () => ({
      connect: async () => {
        if (networkReady) return session;
        throw Object.assign(new Error('Switch to Aptos Testnet'), {
          code: 'switch_unsupported',
          session,
        });
      },
      ensureNetwork: async () => { networkReady = true; },
      disconnect: async () => {},
      subscribe: () => () => {},
    }),
  });
  await controller.scan();

  await assert.rejects(() => controller.connect(descriptor.id), /Switch to Aptos Testnet/);
  assert.equal(controller.getState().status, 'network_required');
  assert.equal(controller.getState().session, session);
  assert.equal(store.getItem('vessel.wallet.id'), descriptor.id);

  await controller.ensureNetwork();
  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().session, session);
});

test('identity re-derivation blocks upload readiness until the new DAA arrives', async () => {
  const descriptor = { id: 'solana:standard:1', chain: 'solana', enabled: true };
  let onAdapterEvent;
  const readySession = {
    chain: 'solana', walletId: descriptor.id, walletName: 'Standard', sourceAddress: 'SOL',
    sourceNetwork: 'devnet', storageAddress: '0xdaa', mode: 'daa',
  };
  const controller = createWalletController({
    registry: { scan: async () => [descriptor], subscribe: () => () => {} },
    storage: storage(),
    resolveAdapter: () => ({
      connect: async () => readySession,
      disconnect: async () => {},
      subscribe: (listener) => { onAdapterEvent = listener; return () => {}; },
    }),
  });
  await controller.scan();
  await controller.connect(descriptor.id);

  onAdapterEvent({
    status: 'identity_required',
    session: { ...readySession, storageAddress: '' },
  });
  assert.equal(controller.getState().status, 'identity_required');
  assert.equal(controller.getState().session.storageAddress, '');

  onAdapterEvent({
    status: 'ready',
    session: { ...readySession, storageAddress: '0xdaa2' },
  });
  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().session.storageAddress, '0xdaa2');
});

test('disconnect clears app state even when the provider disconnect fails', async () => {
  const store = storage();
  const descriptor = { id: 'solana:phantom:1', chain: 'solana', enabled: true };
  const controller = createWalletController({
    registry: { scan: async () => [descriptor], subscribe: () => () => {} },
    storage: store,
    resolveAdapter: () => ({
      connect: async () => ({
        chain: 'solana', walletId: descriptor.id, walletName: 'Phantom', sourceAddress: 'SOL',
        sourceNetwork: 'devnet', storageAddress: '0xDAA', mode: 'daa',
      }),
      disconnect: async () => { throw new Error('Provider is already gone'); },
      subscribe: () => () => {},
    }),
  });
  await controller.scan();
  await controller.connect(descriptor.id);

  await controller.disconnect();

  assert.equal(controller.getState().status, 'disconnected');
  assert.equal(controller.getState().session, null);
  assert.equal(store.getItem('vessel.wallet.id'), null);
  assert.equal(store.getItem('vessel.wallet.chain'), null);
});

test('switching wallet disconnects the previous adapter before connecting the next one', async () => {
  const calls = [];
  const first = { id: 'solana:first:1', chain: 'solana', enabled: true };
  const second = { id: 'aptos:second:1', chain: 'aptos', enabled: true };
  const controller = createWalletController({
    registry: { scan: async () => [first, second], subscribe: () => () => {} },
    storage: storage(),
    resolveAdapter: (descriptor) => ({
      connect: async () => {
        calls.push(`connect:${descriptor.id}`);
        return {
          chain: descriptor.chain,
          walletId: descriptor.id,
          walletName: descriptor.id,
          sourceAddress: descriptor.id,
          sourceNetwork: 'testnet',
          storageAddress: descriptor.id,
          mode: descriptor.chain === 'aptos' ? 'native' : 'daa',
        };
      },
      disconnect: async () => calls.push(`disconnect:${descriptor.id}`),
      subscribe: () => () => {},
    }),
  });
  await controller.scan();
  await controller.connect(first.id);
  await controller.connect(second.id);

  assert.deepEqual(calls, [
    `connect:${first.id}`,
    `disconnect:${first.id}`,
    `connect:${second.id}`,
  ]);
  assert.equal(controller.getState().session.walletId, second.id);
});
