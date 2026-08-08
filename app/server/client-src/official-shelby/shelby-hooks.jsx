import { useMemo } from 'react';
import {
  Network as SolanaNetwork,
  useStorageAccount as useSolanaStorageAccount,
} from '@shelby-protocol/solana-kit/react';
import {
  Network as EthereumNetwork,
  useStorageAccount as useEthereumStorageAccount,
} from '@shelby-protocol/ethereum-kit/react';
import { ShelbyClient } from '@shelby-protocol/sdk/browser';

function normalizeStorageSession({ chain, wallet, storage }) {
  const storageAddress = storage.storageAccountAddress?.toString() || '';
  if (!wallet || !storageAddress) return null;
  return Object.freeze({
    chain,
    mode: 'daa',
    storageNetwork: 'shelbynet',
    sourceAddress: wallet.account?.address?.toString?.() || wallet.account?.address || '',
    storageAddress,
    signTransaction: storage.signTransaction,
    submitTransaction: storage.submitTransaction,
    signAndSubmitTransaction: storage.signAndSubmitTransaction,
  });
}

export function useOfficialShelbyStorageAccounts({
  solanaWallet = null,
  ethereumWallet = null,
} = {}) {
  const client = useMemo(
    () => new ShelbyClient({ network: SolanaNetwork.SHELBYNET }),
    [],
  );

  const solana = useSolanaStorageAccount({
    client,
    wallet: solanaWallet,
  });
  const ethereum = useEthereumStorageAccount({
    client,
    wallet: ethereumWallet,
  });

  return useMemo(() => ({
    network: SolanaNetwork.SHELBYNET || EthereumNetwork.SHELBYNET,
    solana: normalizeStorageSession({
      chain: 'solana',
      wallet: solanaWallet,
      storage: solana,
    }),
    evm: normalizeStorageSession({
      chain: 'evm',
      wallet: ethereumWallet,
      storage: ethereum,
    }),
  }), [ethereum, ethereumWallet, solana, solanaWallet]);
}
