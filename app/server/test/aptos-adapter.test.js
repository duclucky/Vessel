import test from 'node:test';
import assert from 'node:assert/strict';
import { createAptosAdapter } from '../client-src/wallets/aptos-adapter.js';

const approved = (args) => ({ status: 'Approved', args });

function wallet({
  network = { name: 'testnet', chainId: 2 },
  changeNetwork,
  calls,
  connectError,
  signMessage,
} = {}) {
  const account = {
    address: { toString: () => '0xabc' },
    publicKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  };
  let accountListener;
  let networkListener;
  const provider = {
    name: 'Petra',
    features: {
      'aptos:connect': {
        connect: async (...args) => {
          calls?.push(['connect', ...args]);
          if (connectError) throw connectError;
          return approved(account);
        },
      },
      'aptos:disconnect': { disconnect: async () => {} },
      'aptos:account': { account: async () => account },
      'aptos:network': {
        network: async () => {
          calls?.push(['network']);
          return network;
        },
      },
      'aptos:changeNetwork': changeNetwork ? { changeNetwork } : undefined,
      'aptos:onAccountChange': {
        onAccountChange: async (listener) => { accountListener = listener; },
      },
      'aptos:onNetworkChange': {
        onNetworkChange: async (listener) => { networkListener = listener; },
      },
      'aptos:signAndSubmitTransaction': {
        signAndSubmitTransaction: async ({ payload }) => approved({ hash: payload.function }),
      },
      'aptos:signMessage': {
        signMessage: signMessage || (async ({ message, nonce }) => approved({
          fullMessage: `APTOS\nmessage: ${message}\nnonce: ${nonce}`,
          signature: Uint8Array.from({ length: 64 }, (_, index) => index),
          publicKey: account.publicKey,
        })),
      },
    },
    emitAccount: async (next) => accountListener?.(next),
    emitNetwork: async (next) => networkListener?.(next),
  };
  return provider;
}

test('Aptos one-approval evidence preserves canonical and wallet-standard signed messages', async () => {
  const adapter = createAptosAdapter({
    id: 'aptos:petra:1',
    name: 'Petra',
    provider: wallet(),
  });
  await adapter.connect();

  const signed = await adapter.signMessage('VESSEL_UPLOAD_SESSION\nQuoteId: quote-1');

  assert.equal(signed.message, 'VESSEL_UPLOAD_SESSION\nQuoteId: quote-1');
  assert.equal(
    signed.signedMessage,
    'APTOS\nmessage: VESSEL_UPLOAD_SESSION\nQuoteId: quote-1\nnonce: vessel-upload-session',
  );
  assert.match(signed.signature, /^0x[0-9a-f]{128}$/i);
  assert.match(signed.publicKey, /^0x[0-9a-f]{64}$/i);
});

test('native Aptos session uses the wallet address as storage address', async () => {
  const provider = wallet();
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });

  const session = await adapter.connect({ silent: false });

  assert.equal(session.sourceAddress, '0xabc');
  assert.equal(session.storageAddress, '0xabc');
  assert.equal(session.sourceNetwork, 'testnet');
  assert.equal(session.mode, 'native');
});

test('Petra explicit connect passes no arguments and checks network afterward', async () => {
  const calls = [];
  const provider = wallet({ calls });
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });

  await adapter.connect({ silent: false });

  assert.deepEqual(calls, [['connect'], ['network']]);
});

test('Petra silent restore passes the wallet-standard silent flag', async () => {
  const calls = [];
  const provider = wallet({ calls });
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });

  await adapter.connect({ silent: true });

  assert.deepEqual(calls, [['connect', true], ['network']]);
});

test('opaque Petra API failures become actionable without extension internals', async () => {
  const provider = wallet({
    connectError: Object.assign(new Error('PetraApiError'), {
      code: -30_001,
      stack: 'secret extension stack',
    }),
  });
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });

  await assert.rejects(
    () => adapter.connect(),
    (error) => error.code === 'provider_unavailable'
      && error.message === 'Petra could not connect. Unlock Petra and try again.'
      && !error.message.includes('stack'),
  );
});

test('wrong network requests Aptos Testnet when changeNetwork exists', async () => {
  let requested;
  const provider = wallet({
    network: { name: 'mainnet', chainId: 1 },
    changeNetwork: async (input) => {
      requested = input;
      return approved({ success: true });
    },
  });
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });

  await adapter.connect({ silent: false });

  assert.deepEqual(requested, { name: 'testnet', chainId: 2 });
});

test('runtime target network can request ShelbyNet instead of Aptos Testnet', async () => {
  let requested;
  const provider = wallet({
    network: { name: 'testnet', chainId: 2 },
    changeNetwork: async (input) => {
      requested = input;
      return approved({ success: true });
    },
  });
  const adapter = createAptosAdapter(
    { id: 'aptos:petra:1', name: 'Petra', provider },
    { targetNetwork: { name: 'shelbynet', chainId: 118, displayName: 'ShelbyNet' } },
  );

  const session = await adapter.connect({ silent: false });

  assert.deepEqual(requested, { name: 'shelbynet', chainId: 118 });
  assert.equal(session.sourceNetwork, 'shelbynet');
});

test('ShelbyNet target accepts custom wallet labels when chain ID matches', async () => {
  let switchCalls = 0;
  const provider = wallet({
    network: { name: 'custom', chainId: 118 },
    changeNetwork: async () => {
      switchCalls += 1;
      throw new Error('should not request a network switch');
    },
  });
  const adapter = createAptosAdapter(
    { id: 'aptos:petra:1', name: 'Petra', provider },
    { targetNetwork: { name: 'shelbynet', chainId: 118, displayName: 'ShelbyNet' } },
  );

  const session = await adapter.connect({ silent: false });

  assert.equal(session.sourceAddress, '0xabc');
  assert.equal(session.sourceNetwork, 'shelbynet');
  assert.equal(switchCalls, 0);
});

test('wrong network without changeNetwork exposes manual switch state', async () => {
  const adapter = createAptosAdapter({
    id: 'aptos:petra:1',
    name: 'Petra',
    provider: wallet({ network: { name: 'mainnet', chainId: 1 } }),
  });

  await assert.rejects(
    () => adapter.connect({ silent: false }),
    (error) => error.code === 'switch_unsupported',
  );
});

test('rejected network switch retains the connected session for manual retry', async () => {
  const adapter = createAptosAdapter({
    id: 'aptos:petra:1',
    name: 'Petra',
    provider: wallet({
      network: { name: 'mainnet', chainId: 1 },
      changeNetwork: async () => ({ status: 'Rejected' }),
    }),
  });

  await assert.rejects(
    () => adapter.connect({ silent: false }),
    (error) => error.code === 'wrong_network' && error.session?.sourceAddress === '0xabc',
  );
});

test('Petra API failure while switching networks becomes a manual Testnet request', async () => {
  const adapter = createAptosAdapter({
    id: 'aptos:petra:1',
    name: 'Petra',
    provider: wallet({
      network: { name: 'custom', chainId: 118 },
      changeNetwork: async () => {
        throw Object.assign(new Error('PetraApiError'), { code: -30_001 });
      },
    }),
  });

  await assert.rejects(
    () => adapter.connect({ silent: false }),
    (error) => error.code === 'wrong_network'
      && error.message === 'Switch your wallet to Aptos Testnet'
      && error.session?.sourceAddress === '0xabc',
  );
});

test('ShelbyNet target reports ShelbyNet in manual switch errors and network events', async () => {
  const provider = wallet({
    network: { name: 'mainnet', chainId: 1 },
    changeNetwork: async () => {
      throw Object.assign(new Error('PetraApiError'), { code: -30_001 });
    },
  });
  const adapter = createAptosAdapter(
    { id: 'aptos:petra:1', name: 'Petra', provider },
    { targetNetwork: { name: 'shelbynet', chainId: 118, displayName: 'ShelbyNet' } },
  );

  await assert.rejects(
    () => adapter.connect({ silent: false }),
    (error) => error.code === 'wrong_network'
      && error.message === 'Switch your wallet to ShelbyNet'
      && error.session?.sourceNetwork === 'shelbynet',
  );
});

test('transaction payload and account/network events use the normalized adapter contract', async () => {
  const provider = wallet();
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });
  const events = [];
  adapter.subscribe((event) => events.push(event));
  await adapter.connect({ silent: false });

  const submitted = await adapter.signAndSubmitTransaction({ data: { function: 'register_blob' } });
  await provider.emitAccount({ address: { toString: () => '0xdef' } });
  await provider.emitNetwork({ name: 'mainnet', chainId: 1 });
  await provider.emitNetwork({ name: 'testnet', chainId: 2 });

  assert.equal(submitted.hash, 'register_blob');
  assert.equal(events[0].session.sourceAddress, '0xdef');
  assert.equal(events[0].session.storageAddress, '0xdef');
  assert.equal(events[1].status, 'network_required');
  assert.equal(events[2].status, 'ready');
});

test('missing required provider features fails with provider_unavailable', async () => {
  const adapter = createAptosAdapter({ id: 'aptos:broken:1', name: 'Broken', provider: { features: {} } });
  await assert.rejects(
    () => adapter.connect({ silent: false }),
    (error) => error.code === 'provider_unavailable',
  );
});
