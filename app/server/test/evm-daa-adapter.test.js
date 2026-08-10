import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEvmDaaAdapter } from '../client-src/wallets/evm-adapter.js';

const STORAGE = `0x${'33'.repeat(32)}`;
const provider = (chainId = '0xaa36a7') => {
  const calls = [];
  return {
    calls,
    async request(args) {
      calls.push(args);
      if (args.method === 'eth_requestAccounts') return ['0x1234567890abcdef1234567890abcdef12345678'];
      if (args.method === 'eth_accounts') return ['0x1234567890abcdef1234567890abcdef12345678'];
      if (args.method === 'eth_chainId') return chainId;
      if (args.method === 'wallet_switchEthereumChain') return null;
      throw new Error(`unexpected ${args.method}`);
    },
  };
};

test('EVM DAA adapter derives Shelby storage with official injected derivation', async () => {
  const source = provider();
  const adapter = createEvmDaaAdapter({
    descriptor: { name: 'MetaMask', provider: source },
    domain: 'vessel-sage.vercel.app',
    deriveStorageAddress: ({ ethereumAddress, domain }) => {
      assert.equal(ethereumAddress, '0x1234567890abcdef1234567890abcdef12345678');
      assert.equal(domain, 'vessel-sage.vercel.app');
      return STORAGE;
    },
    signAptosTransactionWithEthereum: async () => ({ status: 'Approved', args: { bcsToBytes: () => new Uint8Array([1]) } }),
  });

  const session = await adapter.connect();

  assert.equal(session.chain, 'evm');
  assert.equal(session.mode, 'daa');
  assert.equal(session.sourceNetwork, 'sepolia');
  assert.equal(session.sourceAddress, '0x1234567890abcdef1234567890abcdef12345678');
  assert.equal(session.storageAddress, STORAGE);
  assert.equal(session.walletName, 'MetaMask');
});

test('EVM DAA adapter can derive storage through the official Shelby bridge', async () => {
  const source = provider();
  let request;
  const officialShelby = {
    async connectWallet(input) {
      request = input;
      assert.equal(input.chain, 'evm');
      assert.equal(input.descriptor.name, 'MetaMask');
      assert.equal(input.wallet.account.address, '0x1234567890abcdef1234567890abcdef12345678');
      assert.equal(typeof input.wallet.request, 'function');
      return {
        chain: 'evm',
        mode: 'daa',
        sourceNetwork: 'sepolia',
        sourceAddress: '0x1234567890abcdef1234567890abcdef12345678',
        storageNetwork: 'shelbynet',
        storageAddress: STORAGE,
      };
    },
  };
  const adapter = createEvmDaaAdapter({
    descriptor: { name: 'MetaMask', provider: source },
    officialShelby,
    signAptosTransactionWithEthereum: async () => ({ status: 'Approved', args: {} }),
  });

  const session = await adapter.connect();

  assert.ok(request);
  assert.equal(session.chain, 'evm');
  assert.equal(session.sourceNetwork, 'sepolia');
  assert.equal(session.sourceAddress, '0x1234567890abcdef1234567890abcdef12345678');
  assert.equal(session.storageNetwork, 'shelbynet');
  assert.equal(session.storageAddress, STORAGE);
});

test('EVM DAA adapter normalizes official Shelby Aptos-style storage addresses', async () => {
  const source = provider();
  const storageHex = '4d'.repeat(32);
  const adapter = createEvmDaaAdapter({
    descriptor: { name: 'MetaMask', provider: source },
    officialShelby: {
      async connectWallet() {
        return {
          chain: 'evm',
          mode: 'daa',
          sourceNetwork: 'sepolia',
          sourceAddress: '0x1234567890abcdef1234567890abcdef12345678',
          storageNetwork: 'shelbynet',
          storageAddress: `@${storageHex}`,
        };
      },
    },
    signAptosTransactionWithEthereum: async () => ({ status: 'Approved', args: {} }),
  });

  const session = await adapter.connect();

  assert.equal(session.storageAddress, `0x${storageHex}`);
});

test('EVM DAA adapter times out a wallet provider that never opens approval', async () => {
  const adapter = createEvmDaaAdapter({
    descriptor: {
      name: 'Phantom',
      provider: { request: async () => new Promise(() => {}) },
    },
    walletRequestTimeoutMs: 5,
    deriveStorageAddress: () => STORAGE,
    signAptosTransactionWithEthereum: async () => ({ status: 'Approved', args: {} }),
  });

  await assert.rejects(
    () => adapter.connect(),
    /Wallet did not respond/,
  );
});

test('EVM DAA adapter falls back to deterministic storage when official bridge never resolves', async () => {
  const source = provider();
  const adapter = createEvmDaaAdapter({
    descriptor: { name: 'OKX Wallet', provider: source },
    walletRequestTimeoutMs: 5,
    officialShelby: {
      connectWallet: async () => new Promise(() => {}),
    },
    deriveStorageAddress: ({ ethereumAddress }) => {
      assert.equal(ethereumAddress, '0x1234567890abcdef1234567890abcdef12345678');
      return STORAGE;
    },
    signAptosTransactionWithEthereum: async () => ({ status: 'Approved', args: {} }),
  });

  const session = await adapter.connect();

  assert.equal(session.storageAddress, STORAGE);
  assert.equal(session.storageNetwork, 'shelbynet');
});

test('wallet bootstrap routes EVM DAA through the official Shelby bridge', () => {
  const source = readFileSync(new URL('../client-src/vessel-wallets.js', import.meta.url), 'utf8');
  const evmBlockStart = source.indexOf("wallet.chain === 'evm' && wallet.enabled");
  const evmBlockEnd = source.indexOf("wallet.chain === 'evm')", evmBlockStart);
  const evmBlock = source.slice(evmBlockStart, evmBlockEnd);

  assert.match(evmBlock, /officialShelby:\s*window\.VesselOfficialShelby/);
});

test('EVM DAA adapter requests Sepolia before reporting ready', async () => {
  const source = provider('0x1');
  const adapter = createEvmDaaAdapter({
    descriptor: { name: 'MetaMask', provider: source },
    deriveStorageAddress: () => STORAGE,
    signAptosTransactionWithEthereum: async () => ({ status: 'Approved', args: {} }),
  });

  await adapter.connect();

  assert.deepEqual(source.calls.map((call) => call.method), [
    'eth_requestAccounts',
    'eth_chainId',
    'wallet_switchEthereumChain',
  ]);
  assert.deepEqual(source.calls.at(-1).params, [{ chainId: '0xaa36a7' }]);
});

test('EVM DAA adapter signs Aptos transactions through the official Ethereum signer helper', async () => {
  const source = provider();
  let signed = null;
  const rawTransaction = { bcsToBytes: () => new Uint8Array([9]) };
  const adapter = createEvmDaaAdapter({
    descriptor: { name: 'MetaMask', provider: source },
    deriveStorageAddress: () => STORAGE,
    signAptosTransactionWithEthereum: async (input) => {
      signed = input;
      return { status: 'Approved', args: { bcsToBytes: () => new Uint8Array([1, 2, 3]) } };
    },
  });
  await adapter.connect();

  const result = await adapter.signAptosTransaction(rawTransaction);

  assert.equal(signed.eip1193Provider, source);
  assert.equal(signed.rawTransaction, rawTransaction);
  assert.equal(signed.ethereumAddress, '0x1234567890AbcdEF1234567890aBcdef12345678');
  assert.deepEqual([...result.bcsToBytes()], [1, 2, 3]);
});

test('EVM DAA signing preserves the provider account casing required by the official helper', async () => {
  const checksumAddress = '0x1234567890AbcdEF1234567890aBcdef12345678';
  const source = provider();
  const originalRequest = source.request.bind(source);
  source.request = async (args) => (
    args.method === 'eth_accounts' ? [checksumAddress] : originalRequest(args)
  );
  let signedAddress = null;
  const adapter = createEvmDaaAdapter({
    descriptor: { name: 'OKX Wallet', provider: source },
    deriveStorageAddress: () => STORAGE,
    signAptosTransactionWithEthereum: async (input) => {
      signedAddress = input.ethereumAddress;
      return { status: 'Approved', args: {} };
    },
  });
  await adapter.connect();

  await adapter.signAptosTransaction({});

  assert.equal(signedAddress, checksumAddress);
});
