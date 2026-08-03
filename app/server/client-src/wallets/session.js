const KEYS = {
  id: 'vessel.wallet.id',
  chain: 'vessel.wallet.chain',
};

export function createWalletController({ registry, resolveAdapter, storage }) {
  let state = { status: 'disconnected', wallets: [], session: null, error: '' };
  let activeAdapter = null;
  let offAdapter = null;
  const listeners = new Set();

  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  };

  const scan = async () => {
    const statusBeforeScan = state.status;
    publish({ status: 'scanning' });
    const wallets = await registry.scan();
    const status = statusBeforeScan === 'network_required'
      ? 'network_required'
      : state.session ? 'ready' : 'disconnected';
    publish({ wallets, status });
    return wallets;
  };

  const disconnect = async () => {
    offAdapter?.();
    offAdapter = null;
    const adapter = activeAdapter;
    activeAdapter = null;
    try {
      await adapter?.disconnect?.();
    } catch {
      // App logout must still complete when an extension has already removed its session.
    } finally {
      storage.removeItem(KEYS.id);
      storage.removeItem(KEYS.chain);
      publish({ status: 'disconnected', session: null, error: '' });
    }
  };

  const connect = async (walletId, { silent = false } = {}) => {
    const descriptor = state.wallets.find((wallet) => wallet.id === walletId);
    if (!descriptor?.enabled) throw new Error('Wallet is not available for connection');
    publish({ status: 'connecting', error: '' });

    try {
      activeAdapter = resolveAdapter(descriptor);
      const session = await activeAdapter.connect({ silent });
      if (!session) {
        publish({ status: 'disconnected', session: null });
        return null;
      }

      storage.setItem(KEYS.id, descriptor.id);
      storage.setItem(KEYS.chain, descriptor.chain);
      offAdapter?.();
      offAdapter = activeAdapter.subscribe((event) => {
        if (event?.status === 'network_required') {
          publish({
            status: 'network_required',
            session: event.session || state.session,
            error: event.error || '',
          });
          return;
        }
        if (event?.session) {
          publish({ session: event.session, status: 'ready', error: '' });
          return;
        }
        void disconnect();
      });
      publish({ session, status: 'ready', error: '' });
      return session;
    } catch (error) {
      const networkRequired = ['wrong_network', 'switch_unsupported'].includes(error?.code);
      publish({
        status: networkRequired ? 'network_required' : 'error',
        session: null,
        error: error?.message || String(error),
      });
      throw error;
    }
  };

  const restore = async () => {
    await scan();
    const id = storage.getItem(KEYS.id);
    if (!id) return null;
    try {
      return await connect(id, { silent: true });
    } catch {
      if (state.status !== 'network_required') {
        publish({ status: 'disconnected', session: null, error: '' });
      }
      return null;
    }
  };

  return {
    scan,
    connect,
    restore,
    disconnect,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
