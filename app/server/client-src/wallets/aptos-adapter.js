const TESTNET = { name: 'testnet', chainId: 2 };

const walletError = (message, code) => Object.assign(new Error(message), { code });

export function normalizeAptosError(error, walletName = 'Aptos wallet') {
  if (error?.code) return error;
  const raw = String(error?.message || error || '');
  if (/reject|declin|cancel/i.test(raw)) {
    return walletError('Wallet request was rejected', 'user_rejected');
  }
  if (/PetraApiError/i.test(raw) || (walletName === 'Petra' && !raw.trim())) {
    return walletError('Petra could not connect. Unlock Petra and try again.', 'provider_unavailable');
  }
  return walletError(raw.trim() || `${walletName} could not connect`, 'provider_unavailable');
}

const approvedArgs = (response, code = 'user_rejected') => {
  if (response?.status !== 'Approved') {
    throw walletError('Wallet request was rejected', code);
  }
  return response.args;
};

const addressOf = (account) => account?.address?.toString?.() || String(account?.address || '');

const isTestnet = (network) => (
  String(network?.name || '').toLowerCase() === TESTNET.name
  && Number(network?.chainId) === TESTNET.chainId
);

export function createAptosAdapter(descriptor) {
  const wallet = descriptor.provider;
  const listeners = new Set();
  let session = null;
  let eventsBound = false;

  const feature = (name, method, { optional = false } = {}) => {
    const implementation = wallet?.features?.[name];
    if (implementation?.[method]) return implementation;
    if (optional) return null;
    throw walletError(`${descriptor.name} does not provide ${name}`, 'provider_unavailable');
  };

  const emit = (event) => listeners.forEach((listener) => listener(event));

  const buildSession = (account) => {
    const address = addressOf(account);
    if (!address) throw walletError('Aptos wallet did not return an account', 'provider_unavailable');
    return {
      chain: 'aptos',
      walletId: descriptor.id,
      walletName: descriptor.name,
      sourceAddress: address,
      sourceNetwork: 'testnet',
      storageAddress: address,
      mode: 'native',
    };
  };

  const ensureNetwork = async () => {
    const current = await feature('aptos:network', 'network').network();
    if (isTestnet(current)) return current;

    const changer = feature('aptos:changeNetwork', 'changeNetwork', { optional: true });
    if (!changer) {
      throw walletError('Switch your wallet to Aptos Testnet', 'switch_unsupported');
    }
    const changed = approvedArgs(await changer.changeNetwork(TESTNET), 'wrong_network');
    if (!changed?.success) {
      throw walletError(changed?.reason || 'Unable to switch network', 'wrong_network');
    }
    return TESTNET;
  };

  const bindEvents = () => {
    if (eventsBound) return;
    eventsBound = true;
    const accountEvents = feature('aptos:onAccountChange', 'onAccountChange');
    const networkEvents = feature('aptos:onNetworkChange', 'onNetworkChange');
    void accountEvents.onAccountChange((account) => {
      try {
        session = buildSession(account);
        emit({ session, status: 'ready' });
      } catch (error) {
        session = null;
        emit({ session: null, status: 'disconnected', error: error.message });
      }
    });
    void networkEvents.onNetworkChange((network) => {
      if (!isTestnet(network)) {
        emit({ session, status: 'network_required', error: 'Switch your wallet to Aptos Testnet' });
        return;
      }
      emit({ session, status: session ? 'ready' : 'disconnected', error: '' });
    });
  };

  return {
    async connect({ silent = false } = {}) {
      try {
        const account = approvedArgs(
          await feature('aptos:connect', 'connect').connect(silent),
        );
        session = buildSession(account);
        try {
          await ensureNetwork();
        } catch (error) {
          error.session = session;
          throw error;
        }
        return session;
      } catch (error) {
        const normalized = normalizeAptosError(error, descriptor.name);
        if (error?.session) normalized.session = error.session;
        throw normalized;
      }
    },
    ensureNetwork,
    async signAndSubmitTransaction({ data }) {
      return approvedArgs(
        await feature('aptos:signAndSubmitTransaction', 'signAndSubmitTransaction')
          .signAndSubmitTransaction({ payload: data }),
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      bindEvents();
      return () => listeners.delete(listener);
    },
    async disconnect() {
      await feature('aptos:disconnect', 'disconnect').disconnect();
      session = null;
    },
  };
}
