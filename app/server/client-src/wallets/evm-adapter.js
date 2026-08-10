import {
  EIP1193DerivedPublicKey,
  defaultEthereumAuthenticationFunction,
  signAptosTransactionWithEthereum as officialSignAptosTransactionWithEthereum,
} from '@aptos-labs/derived-wallet-ethereum';
import { getAddress } from 'ethers';
import { normalizeAptosAddress } from './aptos-address.js';

const SEPOLIA_HEX_CHAIN_ID = '0xaa36a7';
const SEPOLIA_DECIMAL_CHAIN_ID = 11155111;
const SHELBYNET_STORAGE_NETWORK = 'shelbynet';
const DEFAULT_WALLET_REQUEST_TIMEOUT_MS = 15_000;

const evmError = (message, code, details = {}) => Object.assign(
  new Error(message),
  { code, ...details },
);

function normalizeAddress(value) {
  const text = String(value || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(text)) {
    throw evmError('Ethereum wallet did not return an EVM address', 'provider_unavailable');
  }
  return text;
}

function defaultDomain() {
  return typeof window !== 'undefined'
    ? window.location.host
    : 'vessel.demo';
}

function deriveWithOfficialShelbyEthereumDaa({ ethereumAddress, domain }) {
  const derivedKey = new EIP1193DerivedPublicKey({
    domain,
    ethereumAddress,
    authenticationFunction: defaultEthereumAuthenticationFunction,
  });
  return derivedKey.authKey().derivedAddress().toString();
}

function approved(response) {
  return response?.status === 'Approved'
    || response?.status === 'APPROVED'
    || response?.status === 1;
}

async function withWalletTimeout(promise, ms, message) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(evmError(message, 'wallet_timeout'));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createEvmDaaAdapter({
  descriptor,
  domain = defaultDomain(),
  deriveStorageAddress = deriveWithOfficialShelbyEthereumDaa,
  signAptosTransactionWithEthereum = officialSignAptosTransactionWithEthereum,
  targetChainId = SEPOLIA_HEX_CHAIN_ID,
  officialShelby,
  walletRequestTimeoutMs = DEFAULT_WALLET_REQUEST_TIMEOUT_MS,
} = {}) {
  const provider = descriptor?.provider;
  if (!provider?.request) throw evmError('Select an EVM wallet before connecting', 'provider_unavailable');
  let session = null;
  const listeners = new Set();

  const publish = (event) => listeners.forEach((listener) => listener(event));

  const walletRequest = (args, message = 'Wallet did not respond. Unlock the extension and try again, or choose another Ethereum wallet.') => (
    withWalletTimeout(provider.request(args), walletRequestTimeoutMs, message)
  );

  async function requestAccounts({ silent = false } = {}) {
    const accounts = await walletRequest({ method: silent ? 'eth_accounts' : 'eth_requestAccounts' });
    const [account] = Array.isArray(accounts) ? accounts : [];
    if (!account) {
      if (silent) return null;
      throw evmError('No Ethereum account was authorized', 'provider_unavailable');
    }
    return normalizeAddress(account);
  }

  async function ensureNetwork() {
    const chainId = String(await walletRequest({ method: 'eth_chainId' })).toLowerCase();
    if (chainId === targetChainId) return true;
    try {
      await walletRequest(
        {
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }],
        },
        'Wallet did not respond to the Sepolia switch request. Unlock the extension and try again.',
      );
      return true;
    } catch (error) {
      throw evmError('Switch your EVM wallet to Sepolia', 'switch_unsupported', {
        session,
        cause: error,
      });
    }
  }

  async function connect({ silent = false } = {}) {
    const sourceAddress = await requestAccounts({ silent });
    if (!sourceAddress) return null;
    await ensureNetwork();
    let officialSession = null;
    if (officialShelby?.connectWallet) {
      try {
        officialSession = await withWalletTimeout(
          officialShelby.connectWallet({
            chain: 'evm',
            descriptor,
            wallet: {
              account: { address: sourceAddress },
              request: provider.request.bind(provider),
            },
          }),
          walletRequestTimeoutMs,
          'Official Shelby DAA derivation did not respond',
        );
      } catch (error) {
        if (error?.code !== 'wallet_timeout') throw error;
      }
    }
    const storageAddress = normalizeAptosAddress(
      officialSession?.storageAddress || deriveStorageAddress({ ethereumAddress: sourceAddress, domain }),
      'Shelby storage address',
    );
    if (officialSession && officialSession.sourceAddress !== sourceAddress) {
      throw evmError('Official Shelby storage identity does not match the selected wallet', 'identity_mismatch');
    }
    session = Object.freeze({
      walletId: descriptor.id,
      walletName: descriptor.name || 'EVM wallet',
      chain: 'evm',
      mode: 'daa',
      sourceNetwork: 'sepolia',
      storageNetwork: SHELBYNET_STORAGE_NETWORK,
      sourceAddress,
      storageAddress,
    });
    publish({ session });
    return session;
  }

  async function signAptosTransaction(rawTransaction) {
    if (!session?.sourceAddress) throw evmError('Connect an EVM wallet before signing', 'provider_unavailable');
    const accounts = await walletRequest({ method: 'eth_accounts' });
    const matchingAddress = Array.isArray(accounts)
      ? accounts.find((account) => String(account).toLowerCase() === session.sourceAddress)
      : null;
    if (!matchingAddress) {
      throw evmError('Reconnect the Ethereum account that owns this DAA', 'provider_unavailable');
    }
    const ethereumAddress = getAddress(matchingAddress);
    const signed = await signAptosTransactionWithEthereum({
      eip1193Provider: provider,
      ethereumAddress,
      authenticationFunction: defaultEthereumAuthenticationFunction,
      rawTransaction,
    });
    if (!approved(signed) || !signed.args) {
      throw evmError('User rejected the Ethereum DAA signature', 'user_rejected');
    }
    return signed.args;
  }

  async function signMessage(message) {
    if (!session?.sourceAddress) throw evmError('Connect an EVM wallet before signing', 'provider_unavailable');
    const signature = await walletRequest({
      method: 'personal_sign',
      params: [message, session.sourceAddress],
    });
    return {
      chain: 'evm',
      address: session.sourceAddress,
      message,
      signedMessage: message,
      signature: String(signature || ''),
    };
  }

  return Object.freeze({
    provider,
    connect,
    ensureNetwork,
    signAptosTransaction,
    signMessage,
    disconnect() {
      session = null;
      officialShelby?.disconnect?.();
      publish({ session: null });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export const EVM_SEPOLIA_CHAIN_ID = SEPOLIA_DECIMAL_CHAIN_ID;
