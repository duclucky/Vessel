const DEFAULT_TARGET_NETWORK = Object.freeze({
  name: 'testnet',
  chainId: 2,
  displayName: 'Aptos Testnet',
});

const walletError = (message, code) => Object.assign(new Error(message), { code });

function normalizeTargetNetwork(input = DEFAULT_TARGET_NETWORK) {
  const name = String(input?.name || DEFAULT_TARGET_NETWORK.name).toLowerCase();
  const chainId = Number(input?.chainId || DEFAULT_TARGET_NETWORK.chainId);
  const displayName = input?.displayName || (name === 'shelbynet' ? 'ShelbyNet' : DEFAULT_TARGET_NETWORK.displayName);
  return Object.freeze({ name, chainId, displayName });
}

export function normalizeAptosError(error, walletName = 'Aptos wallet', targetNetwork = DEFAULT_TARGET_NETWORK) {
  const target = normalizeTargetNetwork(targetNetwork);
  const raw = String(error?.message || error || '');
  if (['user_rejected', 'wrong_network', 'switch_unsupported', 'provider_unavailable']
    .includes(error?.code)) return error;
  if (error?.session) {
    return walletError(`Switch your wallet to ${target.displayName}`, 'wrong_network');
  }
  if (/PetraApiError/i.test(raw) || (walletName === 'Petra' && !raw.trim())) {
    return walletError('Petra could not connect. Unlock Petra and try again.', 'provider_unavailable');
  }
  if (/reject|declin|cancel/i.test(raw)) {
    return walletError('Wallet request was rejected', 'user_rejected');
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

const isTargetNetwork = (network, target) => {
  const name = String(network?.name || '').toLowerCase();
  const chainId = Number(network?.chainId);
  if (target.name === 'shelbynet') {
    return chainId === target.chainId || name.includes('shelby');
  }
  return name === target.name && chainId === target.chainId;
};

export function createAptosAdapter(descriptor, { targetNetwork: targetNetworkInput } = {}) {
  const wallet = descriptor.provider;
  const targetNetwork = normalizeTargetNetwork(targetNetworkInput);
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
      sourceNetwork: targetNetwork.name,
      storageAddress: address,
      mode: 'native',
    };
  };

  const ensureNetwork = async () => {
    const current = await feature('aptos:network', 'network').network();
    if (isTargetNetwork(current, targetNetwork)) return current;

    const changer = feature('aptos:changeNetwork', 'changeNetwork', { optional: true });
    if (!changer) {
      throw walletError(`Switch your wallet to ${targetNetwork.displayName}`, 'switch_unsupported');
    }
    const changed = approvedArgs(
      await changer.changeNetwork({ name: targetNetwork.name, chainId: targetNetwork.chainId }),
      'wrong_network',
    );
    if (!changed?.success) {
      throw walletError(changed?.reason || 'Unable to switch network', 'wrong_network');
    }
    return targetNetwork;
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
      if (!isTargetNetwork(network, targetNetwork)) {
        emit({ session, status: 'network_required', error: `Switch your wallet to ${targetNetwork.displayName}` });
        return;
      }
      emit({ session, status: session ? 'ready' : 'disconnected', error: '' });
    });
  };

  return {
    async connect({ silent = false } = {}) {
      try {
        const connector = feature('aptos:connect', 'connect');
        const account = approvedArgs(
          await (silent ? connector.connect(true) : connector.connect()),
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
        const normalized = normalizeAptosError(error, descriptor.name, targetNetwork);
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
