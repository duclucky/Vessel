import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

const DEVNET = 'solana:devnet';
const adapterError = (message, code) => Object.assign(new Error(message), { code });

export function supportsLegacyTransactions(wallet) {
  const versions = wallet?.features?.['solana:signAndSendTransaction']
    ?.supportedTransactionVersions;
  return versions != null && Array.from(versions).includes('legacy');
}

export function createSolanaAdapter(descriptor) {
  const wallet = descriptor.provider;
  if (!supportsLegacyTransactions(wallet)) {
    throw adapterError(
      `${descriptor.name} does not support legacy Solana transactions`,
      'provider_incompatible',
    );
  }

  let account = null;
  let storageAddress = '';
  const signTransactionFeature = wallet?.features?.['solana:signTransaction'];
  const canSignLegacy = typeof signTransactionFeature?.signTransaction === 'function'
    && Array.from(signTransactionFeature.supportedTransactionVersions || []).includes('legacy');

  const feature = (name, method) => {
    const implementation = wallet?.features?.[name];
    if (!implementation?.[method]) {
      throw adapterError(`${descriptor.name} does not provide ${name}`, 'provider_unavailable');
    }
    return implementation;
  };

  const selectDevnetAccount = (accounts = []) => {
    const selected = accounts.find((item) => item.chains?.includes(DEVNET));
    if (!selected) {
      throw adapterError('No Solana Devnet account was authorized', 'provider_unavailable');
    }
    account = selected;
    return selected;
  };

  const connectStandard = async ({ silent = false } = {}) => {
    const output = await feature('standard:connect', 'connect').connect({ silent });
    return selectDevnetAccount(output?.accounts);
  };

  const requireAccount = () => {
    if (!account) throw adapterError('Connect the Solana wallet first', 'provider_unavailable');
    return account;
  };

  const daaProvider = {
    name: descriptor.name,
    get publicKey() {
      return account ? new PublicKey(account.publicKey) : null;
    },
    async connect(options = {}) {
      const selected = account || await connectStandard({ silent: Boolean(options.onlyIfTrusted) });
      return { publicKey: new PublicKey(selected.publicKey) };
    },
    async signMessage(message) {
      const [output] = await feature('solana:signMessage', 'signMessage').signMessage({
        account: requireAccount(),
        message,
      });
      if (!output?.signature) {
        throw adapterError('Wallet did not return a message signature', 'provider_unavailable');
      }
      return { signature: output.signature, signedMessage: output.signedMessage };
    },
    ...(canSignLegacy ? {
      async signTransaction(transaction) {
        const serialized = transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
        const [output] = await signTransactionFeature.signTransaction({
          account: requireAccount(),
          chain: DEVNET,
          transaction: serialized,
        });
        if (!(output?.signedTransaction instanceof Uint8Array)) {
          throw adapterError('Wallet did not return a signed transaction', 'provider_unavailable');
        }
        return { signedTransaction: output.signedTransaction };
      },
    } : {}),
    async signAndSendTransaction(transaction) {
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const [output] = await feature(
        'solana:signAndSendTransaction',
        'signAndSendTransaction',
      ).signAndSendTransaction({
        account: requireAccount(),
        chain: DEVNET,
        transaction: serialized,
        options: { commitment: 'confirmed' },
      });
      if (!output?.signature) {
        throw adapterError('Wallet did not return a transaction signature', 'provider_unavailable');
      }
      return { signature: bs58.encode(output.signature) };
    },
  };

  const sessionFor = (selected, derivedAddress = storageAddress) => ({
    chain: 'solana',
    walletId: descriptor.id,
    walletName: descriptor.name,
    sourceAddress: selected.address,
    sourceNetwork: 'devnet',
    storageAddress: derivedAddress,
    mode: 'daa',
  });

  return {
    daaProvider: () => daaProvider,
    setStorageAddress(value) {
      storageAddress = String(value || '');
    },
    async connect({ silent = false } = {}) {
      return sessionFor(await connectStandard({ silent }));
    },
    subscribe(listener) {
      return feature('standard:events', 'on').on('change', ({ accounts }) => {
        if (!accounts?.length) {
          account = null;
          storageAddress = '';
          listener({ session: null, status: 'disconnected' });
          return;
        }
        try {
          const selected = selectDevnetAccount(accounts);
          storageAddress = '';
          listener({ session: sessionFor(selected, ''), status: 'identity_required' });
        } catch (error) {
          listener({ session: null, status: 'disconnected', error: error.message });
        }
      });
    },
    async disconnect() {
      await wallet.features?.['standard:disconnect']?.disconnect?.();
      account = null;
      storageAddress = '';
    },
  };
}

export function createSolanaDaaAdapter({ descriptor, daaClient }) {
  const standard = createSolanaAdapter(descriptor);
  let derivation = 0;

  const deriveSession = async (session) => {
    const result = await daaClient.connect(standard.daaProvider());
    if (result.solana !== session.sourceAddress || !result.storageAccount) {
      throw adapterError('Derived storage identity does not match the selected wallet', 'identity_mismatch');
    }
    standard.setStorageAddress(result.storageAccount);
    return {
      ...session,
      sourceNetwork: 'devnet',
      storageAddress: result.storageAccount,
    };
  };

  return {
    daaProvider: standard.daaProvider,
    async connect(options = {}) {
      const session = await standard.connect(options);
      return deriveSession(session);
    },
    subscribe(listener) {
      return standard.subscribe((event) => {
        if (!event.session) {
          derivation += 1;
          daaClient.clearProvider();
          listener(event);
          return;
        }
        const current = ++derivation;
        daaClient.clearProvider();
        listener({ ...event, status: 'identity_required' });
        void deriveSession(event.session).then((session) => {
          if (current === derivation) listener({ session, status: 'ready', error: '' });
        }).catch((error) => {
          if (current === derivation) {
            listener({ session: null, status: 'disconnected', error: error.message });
          }
        });
      });
    },
    async disconnect() {
      derivation += 1;
      await standard.disconnect();
      daaClient.clearProvider();
    },
  };
}
