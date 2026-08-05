import { Network } from '@aptos-labs/ts-sdk';

export const SHELBY_PROTOCOL_MODULE =
  '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a';

const RUNTIMES = Object.freeze({
  testnet: Object.freeze({
    name: 'testnet',
    displayName: 'Aptos Testnet',
    status: 'maintenance',
    enabled: false,
    aptosNetwork: Network.TESTNET,
    chainId: 2,
    rpcBaseUrl: 'https://api.testnet.shelby.xyz/shelby',
    fullnodeUrl: 'https://api.testnet.aptoslabs.com/v1',
    indexerUrl: 'https://api.testnet.aptoslabs.com/v1/graphql',
    storageNetworkLabel: 'shelby-testnet',
    sourceNetworkLabel: 'aptos-testnet',
  }),
  shelbynet: Object.freeze({
    name: 'shelbynet',
    displayName: 'ShelbyNet',
    status: 'live',
    enabled: true,
    aptosNetwork: Network.SHELBYNET,
    chainId: 118,
    rpcBaseUrl: 'https://api.shelbynet.shelby.xyz/shelby',
    fullnodeUrl: 'https://api.shelbynet.shelby.xyz/v1',
    indexerUrl: 'https://api.shelbynet.shelby.xyz/v1/graphql',
    storageNetworkLabel: 'shelbynet',
    sourceNetworkLabel: 'shelbynet',
  }),
});

export function resolveShelbyNetwork(name = 'testnet') {
  const key = String(name || 'testnet').toLowerCase();
  const runtime = RUNTIMES[key];
  if (!runtime) throw new Error(`Unsupported Shelby network: ${name}`);
  return runtime;
}

export function resolveShelbyKeys(env = process.env) {
  const legacyApiKey = env.SHELBY_API_KEY || '';
  return Object.freeze({
    legacyApiKey,
    rpcApiKey: env.SHELBY_RPC_API_KEY || legacyApiKey,
    indexerApiKey: env.SHELBY_INDEXER_API_KEY || legacyApiKey,
    aptosApiKey: env.SHELBY_APTOS_API_KEY || legacyApiKey,
  });
}

export function publicNetworkDescriptor(runtime) {
  return Object.freeze({
    active: runtime.name,
    displayName: runtime.displayName,
    status: runtime.status,
    chainId: runtime.chainId,
    storageNetwork: runtime.name,
    aptos: { name: runtime.aptosNetwork, chainId: runtime.chainId },
    options: [
      { name: 'testnet', displayName: 'Aptos Testnet', status: 'maintenance', enabled: false },
      { name: 'shelbynet', displayName: 'ShelbyNet', status: 'live', enabled: true },
    ],
  });
}
