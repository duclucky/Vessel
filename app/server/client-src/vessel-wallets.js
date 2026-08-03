import { getWallets } from '@wallet-standard/app';
import { createWalletRegistry } from './wallets/registry.js';
import { createWalletController } from './wallets/session.js';

const standardSource = getWallets();
const aptosSource = {
  // Aptos Wallet Standard uses the same registry. Capability filtering belongs to our registry.
  get: standardSource.get.bind(standardSource),
  on: standardSource.on.bind(standardSource),
};
const discoveredRegistry = createWalletRegistry({
  aptosSource,
  standardSource,
  eventTarget: window,
});
const adapters = new Map();

const availableRegistry = {
  async scan() {
    return (await discoveredRegistry.scan()).map((wallet) => {
      if (wallet.chain === 'evm' || adapters.has(wallet.id)) return wallet;
      return { ...wallet, enabled: false, status: 'unavailable' };
    });
  },
  subscribe: discoveredRegistry.subscribe,
};

const controller = createWalletController({
  registry: availableRegistry,
  storage: window.localStorage,
  resolveAdapter(descriptor) {
    const createAdapter = adapters.get(descriptor.id);
    if (!createAdapter) {
      throw new Error(`Wallet adapter for ${descriptor.chain} is not active`);
    }
    return createAdapter(descriptor);
  },
});

window.VesselWallets = {
  ...controller,
  open: () => window.dispatchEvent(new CustomEvent('vessel:wallet-open')),
};
