import { getWallets } from '@wallet-standard/app';
import { createWalletRegistry } from './wallets/registry.js';
import { createWalletController } from './wallets/session.js';
import { createAptosAdapter } from './wallets/aptos-adapter.js';
import { uploadNativeAptos } from './wallets/aptos-upload.js';
import { createUploadRouter } from './wallets/upload-router.js';
import { createSolanaAdapter } from './wallets/solana-adapter.js';

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
      if (wallet.chain === 'solana' && wallet.enabled) {
        adapters.set(wallet.id, (descriptor) => createSolanaAdapter(descriptor));
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

const uploadRouter = createUploadRouter({
  aptosUpload: (file, context) => uploadNativeAptos(file, {
    ...context,
    adapter: controller.getActiveAdapter(),
  }),
  solanaUpload: (file, context) => {
    if (!window.VesselSolana?.uploadSponsored) {
      throw new Error('Reconnect a supported Solana wallet before uploading');
    }
    return window.VesselSolana.uploadSponsored(file, {
      paymentId: context.paymentId,
      uploadToken: context.uploadToken,
      onStep: context.onStep,
    });
  },
});
const { getActiveAdapter: _getActiveAdapter, ...publicController } = controller;

window.VesselWallets = {
  ...publicController,
  upload(file, context = {}) {
    return uploadRouter.upload(file, {
      ...context,
      session: controller.getState().session,
    });
  },
  open: (opener) => window.dispatchEvent(new CustomEvent('vessel:wallet-open', {
    detail: { opener },
  })),
};
