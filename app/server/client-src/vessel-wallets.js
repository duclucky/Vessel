import { getWallets } from '@wallet-standard/app';
import { applyFamilyCapabilities, createWalletRegistry } from './wallets/registry.js';
import { createWalletController } from './wallets/session.js';
import { createAptosAdapter } from './wallets/aptos-adapter.js';
import { submitAptosContractSettlement } from './wallets/aptos-contract-settlement.js';
import { resumeNativeBlobWrite, uploadNativeAptos } from './wallets/aptos-upload.js';
import { createUploadRouter } from './wallets/upload-router.js';
import { createSolanaDaaAdapter } from './wallets/solana-adapter.js';
import { reconcileArtifacts } from './wallets/artifact-reconciler.js';

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
    const [wallets, publicConfig] = await Promise.all([
      discoveredRegistry.scan(),
      window.VesselSolana.loadConfig(),
    ]);
    return applyFamilyCapabilities(wallets, publicConfig.walletFamilies).map((wallet) => {
      if (wallet.chain === 'aptos' && wallet.enabled) {
        adapters.set(wallet.id, (descriptor) => createAptosAdapter(descriptor));
        return wallet;
      }
      if (wallet.chain === 'solana' && wallet.enabled) {
        adapters.set(wallet.id, (descriptor) => createSolanaDaaAdapter({
          descriptor,
          daaClient: window.VesselSolana,
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
      quoteToken: context.quoteToken,
      paidAuthorization: context.paidAuthorization,
      expirationMicros: context.expirationMicros,
      expectedFileHash: context.expectedFileHash,
      paymentTier: context.paymentTier,
      uploadContext: context.uploadContext,
      contractQuote: context.contractQuote,
      contractSignature: context.contractSignature,
      onStep: context.onStep,
      onCheckpoint: context.onCheckpoint,
    });
  },
});
const { getActiveAdapter: _getActiveAdapter, ...publicController } = controller;

window.VesselWallets = {
  ...publicController,
  getActiveAptosAdapter() {
    const session = controller.getState().session;
    return session?.chain === 'aptos' ? controller.getActiveAdapter() : null;
  },
  getAptosSettlementClient(deployment) {
    return {
      submit: ({ contractQuote, contractSignature }) => submitAptosContractSettlement({
        adapter: controller.getActiveAdapter(),
        session: controller.getState().session,
        deployment,
        contractQuote,
        contractSignature,
      }),
    };
  },
  getSolanaSettlementClient(deployment) {
    return {
      submit: ({ contractQuote, contractSignature }) => window.VesselSolana.submitContractSettlement({
        deployment,
        contractQuote,
        contractSignature,
      }),
    };
  },
  async listArtifacts() {
    const session = controller.getState().session;
    if (!session?.storageAddress) return [];
    const response = await fetch(`/api/shelby/artifacts?account=${encodeURIComponent(session.storageAddress)}`);
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || 'Unable to load Shelby artifacts');
    return Array.isArray(json.items) ? json.items : [];
  },
  reconcileArtifacts(local, remote) {
    return reconcileArtifacts(local, remote, controller.getState().session || {});
  },
  async resumeBlobWrite(file, record) {
    const session = controller.getState().session;
    if (!session || session.storageAddress.toLowerCase() !== record.context.storageAddress.toLowerCase()) {
      throw new Error('Reconnect the wallet that owns this recovery record');
    }
    if (session.chain === 'aptos') {
      return resumeNativeBlobWrite(file, {
        session,
        expectedFileHash: record.context.fileHash,
        blobName: record.context.blobName,
        quoteToken: record.quoteToken,
        paidAuthorization: record.paidAuthorization,
        uploadContext: record.context,
        contractQuote: record.contractQuote,
        contractSignature: record.contractSignature,
      });
    }
    return window.VesselSolana.resumeBlobWrite(file, {
      expectedFileHash: record.context.fileHash,
      blobName: record.context.blobName,
      quoteToken: record.quoteToken,
      paidAuthorization: record.paidAuthorization,
      uploadContext: record.context,
      contractQuote: record.contractQuote,
      contractSignature: record.contractSignature,
    });
  },
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
