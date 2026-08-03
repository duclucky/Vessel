const SOLANA_REQUIRED = [
  'standard:connect',
  'standard:events',
  'solana:signMessage',
  'solana:signAndSendTransaction',
];

const APTOS_REQUIRED = [
  'aptos:connect',
  'aptos:disconnect',
  'aptos:network',
  'aptos:onAccountChange',
  'aptos:onNetworkChange',
  'aptos:signAndSubmitTransaction',
];

const hasAll = (wallet, names) => names.every((name) => name in (wallet.features || {}));
const supportsLegacy = (wallet) => {
  const versions = wallet.features?.['solana:signAndSendTransaction']
    ?.supportedTransactionVersions;
  return versions != null && Array.from(versions).includes('legacy');
};
const idFor = (chain, wallet) => `${chain}:${wallet.name}:${wallet.version || '1'}`.toLowerCase();

export function applyFamilyCapabilities(wallets, families = {}) {
  return wallets.map((wallet) => {
    if (wallet.chain === 'evm') return wallet;
    if (!families[wallet.chain]) {
      return { ...wallet, enabled: false, status: 'unavailable' };
    }
    return wallet;
  });
}

export function createWalletRegistry({ aptosSource, standardSource, eventTarget }) {
  const evm = new Map();
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());

  const announce = (event) => {
    const { info, provider } = event.detail || {};
    if (!info?.uuid || !provider) return;
    evm.set(info.uuid, { info, provider });
    notify();
  };

  eventTarget.addEventListener('eip6963:announceProvider', announce);
  eventTarget.dispatchEvent(new Event('eip6963:requestProvider'));

  const scan = async () => {
    const aptos = aptosSource.get()
      .filter((wallet) => hasAll(wallet, APTOS_REQUIRED))
      .map((wallet) => ({
        id: idFor('aptos', wallet),
        name: wallet.name,
        icon: wallet.icon,
        chain: 'aptos',
        installed: true,
        enabled: true,
        status: 'ready',
        capabilities: [...APTOS_REQUIRED],
        provider: wallet,
      }));

    const solana = standardSource.get()
      .filter((wallet) => wallet.chains?.some((chain) => String(chain).startsWith('solana:')))
      .map((wallet) => {
        const enabled = hasAll(wallet, SOLANA_REQUIRED) && supportsLegacy(wallet);
        return {
          id: idFor('solana', wallet),
          name: wallet.name,
          icon: wallet.icon,
          chain: 'solana',
          installed: true,
          enabled,
          status: enabled ? 'ready' : 'incompatible',
          capabilities: SOLANA_REQUIRED.filter((name) => name in (wallet.features || {})),
          provider: wallet,
        };
      });

    const ethereum = [...evm.values()].map(({ info, provider }) => ({
      id: `evm:${info.uuid}`,
      name: info.name,
      icon: info.icon,
      chain: 'evm',
      installed: true,
      enabled: false,
      status: 'beta',
      capabilities: [],
      provider,
    }));

    return [...aptos, ...solana, ...ethereum].filter(
      (row, index, all) => all.findIndex((item) => item.id === row.id) === index,
    );
  };

  const offAptos = aptosSource.on('register', notify);
  const offStandard = standardSource.on('register', notify);

  return {
    scan,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      offAptos?.();
      offStandard?.();
      eventTarget.removeEventListener('eip6963:announceProvider', announce);
      listeners.clear();
    },
  };
}
