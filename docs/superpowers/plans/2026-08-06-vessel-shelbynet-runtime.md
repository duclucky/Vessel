# Vessel ShelbyNet Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vessel run against ShelbyNet while preserving Aptos Testnet as a disabled maintenance environment that can be re-enabled later.

**Architecture:** Add one server-side network resolver and one client-visible network descriptor so Shelby SDK clients, Aptos clients, gas station, quote context, media URLs, and UI copy all derive from the active environment. Keep the existing Aptos Testnet deployment manifest intact, add ShelbyNet-aware manifest validation, and fail closed until a ShelbyNet Move settlement manifest exists.

**Tech Stack:** Node.js ESM, Express, Aptos TypeScript SDK, Shelby TypeScript SDK, Shelby Solana Kit, Aptos Gas Station Client, static HTML/CSS/JS, Node test runner, esbuild.

## Global Constraints

- Do not delete existing Aptos Testnet code, manifests, docs, or deployment references.
- Landing page must show `Aptos Testnet` as `Maintenance` and disabled.
- Landing page must show `ShelbyNet` as `Live` and enabled.
- Runtime must support `SHELBY_NETWORK=shelbynet`.
- ShelbyNet chain id is `118`; Aptos Testnet chain id is `2`.
- Shelby protocol module address is `0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a`.
- Gas station fee payer address is `0x0577497ffa319784c9cf53632316eb893c23d541e3ba0586e57bccc42e8f186d`.
- Do not expose API keys or private keys to browser bundles or committed files.
- Split server key variables: `SHELBY_RPC_API_KEY`, `SHELBY_INDEXER_API_KEY`, `SHELBY_APTOS_API_KEY`, fallback `SHELBY_API_KEY`.
- Solana settlement remains Solana Devnet.

---

## File structure

- Create `app/server/src/lib/shelby-network.js`: single source of truth for supported Shelby runtime networks, endpoints, chain ids, labels, env key selection, and public UI descriptors.
- Modify `app/server/src/config.js`: expose split Shelby API keys and resolved network config.
- Modify `app/server/src/index.js`: instantiate Aptos, ShelbyNodeClient, ShelbyUploadGateway, pricing, config route, media proxy, and settlement loader from the resolved network.
- Modify `app/server/src/storage/shelby.js`: use injected network config instead of hard-coded `Network.TESTNET` and testnet read URL.
- Modify `app/server/src/storage/index.js`: pass resolved network config and RPC key to `ShelbyProvider`.
- Modify `app/server/src/lib/sponsor.js`: support `shelbynet` in GasStationClient network selection.
- Modify `app/server/src/lib/settlement/deployments.js`: preserve testnet validation and add explicit ShelbyNet manifest validation.
- Create `app/server/deployments/vessel-settlement.shelbynet.pending.json`: disabled placeholder-free pending manifest is not needed; instead let config point to the existing testnet manifest until deployment. Do not add undeployed fake addresses.
- Modify `app/server/public/index.html`: add environment selector/cards and correct names/statuses.
- Modify shared public pages `identity.html`, `upload.html`, `gallery.html`, `metadata.html`, `latency.html`: update top status copy to ShelbyNet live beta without deleting testnet mentions where they describe maintenance.
- Modify `app/server/public/wallet-owned-upload.js`: derive `sourceNetwork` and `storageNetwork` labels from `/api/config`.
- Modify `app/server/client-src/wallets/aptos-adapter.js`: accept current Aptos network from config, including ShelbyNet chain id `118`.
- Modify generated bundles by running `npm run build:client`, never manual edits to `public/vessel-wallets.js` or `public/vessel-solana.js`.
- Add/modify tests under `app/server/test`.

---

### Task 1: Add Shelby runtime network resolver

**Files:**
- Create: `app/server/src/lib/shelby-network.js`
- Modify: `app/server/src/config.js`
- Test: `app/server/test/shelby-network.test.js`
- Test: `app/server/test/config.test.js`

**Interfaces:**
- Produces: `resolveShelbyNetwork(name: string): ShelbyRuntimeNetwork`
- Produces: `resolveShelbyKeys(env: object): { rpcApiKey: string, indexerApiKey: string, aptosApiKey: string, legacyApiKey: string }`
- Produces: `publicNetworkDescriptor(runtime): object`
- Consumes later: `config.shelbyRuntime`, `config.shelbyRpcApiKey`, `config.shelbyIndexerApiKey`, `config.shelbyAptosApiKey`

- [ ] **Step 1: Write failing resolver tests**

Create `app/server/test/shelby-network.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicNetworkDescriptor,
  resolveShelbyKeys,
  resolveShelbyNetwork,
} from '../src/lib/shelby-network.js';

test('resolves Aptos Testnet without deleting its runtime values', () => {
  const runtime = resolveShelbyNetwork('testnet');
  assert.equal(runtime.name, 'testnet');
  assert.equal(runtime.displayName, 'Aptos Testnet');
  assert.equal(runtime.status, 'maintenance');
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.chainId, 2);
  assert.equal(runtime.rpcBaseUrl, 'https://api.testnet.shelby.xyz/shelby');
  assert.equal(runtime.aptosNetwork, 'testnet');
});

test('resolves ShelbyNet as the live runtime', () => {
  const runtime = resolveShelbyNetwork('shelbynet');
  assert.equal(runtime.name, 'shelbynet');
  assert.equal(runtime.displayName, 'ShelbyNet');
  assert.equal(runtime.status, 'live');
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.chainId, 118);
  assert.equal(runtime.rpcBaseUrl, 'https://api.shelbynet.shelby.xyz/shelby');
  assert.equal(runtime.aptosNetwork, 'shelbynet');
});

test('unknown Shelby network fails closed', () => {
  assert.throws(() => resolveShelbyNetwork('devnet'), /Unsupported Shelby network/);
});

test('split Shelby keys fall back to legacy SHELBY_API_KEY', () => {
  const keys = resolveShelbyKeys({
    SHELBY_API_KEY: 'legacy',
    SHELBY_RPC_API_KEY: 'rpc',
    SHELBY_INDEXER_API_KEY: '',
  });
  assert.deepEqual(keys, {
    legacyApiKey: 'legacy',
    rpcApiKey: 'rpc',
    indexerApiKey: 'legacy',
    aptosApiKey: 'legacy',
  });
});

test('public descriptor contains no secret values', () => {
  const descriptor = publicNetworkDescriptor(resolveShelbyNetwork('shelbynet'));
  assert.deepEqual(descriptor, {
    active: 'shelbynet',
    displayName: 'ShelbyNet',
    status: 'live',
    chainId: 118,
    storageNetwork: 'shelbynet',
    aptos: { name: 'shelbynet', chainId: 118 },
    options: [
      { name: 'testnet', displayName: 'Aptos Testnet', status: 'maintenance', enabled: false },
      { name: 'shelbynet', displayName: 'ShelbyNet', status: 'live', enabled: true },
    ],
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd app/server
npm test -- shelby-network.test.js config.test.js
```

Expected: FAIL because `../src/lib/shelby-network.js` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `app/server/src/lib/shelby-network.js`:

```js
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
```

Modify `app/server/src/config.js` imports and config object:

```js
import {
  resolveShelbyKeys,
  resolveShelbyNetwork,
} from './lib/shelby-network.js';

const shelbyRuntime = resolveShelbyNetwork(process.env.SHELBY_NETWORK || 'testnet');
const shelbyKeys = resolveShelbyKeys(process.env);

export const config = {
  port: Number(process.env.PORT || 8787),
  publicBase: process.env.PUBLIC_BASE || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT || 8787}`),
  storageBackend: process.env.STORAGE_BACKEND || 'mock',
  network: shelbyRuntime.name,
  shelbyRuntime,
  shelbyApiKey: shelbyKeys.legacyApiKey,
  shelbyRpcApiKey: shelbyKeys.rpcApiKey,
  shelbyIndexerApiKey: shelbyKeys.indexerApiKey,
  shelbyAptosApiKey: shelbyKeys.aptosApiKey,
  shelbySolanaSecretKey: process.env.SHELBY_SOLANA_SECRET_KEY || '',
  daaDomain: process.env.DAPP_DOMAIN || 'vessel.demo',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  defaultStorageDays: Number(process.env.DEFAULT_STORAGE_DAYS || 30),
  ipfsGateway: process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/',
  ipfsCompareCid: process.env.IPFS_COMPARE_CID || '',
  solanaRpc: process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
  usdcMint: process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  walletAptosEnabled: process.env.WALLET_APTOS_ENABLED !== 'false',
  walletSolanaEnabled: process.env.WALLET_SOLANA_ENABLED !== 'false',
  gasStationAccount: process.env.GAS_STATION_ACCOUNT || '',
  gasStationApiKey: process.env.GAS_STATION_API_KEY || '',
  dynamicQuotesEnabled: process.env.DYNAMIC_QUOTES_ENABLED === 'true',
  settlementContractsEnabled: process.env.SETTLEMENT_CONTRACTS_ENABLED === 'true',
  settlementDeploymentsFile: resolveProjectFile(process.env.SETTLEMENT_DEPLOYMENTS_FILE || defaultSettlementDeploymentsFile),
  quoteSignerPrivateKeyBase64: process.env.QUOTE_SIGNER_PRIVATE_KEY_B64 || '',
  quoteSignerPublicKeyHex: process.env.QUOTE_SIGNER_PUBLIC_KEY_HEX || '',
  paySecret: process.env.PAY_SECRET || '',
  aptUsdReferenceMicros: BigInt(process.env.APT_USD_REFERENCE_MICROS || '5000000'),
  registerGasUnitsEstimate: BigInt(process.env.REGISTER_GAS_UNITS_ESTIMATE || '7000'),
  gasSafetyBps: BigInt(process.env.GAS_SAFETY_BPS || '12000'),
  telemetryWalletSalt: process.env.TELEMETRY_WALLET_SALT || process.env.PAY_SECRET || '',
};
```

Keep existing fields not shown here unchanged.

- [ ] **Step 4: Run tests to verify resolver passes**

Run:

```powershell
cd app/server
npm test -- shelby-network.test.js config.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add app/server/src/lib/shelby-network.js app/server/src/config.js app/server/test/shelby-network.test.js app/server/test/config.test.js
git commit -m "feat: add shelby runtime network resolver"
```

---

### Task 2: Route backend Shelby clients through the resolver

**Files:**
- Modify: `app/server/src/index.js`
- Modify: `app/server/src/storage/index.js`
- Modify: `app/server/src/storage/shelby.js`
- Modify: `app/server/src/lib/sponsor.js`
- Test: `app/server/test/sponsor.test.js`
- Test: `app/server/test/shelby-api-routes.test.js`
- Test: `app/server/test/aptos-upload.test.js`
- Test: `app/server/test/shelby-upload-gateway.test.js`

**Interfaces:**
- Consumes: `config.shelbyRuntime`, `config.shelbyRpcApiKey`, `config.shelbyIndexerApiKey`, `config.shelbyAptosApiKey`
- Produces: backend clients using selected Shelby environment

- [ ] **Step 1: Write failing tests for backend network routing**

Add to `app/server/test/sponsor.test.js`:

```js
test('SponsorManager maps shelbynet to Aptos SDK ShelbyNet', async () => {
  const constructed = [];
  class FakeGasStationClient {
    constructor(args) { constructed.push(args); }
    async signAndSubmitTransaction() { return { hash: '0xhash' }; }
  }
  new SponsorManager({
    gasStationApiKey: 'key',
    network: 'shelbynet',
    gasStationClientFactory: (args) => new FakeGasStationClient(args),
  });
  assert.equal(constructed[0].network, 'shelbynet');
});
```

If this constructor injection conflicts with the current test style, implement the same assertion by passing an injected `gasStationClient` and adding a pure exported `resolveGasStationNetwork(name)` function.

Add to `app/server/test/shelby-api-routes.test.js`:

```js
test('Shelby API routes use split server keys and resolved runtime', () => {
  const server = readFileSync('src/index.js', 'utf8');
  assert.match(server, /network:\s*config\.shelbyRuntime\.aptosNetwork/);
  assert.match(server, /apiKey:\s*config\.shelbyRpcApiKey/);
  assert.match(server, /Authorization: `Bearer \$\{config\.shelbyRpcApiKey\}`/);
  assert.doesNotMatch(server, /network:\s*Network\.TESTNET/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd app/server
npm test -- sponsor.test.js shelby-api-routes.test.js aptos-upload.test.js shelby-upload-gateway.test.js
```

Expected: FAIL on hard-coded `Network.TESTNET` and sponsor mapping.

- [ ] **Step 3: Update sponsor network mapping**

Modify `app/server/src/lib/sponsor.js`:

```js
export function resolveGasStationNetwork(network) {
  if (network === 'shelbynet') return Network.SHELBYNET;
  if (network === 'testnet') return Network.TESTNET;
  if (network === 'mainnet') return Network.MAINNET;
  throw new Error(`Unsupported gas station network: ${network}`);
}

export class SponsorManager {
  constructor({
    gasStationApiKey,
    network = 'testnet',
    gasStationClient,
    gasStationClientFactory,
    deserialize,
  } = {}) {
    if (!gasStationApiKey && !gasStationClient) {
      throw new Error('SponsorManager requires GAS_STATION_API_KEY');
    }
    const net = resolveGasStationNetwork(network);
    this.gs = gasStationClient
      || (gasStationClientFactory
        ? gasStationClientFactory({ network: net, apiKey: gasStationApiKey })
        : new GasStationClient({ network: net, apiKey: gasStationApiKey }));
    // keep existing deserializer code
  }
}
```

- [ ] **Step 4: Update Express Shelby client construction**

Modify `app/server/src/index.js`:

```js
const aptosClientConfig = config.shelbyAptosApiKey
  ? { API_KEY: config.shelbyAptosApiKey }
  : undefined;

const aptos = new Aptos(new AptosConfig({
  network: config.shelbyRuntime.aptosNetwork,
  clientConfig: aptosClientConfig,
}));

if (config.shelbyRpcApiKey) {
  shelbyClient = new ShelbyNodeClient({
    network: config.shelbyRuntime.aptosNetwork,
    apiKey: config.shelbyRpcApiKey,
    rpc: { baseUrl: config.shelbyRuntime.rpcBaseUrl },
    indexer: config.shelbyIndexerApiKey
      ? { apiKey: config.shelbyIndexerApiKey }
      : undefined,
  });
  shelbyGateway = new ShelbyUploadGateway({
    apiKey: config.shelbyRpcApiKey,
    rpcBaseUrl: config.shelbyRuntime.rpcBaseUrl,
    secret: config.paySecret,
  });
}
```

Replace media proxy header:

```js
const upstreamHeaders = { Authorization: `Bearer ${config.shelbyRpcApiKey}` };
```

Replace config route network block:

```js
network: config.network,
shelbyNetwork: publicNetworkDescriptor(config.shelbyRuntime),
```

Import `publicNetworkDescriptor` from `./lib/shelby-network.js`.

- [ ] **Step 5: Update storage provider construction**

Modify `app/server/src/storage/index.js` to pass runtime and RPC key:

```js
return new ShelbyProvider({
  apiKey: config.shelbyRpcApiKey,
  solanaSecretKey: config.shelbySolanaSecretKey,
  domain: config.daaDomain,
  publicBase: config.publicBase,
  runtime: config.shelbyRuntime,
});
```

Modify `app/server/src/storage/shelby.js` constructor:

```js
constructor({ apiKey, solanaSecretKey, domain = 'vessel.demo', publicBase, runtime }) {
  if (!solanaSecretKey) throw new Error('ShelbyProvider requires SHELBY_SOLANA_SECRET_KEY');
  this.apiKey = apiKey;
  this.publicBase = publicBase;
  this.domain = domain;
  const secret = Uint8Array.from(JSON.parse(solanaSecretKey));
  this.keypair = Keypair.fromSecretKey(secret);
  this.runtime = runtime;
  this.client = new Shelby({
    network: runtime.aptosNetwork,
    connection: new Connection('https://api.devnet.solana.com'),
    apiKey: apiKey || undefined,
  });
}
```

Modify `rawReadUrl()`:

```js
rawReadUrl(key) {
  return `${this.runtime.rpcBaseUrl}/v1/blobs/${this.address.toString()}/${key}`;
}
```

Modify `health()` response:

```js
return {
  ok: apt >= 10_000_000,
  network: this.runtime.name,
  chain: 'solana-DAA',
  account: this.address.toString(),
  solana: this.keypair.publicKey.toBase58(),
  aptOctas: apt,
};
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
cd app/server
npm test -- sponsor.test.js shelby-api-routes.test.js aptos-upload.test.js shelby-upload-gateway.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/server/src/index.js app/server/src/storage/index.js app/server/src/storage/shelby.js app/server/src/lib/sponsor.js app/server/test/sponsor.test.js app/server/test/shelby-api-routes.test.js app/server/test/aptos-upload.test.js app/server/test/shelby-upload-gateway.test.js
git commit -m "feat: route shelby clients by runtime network"
```

---

### Task 3: Make settlement deployment validation support ShelbyNet without deleting Testnet

**Files:**
- Modify: `app/server/src/lib/settlement/deployments.js`
- Modify: `app/server/src/lib/settlement/bundled-testnet-manifest.js`
- Test: `app/server/test/settlement-deployments.test.js`
- Test: `app/server/test/aptos-contract-receipt.test.js`

**Interfaces:**
- Consumes: `loadSettlementDeployments({ expectedEnvironment, expectedChainId })`
- Produces: fail-closed manifest validation for both `testnet` and `shelbynet`

- [ ] **Step 1: Write failing tests**

Add to `app/server/test/settlement-deployments.test.js`:

```js
test('ShelbyNet manifest is accepted only with environment shelbynet and chain id 118', () => {
  const manifest = {
    schemaVersion: 1,
    environment: 'shelbynet',
    quotePublicKey: key(1),
    configVersion: '1',
    aptos: {
      chainId: 118,
      moduleAddress: `0x${'11'.repeat(32)}`,
      vaultAddress: `0x${'22'.repeat(32)}`,
      multisigAddress: `0x${'33'.repeat(32)}`,
      acceptedAsset: '0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1',
      deploymentTransaction: `0x${'44'.repeat(32)}`,
      timelockSeconds: null,
    },
    solana: baseManifest.solana,
  };
  writeFileSync('tmp-shelbynet-manifest.json', JSON.stringify(manifest));
  const loaded = loadSettlementDeployments({
    file: 'tmp-shelbynet-manifest.json',
    quotePublicKey: key(1),
    expectedEnvironment: 'shelbynet',
    expectedChainId: 118,
  });
  assert.equal(loaded.environment, 'shelbynet');
  assert.equal(loaded.aptos.chainId, 118);
});

test('ShelbyNet runtime rejects a Testnet settlement manifest', () => {
  assert.throws(() => loadSettlementDeployments({
    file: 'deployments/vessel-settlement.testnet.json',
    quotePublicKey: bundledTestnetManifest.quotePublicKey,
    expectedEnvironment: 'shelbynet',
    expectedChainId: 118,
  }), /must target shelbynet/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd app/server
npm test -- settlement-deployments.test.js aptos-contract-receipt.test.js
```

Expected: FAIL because `expectedEnvironment` and `expectedChainId` are unsupported.

- [ ] **Step 3: Implement environment-aware validation**

Modify `loadSettlementDeployments()` signature:

```js
export function loadSettlementDeployments({
  file,
  quotePublicKey,
  enabled = true,
  environment = process.env.NODE_ENV || 'development',
  expectedEnvironment = 'testnet',
  expectedChainId = 2,
} = {}) {
```

Replace hard-coded manifest checks:

```js
if (manifest.schemaVersion !== 1 || manifest.environment !== expectedEnvironment) {
  throw deploymentError(`Settlement manifest must target ${expectedEnvironment}`);
}

if (manifest.aptos?.chainId !== expectedChainId) {
  throw deploymentError(`Aptos deployment must use chain ID ${expectedChainId}`);
}
```

Replace returned aptos object:

```js
const aptos = Object.freeze({
  chainId: expectedChainId,
  moduleAddress: requiredAptosAddress(manifest.aptos.moduleAddress, 'Aptos module address'),
  // existing fields unchanged
});
```

Replace returned environment:

```js
return Object.freeze({
  enabled: true,
  environment: expectedEnvironment,
  quotePublicKey: manifestQuoteKey,
  configVersion: configVersion.toString(),
  aptos,
  solana,
});
```

Modify `app/server/src/index.js` settlement loader call:

```js
settlementDeployments = loadSettlementDeployments({
  file: path.resolve(process.cwd(), config.settlementDeploymentsFile),
  quotePublicKey: config.quoteSignerPublicKeyHex,
  enabled: config.settlementContractsEnabled,
  environment: process.env.NODE_ENV || 'development',
  expectedEnvironment: config.shelbyRuntime.name,
  expectedChainId: config.shelbyRuntime.chainId,
});
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
cd app/server
npm test -- settlement-deployments.test.js aptos-contract-receipt.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add app/server/src/lib/settlement/deployments.js app/server/src/index.js app/server/test/settlement-deployments.test.js app/server/test/aptos-contract-receipt.test.js
git commit -m "feat: support shelbynet settlement manifests"
```

---

### Task 4: Update landing page and public network copy

**Files:**
- Modify: `app/server/public/index.html`
- Modify: `app/server/public/identity.html`
- Modify: `app/server/public/upload.html`
- Modify: `app/server/public/gallery.html`
- Modify: `app/server/public/metadata.html`
- Modify: `app/server/public/latency.html`
- Modify: `app/server/public/vessel.css`
- Test: `app/server/test/theme-and-landing.test.js`
- Test: `app/server/test/accessibility.test.js`
- Test: `app/server/test/upload.test.js`

**Interfaces:**
- Consumes: static environment labels from spec
- Produces: visible `Aptos Testnet` maintenance card and enabled `ShelbyNet` live route

- [ ] **Step 1: Write failing HTML tests**

Modify `app/server/test/theme-and-landing.test.js`:

```js
test('Landing exposes ShelbyNet live and Aptos Testnet maintenance environments', () => {
  const html = readPage('index.html');
  assert.match(html, /ShelbyNet/i);
  assert.match(html, /Live/i);
  assert.match(html, /Aptos Testnet/i);
  assert.match(html, /Maintenance/i);
  assert.match(html, /data-network-option="shelbynet"[\s\S]*href="\/identity\.html"/i);
  assert.match(html, /data-network-option="testnet"[\s\S]*aria-disabled="true"/i);
  assert.doesNotMatch(html, /Shelby Testnet/i);
});
```

Modify `app/server/test/accessibility.test.js` expected banner:

```js
assert.match(html, /Powered by Shelby · Live on ShelbyNet/i);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd app/server
npm test -- theme-and-landing.test.js accessibility.test.js upload.test.js
```

Expected: FAIL because pages still say Aptos Testnet live and lack network cards.

- [ ] **Step 3: Update landing network selector**

In `app/server/public/index.html`, replace the generic entry area with:

```html
<section class="vessel-page mt-10 grid gap-4 md:grid-cols-2" aria-label="Storage environments">
  <article data-network-option="testnet" class="vessel-network-card vessel-network-card-disabled">
    <div class="flex items-center justify-between gap-3">
      <h2 class="font-display text-2xl font-semibold text-on-surface">Aptos Testnet</h2>
      <span class="vessel-status vessel-status-maintenance">Maintenance</span>
    </div>
    <p class="mt-3 text-sm leading-6 text-on-surface-variant">Preserved for regression testing and future reactivation. Public writes are disabled in the current beta route.</p>
    <button class="vessel-button vessel-button-secondary mt-5 w-full opacity-50" type="button" disabled aria-disabled="true">Temporarily disabled</button>
  </article>
  <article data-network-option="shelbynet" class="vessel-network-card vessel-network-card-live">
    <div class="flex items-center justify-between gap-3">
      <h2 class="font-display text-2xl font-semibold text-on-surface">ShelbyNet</h2>
      <span class="vessel-status vessel-status-live">Live</span>
    </div>
    <p class="mt-3 text-sm leading-6 text-on-surface-variant">Live developer prototype for real wallet-owned hot-storage uploads. Artifacts remain ephemeral and can be wiped by the network.</p>
    <a class="vessel-button vessel-button-primary mt-5 w-full" data-dapp-entry href="/identity.html">Launch ShelbyNet app</a>
  </article>
</section>
```

Keep three `data-dapp-entry` links total by either converting only one existing CTA to this card or updating the existing test expectation.

- [ ] **Step 4: Update shared status copy**

For each public HTML page listed above, replace:

```text
Powered by Shelby · Live on Aptos Testnet
```

with:

```text
Powered by Shelby · Live on ShelbyNet
```

Replace footer copy:

```text
Capability demo · Shelby testnet · 2026
```

with:

```text
Capability demo · ShelbyNet live beta · 2026
```

In upload copy, replace `testnet USDC` with `Solana Devnet USDC` and `testnet artifacts expire` with `ShelbyNet artifacts expire`.

- [ ] **Step 5: Add small CSS utilities**

Append to `app/server/public/vessel.css`:

```css
.vessel-network-card {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 1.5rem;
  background: rgba(17, 24, 39, 0.72);
  padding: 1.25rem;
}
.vessel-network-card-live {
  box-shadow: 0 0 28px rgba(94, 234, 212, 0.16);
}
.vessel-network-card-disabled {
  filter: grayscale(0.35);
}
.vessel-status {
  border-radius: 999px;
  padding: 0.35rem 0.65rem;
  font-family: var(--font-technical);
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.vessel-status-live {
  color: rgb(94, 234, 212);
  background: rgba(94, 234, 212, 0.12);
}
.vessel-status-maintenance {
  color: rgb(203, 213, 225);
  background: rgba(148, 163, 184, 0.12);
}
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
cd app/server
npm test -- theme-and-landing.test.js accessibility.test.js upload.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/server/public/index.html app/server/public/identity.html app/server/public/upload.html app/server/public/gallery.html app/server/public/metadata.html app/server/public/latency.html app/server/public/vessel.css app/server/test/theme-and-landing.test.js app/server/test/accessibility.test.js app/server/test/upload.test.js
git commit -m "feat: present shelbynet as live environment"
```

---

### Task 5: Make wallet/upload context use active Shelby runtime

**Files:**
- Modify: `app/server/public/wallet-owned-upload.js`
- Modify: `app/server/client-src/wallets/aptos-adapter.js`
- Modify: `app/server/public/wallet-ui.js`
- Test: `app/server/test/aptos-adapter.test.js`
- Test: `app/server/test/wallet-owned-upload.test.js`
- Test: `app/server/test/wallet-ui.test.js`
- Generated by build: `app/server/public/vessel-wallets.js`

**Interfaces:**
- Consumes: `/api/config.shelbyNetwork`
- Produces: quote context labels `sourceNetwork` and `storageNetwork` derived from runtime
- Produces: Aptos wallet adapter that accepts ShelbyNet chain id `118`

- [ ] **Step 1: Write failing client tests**

Modify `app/server/test/aptos-adapter.test.js` to include ShelbyNet:

```js
test('ShelbyNet adapter accepts chain id 118 and labels the session', async () => {
  const provider = wallet({ network: { name: 'shelbynet', chainId: 118 } });
  const adapter = createAptosAdapter({ provider, targetNetwork: { name: 'shelbynet', chainId: 118 } });
  const session = await adapter.connect();
  assert.equal(session.sourceNetwork, 'shelbynet');
});
```

Modify `app/server/test/wallet-owned-upload.test.js`:

```js
test('upload context uses active ShelbyNet labels from config', async () => {
  const context = buildUploadContext({
    session: { chain: 'aptos', sourceAddress: `0x${'11'.repeat(32)}`, storageAccount: `0x${'22'.repeat(32)}` },
    file: new File(['x'], 'x.png', { type: 'image/png' }),
    days: 7,
    config: { shelbyNetwork: { active: 'shelbynet', storageNetwork: 'shelbynet' } },
  });
  assert.equal(context.sourceNetwork, 'shelbynet');
  assert.equal(context.storageNetwork, 'shelbynet');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd app/server
npm test -- aptos-adapter.test.js wallet-owned-upload.test.js wallet-ui.test.js
```

Expected: FAIL because adapter and upload context are still testnet-labeled.

- [ ] **Step 3: Update Aptos adapter target network**

Modify `app/server/client-src/wallets/aptos-adapter.js`:

```js
const DEFAULT_TARGET = { name: 'testnet', chainId: 2 };

export function createAptosAdapter({ provider, targetNetwork = DEFAULT_TARGET } = {}) {
  const target = targetNetwork || DEFAULT_TARGET;
  // use target.name and target.chainId instead of TESTNET
}
```

Replace wrong-network messages:

```js
const label = target.name === 'shelbynet' ? 'ShelbyNet' : 'Aptos Testnet';
return walletError(`Switch your wallet to ${label}`, 'wrong_network');
```

Return session:

```js
sourceNetwork: target.name,
```

- [ ] **Step 4: Pass target network from app config**

Where wallet registry/adapters are created, read:

```js
const aptosTargetNetwork = window.VESSEL_CONFIG?.shelbyNetwork?.aptos
  || { name: 'testnet', chainId: 2 };
```

Pass:

```js
createAptosAdapter({ provider, targetNetwork: aptosTargetNetwork });
```

- [ ] **Step 5: Update upload context builder**

In `app/server/public/wallet-owned-upload.js`, replace hard-coded labels:

```js
const shelbyNetwork = state.config?.shelbyNetwork || {};
const sourceNetwork = session.chain === 'aptos'
  ? (shelbyNetwork.aptos?.name || session.sourceNetwork || 'testnet')
  : 'solana-devnet';
const storageNetwork = shelbyNetwork.storageNetwork || 'testnet';
```

Keep Solana as `solana-devnet`.

- [ ] **Step 6: Build generated bundles**

Run:

```powershell
cd app/server
npm run build:client
```

Expected: generated bundles update successfully.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
cd app/server
npm test -- aptos-adapter.test.js wallet-owned-upload.test.js wallet-ui.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add app/server/client-src/wallets/aptos-adapter.js app/server/public/wallet-owned-upload.js app/server/public/wallet-ui.js app/server/public/vessel-wallets.js app/server/test/aptos-adapter.test.js app/server/test/wallet-owned-upload.test.js app/server/test/wallet-ui.test.js
git commit -m "feat: align wallet uploads with shelbynet runtime"
```

---

### Task 6: Add ShelbyNet smoke probes and run full verification

**Files:**
- Create: `app/server/scripts/shelbynet-smoke.mjs`
- Modify: `README.md`
- Test: `app/server/test/readme-current.test.js`

**Interfaces:**
- Consumes: local `.env`, no secrets printed
- Produces: read-only ShelbyNet environment check for deployment readiness

- [ ] **Step 1: Write failing smoke script test**

Add to `app/server/test/readme-current.test.js`:

```js
test('README documents ShelbyNet runtime and smoke command', () => {
  const readme = readFileSync('../../README.md', 'utf8');
  assert.match(readme, /ShelbyNet live beta/i);
  assert.match(readme, /SHELBY_NETWORK=shelbynet/);
  assert.match(readme, /node scripts\/shelbynet-smoke\.mjs/);
  assert.match(readme, /Aptos Testnet.*Maintenance/is);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd app/server
npm test -- readme-current.test.js
```

Expected: FAIL because README has not been updated.

- [ ] **Step 3: Add smoke script**

Create `app/server/scripts/shelbynet-smoke.mjs`:

```js
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { SHELBYUSD_FA_METADATA_ADDRESS } from '@shelby-protocol/sdk/node';
import { createShelbyPricingReader } from '../src/lib/shelby-pricing.js';

const feePayer = process.env.GAS_STATION_ACCOUNT || '';
const aptos = new Aptos(new AptosConfig({ network: Network.SHELBYNET }));
const ledger = await aptos.getLedgerInfo();
const pricing = await createShelbyPricingReader({ aptos, cacheMs: 0 }).read();
const out = {
  network: 'shelbynet',
  chainId: Number(ledger.chain_id),
  ledgerVersion: String(ledger.ledger_version),
  pricing: {
    tierId: pricing.tierId,
    epochDurationMicros: pricing.epochDurationMicros.toString(),
  },
};

if (feePayer) {
  out.feePayer = { address: feePayer };
  try {
    out.feePayer.aptOctas = String(await aptos.getAccountAPTAmount({ accountAddress: feePayer }));
  } catch (error) {
    out.feePayer.aptError = String(error?.message || error).slice(0, 160);
  }
  try {
    const rows = await aptos.getCurrentFungibleAssetBalances({
      options: {
        where: {
          owner_address: { _eq: feePayer },
          asset_type: { _eq: SHELBYUSD_FA_METADATA_ADDRESS },
        },
      },
    });
    out.feePayer.shelbyUsdUnits = String(rows?.[0]?.amount || 0);
  } catch (error) {
    out.feePayer.shelbyUsdError = String(error?.message || error).slice(0, 160);
  }
}

console.log(JSON.stringify(out, null, 2));
if (out.chainId !== 118) process.exitCode = 1;
```

- [ ] **Step 4: Update README**

Add a runtime section:

```markdown
## Runtime networks

The public beta now presents two storage environments:

- `Aptos Testnet`: preserved for regression testing and marked Maintenance in the landing page.
- `ShelbyNet`: live beta route for real ShelbyNet storage verification.

For ShelbyNet local runs:

```env
SHELBY_NETWORK=shelbynet
SHELBY_WRITES_ENABLED=true
GAS_STATION_ACCOUNT=0x0577497ffa319784c9cf53632316eb893c23d541e3ba0586e57bccc42e8f186d
```

Server-only secrets stay in `.env` and Vercel environment variables:

```env
SHELBY_RPC_API_KEY=<server-only ShelbyNet RPC key>
SHELBY_INDEXER_API_KEY=<server-only ShelbyNet indexer key>
SHELBY_APTOS_API_KEY=<server-only ShelbyNet Aptos key>
GAS_STATION_API_KEY=<server-only gas station key>
```

Run a read-only ShelbyNet check:

```powershell
cd app/server
node scripts/shelbynet-smoke.mjs
```
```

- [ ] **Step 5: Run full local verification**

Run:

```powershell
cd app/server
npm run check
node scripts/shelbynet-smoke.mjs
```

Expected:

- `npm run check`: PASS.
- smoke script prints JSON with `"network": "shelbynet"` and `"chainId": 118`.

- [ ] **Step 6: Commit**

```powershell
git add app/server/scripts/shelbynet-smoke.mjs README.md app/server/test/readme-current.test.js
git commit -m "docs: add shelbynet runtime verification"
```

---

## Final verification before deployment

- [ ] Run `git status --short` and confirm only expected files remain dirty.
- [ ] Run `cd app/server; npm run check`.
- [ ] Run `cd app/server; node scripts/shelbynet-smoke.mjs`.
- [ ] Start local server with `.env` set to `SHELBY_NETWORK=shelbynet`.
- [ ] Open `/` and confirm `Aptos Testnet` is Maintenance and disabled.
- [ ] Click ShelbyNet Live entry and confirm the dApp opens.
- [ ] Open `/api/config` and confirm:

```json
{
  "network": "shelbynet",
  "shelbyNetwork": {
    "active": "shelbynet",
    "displayName": "ShelbyNet",
    "chainId": 118
  }
}
```

- [ ] If ShelbyNet settlement manifest is not deployed yet, confirm Aptos paid settlement fails closed instead of claiming success.
- [ ] After deployment manifest exists, run one real upload and verify media URL resolves.

## Self-review

- Spec coverage: network preservation, ShelbyNet runtime, split keys, gas station, settlement validation, UI labels, Solana Devnet retention, and verification are covered.
- Placeholder scan: no unresolved markers or fake deployment addresses are used.
- Type consistency: runtime fields are consistently named `shelbyRuntime`, `shelbyNetwork`, `aptosNetwork`, `chainId`, `rpcBaseUrl`, `storageNetworkLabel`, and `sourceNetworkLabel`.
