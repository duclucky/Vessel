import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  createSolanaAdapter,
  createSolanaDaaAdapter,
} from '../client-src/wallets/solana-adapter.js';

const key = new PublicKey('EUrhHCRueCGE39yvNM1zV15fyCcizY2P8xLzDNdc418s');

function standardWallet({ versions = ['legacy'], accounts, signOnly = true } = {}) {
  const account = {
    address: key.toBase58(),
    publicKey: key.toBytes(),
    chains: ['solana:devnet'],
    features: [
      'solana:signMessage',
      ...(signOnly ? ['solana:signTransaction'] : []),
      'solana:signAndSendTransaction',
    ],
  };
  let silent;
  let changeListener;
  const signTransactionFeature = signOnly ? {
    supportedTransactionVersions: versions,
    signTransaction: async ({ chain, transaction }) => {
      assert.equal(chain, 'solana:devnet');
      assert.ok(transaction instanceof Uint8Array);
      return [{ signedTransaction: Uint8Array.from([...transaction, 7]) }];
    },
  } : undefined;
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
      ...(signTransactionFeature ? { 'solana:signTransaction': signTransactionFeature } : {}),
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

test('Solana one-approval evidence preserves the exact UTF-8 signed message', async () => {
  const adapter = createSolanaAdapter({
    id: 'solana:standard:1',
    name: 'Standard Wallet',
    provider: standardWallet(),
  });
  await adapter.connect();

  const signed = await adapter.signMessage('VESSEL_UPLOAD_SESSION\nQuoteId: quote-1');

  assert.equal(signed.message, 'VESSEL_UPLOAD_SESSION\nQuoteId: quote-1');
  assert.equal(signed.signedMessage, signed.message);
  assert.equal(signed.publicKey, key.toBase58());
  assert.equal(Buffer.from(signed.signature, 'base64').length, 64);
});

test('Phantom DAA signing uses the matching injected provider when Wallet Standard stalls', async () => {
  const wallet = standardWallet();
  wallet.features['solana:signMessage'].signMessage = async () => {
    assert.fail('Wallet Standard signMessage must not be used when matching Phantom is available');
  };
  let legacyMessage;
  const adapter = createSolanaAdapter({
    id: 'solana:phantom:1',
    name: 'Phantom',
    provider: wallet,
  }, {
    legacyProvider: {
      publicKey: key,
      async signMessage(message) {
        legacyMessage = message;
        return { signature: Uint8Array.from({ length: 64 }, () => 9) };
      },
    },
  });

  const daa = adapter.daaProvider();
  await daa.connect();
  const signed = await daa.signMessage(Uint8Array.from([4, 5, 6]));

  assert.deepEqual([...legacyMessage], [4, 5, 6]);
  assert.deepEqual([...signed.signedMessage], [4, 5, 6]);
  assert.equal(signed.signature[0], 9);
});

test('standard signAndSendTransaction returns a base58 signature', async () => {
  const adapter = createSolanaAdapter({
    id: 'solana:standard:1',
    name: 'Standard Wallet',
    provider: standardWallet({ signOnly: false }),
  });
  await adapter.daaProvider().connect();
  assert.equal(adapter.daaProvider().signTransaction, undefined);
  const transaction = new Transaction();
  transaction.recentBlockhash = key.toBase58();
  transaction.feePayer = key;
  transaction.add(SystemProgram.transfer({ fromPubkey: key, toPubkey: key, lamports: 0 }));

  const result = await adapter.daaProvider().signAndSendTransaction(transaction);

  assert.equal(typeof result.signature, 'string');
  assert.ok(result.signature.length > 40);
});

test('standard signTransaction returns Devnet wallet-signed transaction bytes', async () => {
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
  const unsigned = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });

  const result = await adapter.daaProvider().signTransaction(transaction);

  assert.deepEqual([...result.signedTransaction], [...unsigned, 7]);
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

test('DAA adapter publishes ready only after the derived storage address exists', async () => {
  const wallet = standardWallet();
  let derivation = 0;
  const daaClient = {
    connect: async (selectedProvider) => {
      const { publicKey } = await selectedProvider.connect();
      derivation += 1;
      return {
        solana: publicKey.toBase58(),
        storageAccount: derivation === 1 ? '0xdaa' : '0xdaa2',
        network: 'testnet',
      };
    },
    clearProvider: () => {},
  };
  const adapter = createSolanaDaaAdapter({
    descriptor: { id: 'solana:standard:1', name: 'Standard Wallet', provider: wallet },
    daaClient,
  });
  const session = await adapter.connect({ silent: false });
  const events = [];
  adapter.subscribe((event) => events.push(event));

  wallet.emitAccounts([{
    address: key.toBase58(),
    publicKey: key.toBytes(),
    chains: ['solana:devnet'],
  }]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(session.storageAddress, '0xdaa');
  assert.equal(events[0].status, 'identity_required');
  assert.equal(events[0].session.storageAddress, '');
  assert.equal(events[1].status, 'ready');
  assert.equal(events[1].session.storageAddress, '0xdaa2');
});

test('DAA adapter can derive Solana storage through the official Shelby bridge', async () => {
  const wallet = standardWallet();
  const officialStorage = `0x${'5a'.repeat(32)}`;
  let request;
  let handoff;
  const officialShelby = {
    async connectWallet(input) {
      request = input;
      const signature = await input.wallet.signMessage(Uint8Array.from([9, 8, 7]));
      assert.equal(input.chain, 'solana');
      assert.equal(input.descriptor.id, 'solana:standard:1');
      assert.equal(input.wallet.account.address.toString(), key.toBase58());
      assert.equal(signature.length, 64);
      return {
        chain: 'solana',
        mode: 'daa',
        sourceNetwork: 'devnet',
        sourceAddress: key.toBase58(),
        storageNetwork: 'shelbynet',
        storageAddress: officialStorage,
      };
    },
    disconnect: async () => {},
  };
  const uploadClient = {
    acceptOfficialSession(input) {
      handoff = input;
    },
  };

  const adapter = createSolanaDaaAdapter({
    descriptor: { id: 'solana:standard:1', name: 'Standard Wallet', provider: wallet },
    officialShelby,
    uploadClient,
  });

  const session = await adapter.connect({ silent: false });

  assert.ok(request);
  assert.equal(session.sourceAddress, key.toBase58());
  assert.equal(session.storageAddress, officialStorage);
  assert.equal(session.storageNetwork, 'shelbynet');
  assert.equal(handoff.solana, key.toBase58());
  assert.equal(handoff.storageAccount, officialStorage);
  assert.equal(typeof handoff.provider.signMessage, 'function');
});

test('DAA adapter exposes one-approval message signing after official Shelby derivation', async () => {
  const wallet = standardWallet();
  const adapter = createSolanaDaaAdapter({
    descriptor: { id: 'solana:standard:1', name: 'Standard Wallet', provider: wallet },
    officialShelby: {
      async connectWallet() {
        return {
          chain: 'solana',
          mode: 'daa',
          sourceNetwork: 'devnet',
          sourceAddress: key.toBase58(),
          storageNetwork: 'shelbynet',
          storageAddress: `0x${'5a'.repeat(32)}`,
        };
      },
    },
  });
  await adapter.connect({ silent: false });

  const signed = await adapter.signMessage('VESSEL_UPLOAD_SESSION\nQuoteId: quote-1');

  assert.equal(signed.chain, 'solana');
  assert.equal(signed.address, key.toBase58());
  assert.equal(signed.signedMessage, 'VESSEL_UPLOAD_SESSION\nQuoteId: quote-1');
  assert.equal(Buffer.from(signed.signature, 'base64').length, 64);
});

test('DAA adapter normalizes official Shelby Aptos-style storage addresses', async () => {
  const wallet = standardWallet();
  let handoff;
  const storageHex = '4d'.repeat(32);
  const officialShelby = {
    async connectWallet() {
      return {
        chain: 'solana',
        mode: 'daa',
        sourceNetwork: 'devnet',
        sourceAddress: key.toBase58(),
        storageNetwork: 'shelbynet',
        storageAddress: `@${storageHex}`,
      };
    },
  };
  const adapter = createSolanaDaaAdapter({
    descriptor: { id: 'solana:standard:1', name: 'Standard Wallet', provider: wallet },
    officialShelby,
    uploadClient: {
      acceptOfficialSession(input) {
        handoff = input;
      },
    },
  });

  const session = await adapter.connect({ silent: false });

  assert.equal(session.storageAddress, `0x${storageHex}`);
  assert.equal(handoff.storageAccount, `0x${storageHex}`);
});
