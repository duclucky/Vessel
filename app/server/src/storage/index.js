import { config } from '../config.js';
import { MockProvider } from './mock.js';
import { ShelbyProvider } from './shelby.js';

let provider = null;

/** Selects the backend by env. Falls back to mock if shelby is misconfigured. */
export function getStorageProvider() {
  if (provider) return provider;
  const base = config.publicBase;
  if (config.storageBackend === 'shelby') {
    try {
      provider = new ShelbyProvider({
        apiKey: config.shelbyApiKey,
        solanaSecretKey: config.shelbySolanaSecretKey,
        domain: config.daaDomain,
        publicBase: base,
      });
      console.log('[storage] backend = shelby (testnet, Solana-DAA), account =', provider.address.toString());
    } catch (e) {
      console.warn('[storage] shelby init failed, falling back to mock:', String(e?.message || e));
      provider = new MockProvider({ publicBase: base });
    }
  } else {
    provider = new MockProvider({ publicBase: base });
    console.log('[storage] backend = mock');
  }
  return provider;
}
