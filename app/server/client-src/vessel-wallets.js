import { getWallets } from '@wallet-standard/app';
import { createWalletRegistry } from './wallets/registry.js';
import { createWalletController } from './wallets/session.js';
import { createPhantomCompatibilityAdapter } from './wallets/phantom-compat.js';
import { createAptosAdapter } from './wallets/aptos-adapter.js';

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
    adapters.clear();
    return (await discoveredRegistry.scan()).map((wallet) => {
      if (wallet.chain === 'aptos' && wallet.enabled) {
        adapters.set(wallet.id, (descriptor) => createAptosAdapter(descriptor));
        return wallet;
      }
      const phantomCompatible = wallet.chain === 'solana'
        && wallet.name.toLowerCase() === 'phantom'
        && wallet.enabled
        && window.VesselSolana?.available?.();
      if (phantomCompatible) {
        adapters.set(wallet.id, (descriptor) => createPhantomCompatibilityAdapter({
          descriptor,
          vesselSolana: window.VesselSolana,
        }));
        return wallet;
      }
      if (wallet.chain === 'evm') return wallet;
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
  open: (opener) => window.dispatchEvent(new CustomEvent('vessel:wallet-open', {
    detail: { opener },
  })),
};
