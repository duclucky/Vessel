import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(signed.ethereumAddress, '0x1234567890abcdef1234567890abcdef12345678');
  assert.deepEqual([...result.bcsToBytes()], [1, 2, 3]);
});
