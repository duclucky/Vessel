import { getWallets } from '@wallet-standard/app';
import { createWalletRegistry } from './wallets/registry.js';

const standardSource = getWallets();
const aptosSource = {
  // Aptos Wallet Standard uses the same registry. Capability filtering belongs to our registry.
  get: standardSource.get.bind(standardSource),
  on: standardSource.on.bind(standardSource),
};
const registry = createWalletRegistry({ aptosSource, standardSource, eventTarget: window });
const registeredAdapterIds = new Set();
const listeners = new Set();
let state = { status: 'disconnected', session: null, wallets: [], error: '' };

const publish = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
};

const scan = async () => {
  const wallets = (await registry.scan()).map((wallet) => {
    if (wallet.chain === 'evm' || registeredAdapterIds.has(wallet.id)) return wallet;
    return { ...wallet, enabled: false, status: 'unavailable' };
  });
  publish({ wallets });
  return wallets;
};

registry.subscribe(() => void scan());

const notReady = () => {
  throw new Error('Vessel wallet controller is not initialized');
};

window.VesselWallets = {
  scan,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState: () => state,
  connect: notReady,
  restore: async () => null,
  disconnect: async () => {},
  open: () => window.dispatchEvent(new CustomEvent('vessel:wallet-open')),
};
