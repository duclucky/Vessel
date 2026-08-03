const notReady = () => {
  throw new Error('Vessel wallet controller is not initialized');
};

window.VesselWallets = {
  scan: async () => [],
  subscribe: () => () => {},
  getState: () => ({ status: 'disconnected', session: null, wallets: [] }),
  connect: notReady,
  restore: async () => null,
  disconnect: async () => {},
  open: () => window.dispatchEvent(new CustomEvent('vessel:wallet-open')),
};
