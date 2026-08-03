export function createPhantomCompatibilityAdapter({ descriptor, vesselSolana }) {
  return {
    async connect({ silent = false } = {}) {
      if (silent) return null;
      const result = await vesselSolana.connect();
      return {
        chain: 'solana',
        walletId: descriptor.id,
        walletName: descriptor.name,
        sourceAddress: result.solana,
        sourceNetwork: result.network || vesselSolana.network,
        storageAddress: result.storageAccount,
        mode: 'daa',
      };
    },
    async disconnect() {
      await vesselSolana.disconnect?.();
    },
    subscribe() {
      return () => {};
    },
  };
}
