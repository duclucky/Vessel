import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createSolanaAdapter } from '../client-src/wallets/solana-adapter.js';

const key = new PublicKey('EUrhHCRueCGE39yvNM1zV15fyCcizY2P8xLzDNdc418s');

function standardWallet({ versions = ['legacy'], accounts } = {}) {
  const account = {
    address: key.toBase58(),
    publicKey: key.toBytes(),
    chains: ['solana:devnet'],
    features: ['solana:signMessage', 'solana:signAndSendTransaction'],
  };
  let silent;
  let changeListener;
  const wallet = {
    name: 'Standard Wallet',
    chains: ['solana:devnet'],
    accounts: [],
    features: {
      'standard:connect': {
        connect: async (options = {}) => {
          silent = options.silent;
          return { accounts: accounts || [account] };
        },
      },
      'standard:events': {
        on: (event, listener) => {
          assert.equal(event, 'change');
          changeListener = listener;
          return () => { changeListener = null; };
        },
      },
      'standard:disconnect': { disconnect: async () => {} },
      'solana:signMessage': {
        signMessage: async ({ message }) => [{
          signedMessage: message,
          signature: Uint8Array.from({ length: 64 }, (_, index) => index),
        }],
      },
      'solana:signAndSendTransaction': {
        supportedTransactionVersions: versions,
        signAndSendTransaction: async ({ chain, transaction }) => {
          assert.equal(chain, 'solana:devnet');
          assert.ok(transaction instanceof Uint8Array);
          return [{ signature: Uint8Array.from({ length: 64 }, () => 1) }];
        },
      },
    },
    get silent() { return silent; },
    emitAccounts(nextAccounts) { changeListener?.({ accounts: nextAccounts }); },
  };
  return wallet;
}

test('standard signMessage is normalized to the proven DAA provider contract', async () => {
  const wallet = standardWallet();
  const adapter = createSolanaAdapter({
    id: 'solana:standard:1',
    name: 'Standard Wallet',
    provider: wallet,
  });

  const daa = adapter.daaProvider();
  const connected = await daa.connect({ onlyIfTrusted: true });
  const signed = await daa.signMessage(Uint8Array.from([1, 2, 3]));

  assert.equal(wallet.silent, true);
  assert.equal(connected.publicKey.toBase58(), key.toBase58());
  assert.equal(signed.signature.length, 64);
  assert.deepEqual([...signed.signedMessage], [1, 2, 3]);
});

test('standard signAndSendTransaction returns a base58 signature', async () => {
  const adapter = createSolanaAdapter({
    id: 'solana:standard:1',
    name: 'Standard Wallet',
    provider: standardWallet(),
  });
  await adapter.daaProvider().connect();
  const transaction = new Transaction();
  transaction.recentBlockhash = key.toBase58();
  transaction.feePayer = key;
  transaction.add(SystemProgram.transfer({ fromPubkey: key, toPubkey: key, lamports: 0 }));

  const result = await adapter.daaProvider().signAndSendTransaction(transaction);

  assert.equal(typeof result.signature, 'string');
  assert.ok(result.signature.length > 40);
});

test('controller session and account events retain the selected wallet identity', async () => {
  const wallet = standardWallet();
  const adapter = createSolanaAdapter({
    id: 'solana:standard:1',
    name: 'Standard Wallet',
    provider: wallet,
  });
  const events = [];
  adapter.setStorageAddress('0xdaa');
  adapter.subscribe((event) => events.push(event));

  const session = await adapter.connect({ silent: false });
  wallet.emitAccounts([{
    address: 'NextSolanaAddress',
    publicKey: key.toBytes(),
    chains: ['solana:devnet'],
  }]);

  assert.equal(session.sourceAddress, key.toBase58());
  assert.equal(session.storageAddress, '0xdaa');
  assert.equal(session.mode, 'daa');
  assert.equal(events[0].session.sourceAddress, 'NextSolanaAddress');
  assert.equal(events[0].session.storageAddress, '');
});

test('provider without legacy transaction support is rejected', () => {
  assert.throws(
    () => createSolanaAdapter({
      id: 'solana:standard:1',
      name: 'Standard Wallet',
      provider: standardWallet({ versions: [0] }),
    }),
    (error) => error.code === 'provider_incompatible',
  );
});
