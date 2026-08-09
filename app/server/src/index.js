import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Aptos, AptosConfig } from '@aptos-labs/ts-sdk';
import {
  expectedTotalChunksets,
  SHELBYUSD_FA_METADATA_ADDRESS,
  ShelbyNodeClient,
} from '@shelby-protocol/sdk/node';
import { config } from './config.js';
import { getStorageProvider } from './storage/index.js';
import { contentKey, mimeForKey } from './lib/keys.js';
import { makeChallenge, verifySignature, deriveStorageAccount } from './lib/identity.js';
import { DirectAptosSubmitter, SponsorManager } from './lib/sponsor.js';
import { createShelbyPricingReader, calculateUploadQuote } from './lib/shelby-pricing.js';
import { normalizeUploadQuoteContext, QuoteManager } from './lib/quotes.js';
import { PaidAuthorizationManager } from './lib/paid-authorizations.js';
import { validatePaidUploadAuthorization } from './lib/paid-upload-access.js';
import {
  buildDirectRegisterTransaction,
  directDaaTransactionOptions,
} from './lib/shelby-register-builder.js';
import { ShelbyUploadGateway } from './lib/shelby-upload-gateway.js';
import { ensureShelbyDaaFunding } from './lib/shelby-daa-funding.js';
import { targetExpirationMicros } from '../public/retention.js';
import { extractShelbyTransactionEvidence } from '../client-src/wallets/transaction-evidence.js';
import { createTelemetry } from './lib/telemetry.js';
import { shelbyWriteGate } from './lib/shelby-write-gate.js';
import { loadSettlementDeployments } from './lib/settlement/deployments.js';
import { SettlementAdapterRegistry } from './lib/settlement/adapters.js';
import { AptosSettlementAdapter } from './lib/settlement/aptos-adapter.js';
import { SolanaSettlementAdapter } from './lib/settlement/solana-adapter.js';
import { EvmSettlementAdapter } from './lib/settlement/evm-adapter.js';
import { publicNetworkDescriptor } from './lib/shelby-network.js';
import {
  assertContractQuoteMatchesContext,
  ContractQuoteManager,
  privateKeyFromPkcs8Base64,
  publicKeyFromRawHex,
  verifyContractQuoteSignature,
} from './lib/settlement/contract-quotes.js';
import { Connection, PublicKey } from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const store = getStorageProvider();
const telemetry = createTelemetry({ walletSalt: config.telemetryWalletSalt });
let sponsor = null;
try {
  if (config.gasStationApiKey) {
    sponsor = new SponsorManager({
      gasStationApiKey: config.gasStationApiKey,
      network: config.shelbyRuntime,
    });
  }
} catch (e) { console.warn('[sponsor] disabled:', String(e?.message || e)); }
const aptos = new Aptos(new AptosConfig({
  network: config.shelbyRuntime.aptosNetwork,
  clientConfig: config.shelbyAptosApiKey ? { API_KEY: config.shelbyAptosApiKey } : undefined,
}));
const directSubmitter = new DirectAptosSubmitter({ aptos });
const pricingReader = createShelbyPricingReader({ aptos });
let shelbyClient = null;
let shelbyGateway = null;
try {
  if (config.shelbyRpcApiKey) {
    shelbyClient = new ShelbyNodeClient({
      network: config.shelbyRuntime.aptosNetwork,
      apiKey: config.shelbyRpcApiKey,
      aptos: {
        network: config.shelbyRuntime.aptosNetwork,
        clientConfig: config.shelbyAptosApiKey ? { API_KEY: config.shelbyAptosApiKey } : undefined,
      },
      rpc: {
        baseUrl: config.shelbyRuntime.rpcBaseUrl,
        apiKey: config.shelbyRpcApiKey,
      },
      indexer: {
        baseUrl: config.shelbyRuntime.indexerUrl,
        apiKey: config.shelbyIndexerApiKey,
      },
    });
    shelbyGateway = new ShelbyUploadGateway({
      apiKey: config.shelbyRpcApiKey,
      rpcBaseUrl: shelbyClient.baseUrl,
      secret: config.paySecret,
      rpcClient: shelbyClient.rpc,
      maxPartBytes: config.maxUploadBytes,
    });
  }
} catch (error) {
  console.warn('[shelby-gateway] disabled:', String(error?.message || error));
}
let settlementDeployments = Object.freeze({ enabled: false });
let settlementAdapters = null;
let contractQuoteManager = null;
try {
  settlementDeployments = loadSettlementDeployments({
    file: path.resolve(process.cwd(), config.settlementDeploymentsFile),
    quotePublicKey: config.quoteSignerPublicKeyHex,
    enabled: config.settlementContractsEnabled,
    environment: process.env.NODE_ENV || 'development',
  });
  if (settlementDeployments.enabled) {
    contractQuoteManager = new ContractQuoteManager({
      privateKey: privateKeyFromPkcs8Base64(config.quoteSignerPrivateKeyBase64),
      publicKey: publicKeyFromRawHex(config.quoteSignerPublicKeyHex),
      priceUpload: async () => {
        throw new Error('Contract quotes must reuse the signed server breakdown');
      },
      aptosAssetHex: settlementDeployments.aptos.acceptedAsset,
      aptosNetwork: settlementDeployments.aptos.chainId,
      solanaMintHex: new PublicKey(settlementDeployments.solana.acceptedMint)
        .toBuffer()
        .toString('hex'),
      evmAssetHex: settlementDeployments.evm?.acceptedAsset || 'ee'.repeat(32),
      evmNetwork: settlementDeployments.evm?.chainId || 11155111,
      configVersion: settlementDeployments.configVersion,
    });
    settlementAdapters = new SettlementAdapterRegistry({
      aptos: new AptosSettlementAdapter({
        aptos,
        moduleAddress: settlementDeployments.aptos.moduleAddress,
        vaultAddress: settlementDeployments.aptos.vaultAddress,
        chainId: settlementDeployments.aptos.chainId,
      }),
      solana: new SolanaSettlementAdapter({
        connection: new Connection(config.solanaRpc, 'confirmed'),
        programId: settlementDeployments.solana.programId,
        vaultAta: settlementDeployments.solana.vaultAta,
        acceptedMint: settlementDeployments.solana.acceptedMint,
        network: 1,
      }),
      ...(settlementDeployments.evm ? {
        evm: new EvmSettlementAdapter({
          rpcUrl: config.evmRpc,
          contractAddress: settlementDeployments.evm.contractAddress,
          network: settlementDeployments.evm.chainId,
        }),
      } : {}),
    });
  }
} catch (error) {
  if (config.settlementContractsEnabled) throw error;
}
let quoteManager = null;
try {
  if (config.dynamicQuotesEnabled) {
    quoteManager = new QuoteManager({
      secret: config.paySecret,
      contractQuoteManager,
      async priceUpload(intent) {
        const [pricing, gasPrice] = await Promise.all([
          pricingReader.read(),
          aptos.getGasPriceEstimation(),
        ]);
        const gasUnits = (
          config.registerGasUnitsEstimate * config.gasSafetyBps + 9_999n
        ) / 10_000n;
        return calculateUploadQuote({
          intent,
          pricing,
          chunksetCount: expectedTotalChunksets(intent.sizeBytes),
          gasUnits,
          gasUnitPriceOctas: BigInt(gasPrice.gas_estimate),
          aptUsdMicros: config.aptUsdReferenceMicros,
        });
      },
    });
  }
} catch (e) { console.warn('[quotes] disabled:', String(e?.message || e)); }
let paidAuthorizations = null;
try {
  if (quoteManager) {
    paidAuthorizations = new PaidAuthorizationManager({
      quoteManager,
      secret: config.paySecret,
      settlementContractsEnabled: config.settlementContractsEnabled,
    });
  }
} catch (e) { console.warn('[paid-auth] disabled:', String(e?.message || e)); }
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

function recordQuoteOperation(stage, quote, extra = {}) {
  const context = quote?.context || quote || {};
  const breakdown = quote?.breakdown || quote || {};
  telemetry.operation({
    stage,
    operation: context.operation || 'upload',
    network: context.storageNetwork || config.network,
    wallet: context.sourceAddress,
    storageAddress: context.storageAddress,
    quoteId: quote?.quoteId,
    configVersion: breakdown.configVersion,
    durationDays: context.days,
    sizeBytes: context.sizeBytes,
    quotedMicro: breakdown.totalAccountingMicro,
    ...extra,
  });
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const send = (res, status, body) => res.status(status).json(body);
function requireShelbyWrites(res) {
  const blocked = shelbyWriteGate(config.shelbyWritesEnabled);
  if (!blocked) return true;
  send(res, blocked.status, blocked.body);
  return false;
}
function fail(res, e) {
  const status = e?.status || 500;
  return send(res, status, { error: e?.message || 'Internal error', code: e?.code, retriable: !!e?.retriable });
}

function validatePaidUploadBody(body = {}) {
  return validatePaidUploadAuthorization({
    quoteManager,
    paidAuthorizations,
    settlementDeployments,
    verifyContractQuoteSignature,
    assertContractQuoteMatchesContext,
    quoteToken: body.quoteToken,
    uploadContext: body.uploadContext,
    paidAuthorization: body.paidAuthorization,
    contractQuote: body.contractQuote,
    contractSignature: body.contractSignature,
  });
}

function sponsoredMaxGasAmount() {
  const gasUnits = (
    config.registerGasUnitsEstimate * config.gasSafetyBps + 9_999n
  ) / 10_000n;
  const minGasUnits = 28n;
  const boundedGasUnits = gasUnits > minGasUnits ? gasUnits : minGasUnits;
  if (boundedGasUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    const error = new Error('Sponsored gas limit is too large');
    error.status = 500;
    error.code = 'invalid_sponsored_gas_limit';
    throw error;
  }
  return Number(boundedGasUnits);
}

const encodeBlobPath = (blobName) => String(blobName)
  .split('/')
  .map((segment) => encodeURIComponent(segment))
  .join('/');

// ---- Health ----
app.get('/api/health', async (_req, res) => {
  const out = { status: 'ok', backend: store.name(), network: config.network };
  if (store.name() === 'shelby' && store.health) out.storage = await store.health();
  send(res, 200, out);
});

// ---- Identity (wallet ownership) ----
app.post('/api/identity/challenge', (req, res) => {
  const { address } = req.body || {};
  if (!address) return send(res, 400, { error: 'address required' });
  send(res, 200, makeChallenge(String(address)));
});

app.post('/api/identity/verify', async (req, res) => {
  const { address, signature, message } = req.body || {};
  if (!address || !signature || !message) return send(res, 400, { error: 'address, signature, message required' });
  const result = await verifySignature(String(address), signature, message);
  if (!result.ok) return send(res, 401, { error: 'signature verification failed', code: result.reason });
  send(res, 200, result);
});

// ---- Upload ----
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return send(res, 400, { error: 'file field required' });
    const data = new Uint8Array(req.file.buffer);
    const mime = req.file.mimetype || 'application/octet-stream';
    const key = contentKey(data, mime);
    const expiresInSec = req.body?.expiresInSec
      ? Number(req.body.expiresInSec)
      : config.defaultStorageDays * 86_400;
    const result = await store.put(key, data, { contentType: mime, owner: req.body?.owner, expiresInSec });
    send(res, 200, result);
  } catch (e) { fail(res, e); }
});

// ---- Media proxy (keyed read; keys contain slashes → wildcard) ----
app.get('/api/media/*', async (req, res) => {
  try {
    const key = req.params[0];
    const obj = await store.get(key);
    if (!obj) return send(res, 404, { error: 'not found', code: 'not_found' });
    res.setHeader('Content-Type', obj.contentType || mimeForKey(key));
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.end(Buffer.from(obj.data));
  } catch (e) { fail(res, e); }
});

// ---- List ----
app.get('/api/list', async (req, res) => {
  try {
    const all = await store.list('');
    const items = all.filter((i) => i.contentType !== 'application/json'); // media only, hide metadata JSON
    send(res, 200, { items, backend: store.name() });
  } catch (e) { fail(res, e); }
});

// ---- Wallet-owned Shelby access (the private API key stays on this server) ----
app.get('/api/shelby/artifacts', async (req, res) => {
  try {
    if (!shelbyClient) return send(res, 503, { error: 'Shelby API access is unavailable' });
    const account = String(req.query.account || '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(account)) {
      return send(res, 400, { error: 'valid Shelby account required', code: 'invalid_storage_address' });
    }
    const rows = await shelbyClient.coordination.getAccountBlobs({ account });
    send(res, 200, {
      items: rows.map((row) => ({
        owner: row.owner?.toString?.() || String(row.owner || account),
        name: row.name,
        blobNameSuffix: row.blobNameSuffix,
        size: row.size,
        contentType: mimeForKey(row.blobNameSuffix),
        creationMicros: row.creationMicros,
        expirationMicros: row.expirationMicros,
        isWritten: !!row.isWritten,
        isDeleted: !!row.isDeleted,
        url: `/api/shelby/blobs/${account}/${encodeBlobPath(row.blobNameSuffix)}`,
      })),
    });
  } catch (e) { fail(res, e); }
});

app.get('/api/shelby/accounts/:account/balances', async (req, res) => {
  try {
    if (!shelbyClient) return send(res, 503, { error: 'Shelby API access is unavailable' });
    const account = String(req.params.account || '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(account)) {
      return send(res, 400, { error: 'valid Shelby account required', code: 'invalid_storage_address' });
    }
    const [aptOctas, rows] = await Promise.all([
      aptos.getAccountAPTAmount({ accountAddress: account }),
      aptos.getCurrentFungibleAssetBalances({
        options: {
          where: {
            owner_address: { _eq: account },
            asset_type: { _eq: SHELBYUSD_FA_METADATA_ADDRESS },
          },
        },
      }),
    ]);
    send(res, 200, {
      aptOctas: Number(aptOctas || 0),
      shelbyUsdUnits: Number(rows?.[0]?.amount || 0),
    });
  } catch (e) { fail(res, e); }
});

app.get('/api/shelby/transactions/:hash', async (req, res) => {
  try {
    if (!shelbyClient) return send(res, 503, { error: 'Shelby API access is unavailable' });
    const hash = String(req.params.hash || '');
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) {
      return send(res, 400, { error: 'valid Aptos transaction hash required', code: 'invalid_transaction_hash' });
    }
    const transaction = await aptos.waitForTransaction({ transactionHash: hash });
    send(res, 200, transaction);
  } catch (e) { fail(res, e); }
});

app.get('/api/shelby/blobs/:account/*', async (req, res) => {
  try {
    if (!shelbyClient || !config.shelbyRpcApiKey) {
      return send(res, 503, { error: 'Shelby API access is unavailable' });
    }
    const account = String(req.params.account || '').toLowerCase();
    const blobName = String(req.params[0] || '');
    if (!/^0x[0-9a-f]{64}$/.test(account) || !blobName || blobName.includes('..')) {
      return send(res, 400, { error: 'invalid Shelby blob path', code: 'invalid_blob_name' });
    }
    const upstreamHeaders = { Authorization: `Bearer ${config.shelbyRpcApiKey}` };
    const requestedRange = String(req.headers.range || '');
    if (/^bytes=\d+-\d*$/.test(requestedRange)) upstreamHeaders.Range = requestedRange;
    const upstream = await fetch(
      `${shelbyClient.baseUrl}/v1/blobs/${account}/${encodeBlobPath(blobName)}`,
      { headers: upstreamHeaders },
    );
    if (!upstream.ok || !upstream.body) {
      return send(res, upstream.status || 502, { error: 'Shelby blob is unavailable' });
    }
    res.status(upstream.status);
    const upstreamContentType = String(upstream.headers.get('content-type') || '')
      .split(';')[0]
      .toLowerCase();
    const responseContentType = upstreamContentType === 'application/octet-stream'
      ? mimeForKey(blobName)
      : (upstreamContentType || mimeForKey(blobName));
    res.setHeader('content-type', responseContentType);
    for (const header of [
      'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified',
    ]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) { fail(res, e); }
});

app.post('/api/shelby/register', async (req, res) => {
  try {
    if (!requireShelbyWrites(res)) return;
    if (!shelbyClient || !shelbyGateway) {
      return send(res, 503, { error: 'Shelby registration is unavailable' });
    }
    const { signedQuote } = validatePaidUploadBody(req.body);
    await ensureShelbyDaaFunding({
      address: signedQuote.context.storageAddress,
      aptos,
      shelbyClient,
    });
    const transaction = await buildDirectRegisterTransaction({
      shelbyClient,
      signedQuote,
      blobMerkleRoot: req.body?.blobMerkleRoot,
      maxGasAmount: sponsoredMaxGasAmount(),
    });
    send(res, 200, {
      transaction: Buffer.from(transaction.bcsToBytes()).toString('base64'),
      transactionKind: 'simple',
      submitMode: 'direct',
    });
  } catch (e) { fail(res, e); }
});

app.post('/api/shelby/commit', async (req, res) => {
  try {
    if (!requireShelbyWrites(res)) return;
    if (!shelbyClient) {
      return send(res, 503, { error: 'Shelby commit is unavailable' });
    }
    const { signedQuote } = validatePaidUploadBody(req.body);
    if (!req.body?.commitPayload || typeof req.body.commitPayload !== 'object') {
      return send(res, 400, { error: 'Shelby commit payload is required', code: 'commit_payload_required' });
    }
    await ensureShelbyDaaFunding({
      address: signedQuote.context.storageAddress,
      aptos,
      shelbyClient,
      minShelbyUsdUnits: 0n,
    });
    const transaction = await shelbyClient.aptos.transaction.build.simple({
      sender: signedQuote.context.storageAddress,
      data: req.body?.commitPayload,
      options: directDaaTransactionOptions(sponsoredMaxGasAmount()),
    });
    send(res, 200, {
      transaction: Buffer.from(transaction.bcsToBytes()).toString('base64'),
      transactionKind: 'simple',
      submitMode: 'direct',
    });
  } catch (e) { fail(res, e); }
});

app.post('/api/shelby/uploads', async (req, res) => {
  try {
    if (!requireShelbyWrites(res)) return;
    if (!shelbyClient || !shelbyGateway) {
      return send(res, 503, { error: 'Shelby upload gateway is unavailable' });
    }
    const { signedQuote } = validatePaidUploadBody(req.body);
    const context = signedQuote.context;
    if (Number(req.body?.totalBytes) !== context.sizeBytes) {
      return send(res, 409, { error: 'Upload size does not match the paid quote', code: 'paid_context_mismatch' });
    }
    const registrationUid = String(req.body?.registrationUid || '');
    if (!/^\d+$/.test(registrationUid)) {
      return send(res, 400, {
        error: 'Shelby registration UID is required',
        code: 'registration_uid_required',
      });
    }
    const metadata = await shelbyClient.coordination.getFullObjectMetadataByUid(BigInt(registrationUid));
    if (
      !metadata
      || Number(metadata.size) !== context.sizeBytes
      || Number(metadata.expirationMicros) !== context.expirationMicros
    ) {
      return send(res, 409, {
        error: 'Shelby registration does not match the paid upload',
        code: 'registration_mismatch',
      });
    }
    if (metadata.isWritten) {
      return send(res, 200, { alreadyWritten: true, uploadedBytes: context.sizeBytes });
    }
    const started = await shelbyGateway.start({
      account: context.storageAddress,
      blobName: context.blobName,
      totalBytes: context.sizeBytes,
      partSize: context.sizeBytes,
      registrationUid,
      blobMerkleRoot: req.body?.blobMerkleRoot,
    });
    send(res, 200, started);
  } catch (e) { fail(res, e); }
});

app.put(
  '/api/shelby/uploads/:uploadId/parts/:partIdx',
  express.raw({ type: 'application/octet-stream', limit: '3mb' }),
  async (req, res) => {
    try {
      if (!requireShelbyWrites(res)) return;
      if (!shelbyGateway) return send(res, 503, { error: 'Shelby upload gateway is unavailable' });
      const uploadToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const result = await shelbyGateway.putPart({
        uploadId: req.params.uploadId,
        partIdx: Number(req.params.partIdx),
        data: req.body,
        uploadToken,
      });
      send(res, 200, { ok: true, ...result });
    } catch (e) { fail(res, e); }
  },
);

app.post('/api/shelby/uploads/:uploadId/complete', async (req, res) => {
  try {
    if (!requireShelbyWrites(res)) return;
    if (!shelbyGateway) return send(res, 503, { error: 'Shelby upload gateway is unavailable' });
    const uploadToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const result = await shelbyGateway.complete({
      uploadId: req.params.uploadId,
      uploadToken,
      spAcks: req.body?.spAcks,
    });
    send(res, 200, { ok: true, ...result });
  } catch (e) { fail(res, e); }
});

// ---- Delete ----
app.delete('/api/media/*', async (req, res) => {
  try { await store.delete(req.params[0]); send(res, 200, { ok: true }); }
  catch (e) { fail(res, e); }
});

// Metadata JSON is uploaded through the wallet-owned Shelby flow, never server-owned storage.
app.post('/api/metadata', (_req, res) => {
  send(res, 410, {
    error: 'Use wallet-owned metadata hosting',
    code: 'wallet_owned_metadata_required',
  });
});

// ---- Latency (Shelby vs IPFS) ----
async function measureUrlServer(url, samples) {
  const times = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    try { await fetch(`${url}${url.includes('?') ? '&' : '?'}cb=${i}`).then((r) => r.arrayBuffer()); } catch {}
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const at = (p) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))]);
  return { medianMs: at(0.5), minMs: Math.round(times[0]), p90Ms: at(0.9), samples: times.length };
}

app.get('/api/latency', async (req, res) => {
  try {
    const key = req.query.key;
    const url = req.query.url;
    const samples = Math.min(50, Number(req.query.samples || 20));
    if (!key && !url) return send(res, 400, { error: 'key or url required' });
    // Measure the visitor's own Shelby URL server-side (avoids browser CORS); else the server blob.
    const shelby = url ? await measureUrlServer(String(url), samples) : (store.measureRead ? await store.measureRead(String(key), samples) : null);

    let ipfs = null;
    if (config.ipfsCompareCid) {
      const times = [];
      for (let i = 0; i < Math.min(8, samples); i++) {
        const t0 = performance.now();
        // Only count SUCCESSFUL reads — a failed/blocked fetch must not fake a fast time.
        const ok = await fetch(`${config.ipfsGateway}${config.ipfsCompareCid}?cb=${i}`)
          .then((r) => (r.ok ? r.arrayBuffer().then(() => true) : false)).catch(() => false);
        if (ok) times.push(performance.now() - t0);
      }
      if (times.length) { times.sort((a, b) => a - b); ipfs = { medianMs: Math.round(times[Math.floor(times.length / 2)]), samples: times.length }; }
    }
    send(res, 200, { shelby, ipfs, backend: store.name() });
  } catch (e) { fail(res, e); }
});

// ---- Public client config (NO secrets: only addresses, mints, network, pricing) ----
app.get('/api/config', (_req, res) => {
  send(res, 200, {
    network: config.network,
    shelbyNetwork: publicNetworkDescriptor(config.shelbyRuntime),
    shelbyWritesEnabled: config.shelbyWritesEnabled,
    domain: config.daaDomain,
    solanaRpc: config.solanaRpc,
    shelbyApiKey: '', // never exposed; authenticated Shelby requests go through this server
    usdcMint: config.usdcMint,
    gasStationAccount: config.gasStationAccount, // public fee-payer address (safe to expose)
    dynamicQuotes: !!quoteManager,
    settlementContracts: settlementDeployments.enabled ? {
      enabled: true,
      quotePublicKey: settlementDeployments.quotePublicKey,
      configVersion: settlementDeployments.configVersion,
      aptos: settlementDeployments.aptos,
      solana: settlementDeployments.solana,
      ...(settlementDeployments.evm ? { evm: settlementDeployments.evm } : {}),
    } : { enabled: false },
    sponsored: !!paidAuthorizations
      && !!shelbyGateway
      && settlementDeployments.enabled,
    walletFamilies: {
      aptos: config.walletAptosEnabled && !!paidAuthorizations && settlementDeployments.enabled,
      solana: config.walletSolanaEnabled
        && !!paidAuthorizations
        && !!shelbyGateway
        && settlementDeployments.enabled,
      evm: config.walletEvmEnabled
        && !!paidAuthorizations
        && !!shelbyGateway
        && !!settlementDeployments.evm,
    },
    maxUploadBytes: config.maxUploadBytes,
  });
});

// ---- Five-minute wallet/file-bound dynamic upload quotes ----
app.post('/api/quotes/upload', async (req, res) => {
  try {
    if (!quoteManager) {
      telemetry.operation({
        stage: 'failed', operation: 'upload', network: config.network,
        wallet: req.body?.sourceAddress, storageAddress: req.body?.storageAddress,
        sizeBytes: req.body?.sizeBytes, errorCode: 'pricing_unavailable',
      });
      return send(res, 503, {
        error: 'Live Shelby pricing is unavailable',
        code: 'pricing_unavailable',
        retriable: true,
      });
    }
    const sizeBytes = Number(req.body?.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return send(res, 400, { error: 'valid sizeBytes required', code: 'invalid_quote_context' });
    }
    if (sizeBytes > config.maxUploadBytes) {
      return send(res, 413, { error: 'file exceeds upload limit', code: 'file_too_large' });
    }
    const pricing = await pricingReader.read();
    const serverTimeMs = Number(pricing.serverTimeMicros / 1_000n);
    const context = normalizeUploadQuoteContext({
      ...req.body,
      expirationMicros: targetExpirationMicros({ serverTimeMs, days: req.body?.days }),
    });
    const quote = await quoteManager.issueUpload(context);
    recordQuoteOperation('quoted', quote);
    send(res, 200, {
      ...quote,
      settlementDeployment: settlementDeployments.enabled ? {
        quotePublicKey: settlementDeployments.quotePublicKey,
        configVersion: settlementDeployments.configVersion,
        chain: settlementDeployments[context.chain],
      } : null,
    });
  } catch (e) {
    telemetry.operation({
      stage: 'failed', operation: 'upload', network: config.network,
      wallet: req.body?.sourceAddress, storageAddress: req.body?.storageAddress,
      sizeBytes: req.body?.sizeBytes, errorCode: e?.code || 'pricing_unavailable',
    });
    fail(res, e);
  }
});

app.post('/api/quotes/validate', async (req, res) => {
  try {
    if (!quoteManager) {
      return send(res, 503, {
        error: 'Live Shelby pricing is unavailable',
        code: 'pricing_unavailable',
        retriable: true,
      });
    }
    const { quoteToken, ...input } = req.body || {};
    if (!quoteToken) return send(res, 400, { error: 'quoteToken required', code: 'invalid_quote' });
    const context = normalizeUploadQuoteContext(input);
    const original = quoteManager.validate(quoteToken, context);
    const quote = await quoteManager.issueUpload(context);
    const originalTotal = BigInt(original.breakdown.totalAccountingMicro);
    const freshTotal = BigInt(quote.totalAccountingMicro);
    const driftPercentBps = originalTotal === 0n
      ? 0
      : Number(((freshTotal - originalTotal) * 10_000n) / originalTotal);
    recordQuoteOperation('validated', quote, {
      driftBps: driftPercentBps,
      errorCode: Math.abs(driftPercentBps) > 500 ? 'quote_drift' : undefined,
    });
    send(res, 200, {
      quote,
      driftPercentBps,
      requiresConfirmation: Math.abs(driftPercentBps) > 500,
    });
  } catch (e) { fail(res, e); }
});

// ---- On-chain submit (direct DAA by default; Gas Station compatibility remains available) ----
app.post('/api/sponsor/submit', async (req, res) => {
  try {
    if (!quoteManager || !paidAuthorizations) {
      return send(res, 503, { error: 'paid authorization not configured' });
    }
    const {
      transaction,
      senderAuthenticator,
      quoteToken,
      paidAuthorization,
      uploadContext,
      contractQuote,
      contractSignature,
      transactionKind,
      submitMode,
    } = req.body || {};
    if (!transaction || !senderAuthenticator) return send(res, 400, { error: 'transaction and senderAuthenticator required' });
    const { signedQuote: quote } = validatePaidUploadBody({
      quoteToken,
      paidAuthorization,
      uploadContext,
      contractQuote,
      contractSignature,
    });
    const useDirectSubmit = submitMode === 'direct';
    if (!useDirectSubmit && !sponsor) return send(res, 501, { error: 'sponsor not configured' });
    const r = useDirectSubmit
      ? await directSubmitter.submit(String(transaction), String(senderAuthenticator), {
        expectedSender: quote.context.storageAddress,
      })
      : await sponsor.submit(String(transaction), String(senderAuthenticator), {
        expectedSender: quote.context.storageAddress,
        transactionKind: transactionKind === 'simple' ? 'simple' : 'multi_agent',
      });
    if (!r.hash) {
      return send(res, 502, { error: useDirectSubmit ? 'Aptos submit returned no hash' : 'gas station returned no hash' });
    }
    const completed = await aptos.waitForTransaction({ transactionHash: r.hash });
    if (req.body?.expectRegistrationEvidence === false) {
      send(res, 200, {
        ...r,
        transactionHash: completed.hash || completed.transaction_hash || r.hash,
        gasUsed: completed.gas_used,
      });
      return;
    }
    const evidence = extractShelbyTransactionEvidence(completed);
    recordQuoteOperation('registered', quote, {
      transactionHash: evidence.transactionHash,
      actualStorageUnits: evidence.actualStorageUnits,
      actualGasUsed: evidence.actualGasUsed,
    });
    send(res, 200, { ...r, ...evidence });
  } catch (e) {
    telemetry.operation({
      stage: 'failed', operation: 'upload', network: config.network,
      errorCode: e?.code === 'registration_evidence_missing'
        ? 'acknowledgement_timeout'
        : 'sponsor_failed',
      errorDetail: `${e?.name || 'Error'} ${e?.status || ''} ${e?.code || ''} ${e?.message || e}`,
    });
    fail(res, e);
  }
});

app.post('/api/settlements/verify', async (req, res) => {
  let settlementTelemetry = null;
  try {
    if (!settlementDeployments.enabled || !settlementAdapters || !quoteManager || !paidAuthorizations) {
      return send(res, 503, { error: 'Contract settlement is unavailable' });
    }
    const {
      quoteToken,
      uploadContext,
      contractQuote,
      contractSignature,
      transactionId,
    } = req.body || {};
    if (!quoteToken || !uploadContext || !contractQuote || !contractSignature || !transactionId) {
      return send(res, 400, {
        error: 'Complete signed quote and transactionId are required',
        code: 'invalid_settlement_evidence',
      });
    }
    const signedQuote = quoteManager.validate(quoteToken, uploadContext, { allowExpired: true });
    const contractEvidence = Object.freeze({
      quoteToken,
      uploadContext: signedQuote.context,
      contractQuote,
      contractSignature,
      quotePublicKey: settlementDeployments.quotePublicKey,
    });
    if (!verifyContractQuoteSignature(contractEvidence)) {
      throw Object.assign(new Error('Invalid Vessel contract quote signature'), {
        code: 'invalid_contract_quote', status: 401, retriable: false,
      });
    }
    assertContractQuoteMatchesContext(contractQuote, signedQuote, settlementDeployments);
    const chainDeployment = settlementDeployments[signedQuote.context.chain];
    settlementTelemetry = {
      operation: 'settlement',
      chain: signedQuote.context.chain,
      network: signedQuote.context.sourceNetwork,
      deploymentId: signedQuote.context.chain === 'aptos'
        ? `${chainDeployment.moduleAddress}::vessel_settlement`
        : signedQuote.context.chain === 'evm' ? chainDeployment.contractAddress : chainDeployment.programId,
      wallet: signedQuote.context.sourceAddress,
      storageAddress: signedQuote.context.storageAddress,
      quoteId: contractQuote.quoteId,
      configVersion: contractQuote.configVersion,
    };
    telemetry.operation({ stage: 'settlement_submitted', ...settlementTelemetry });
    const receipt = await settlementAdapters.verify({
      chain: signedQuote.context.chain,
      quote: contractEvidence,
      transactionId,
    });
    const paidAuthorization = paidAuthorizations.issue({
      quote: contractEvidence,
      receipt,
    });
    recordQuoteOperation('paid', signedQuote, { transactionHash: receipt.transactionId });
    telemetry.operation({
      stage: 'receipt_verified',
      ...settlementTelemetry,
      finalityLatencyMs: Math.max(0, receipt.finalizedAtMs - signedQuote.issuedAtMs),
    });
    send(res, 200, { ok: true, paidAuthorization, receipt });
  } catch (error) {
    if (settlementTelemetry) {
      if (error?.code === 'receipt_pending') {
        telemetry.operation({
          stage: 'receipt_pending',
          ...settlementTelemetry,
          errorCode: error.code,
          severity: 'info',
        });
      } else {
        telemetry.operation({
          stage: 'settlement_failed',
          ...settlementTelemetry,
          errorCode: error?.code || 'settlement_failed',
          severity: 'error',
        });
      }
    }
    fail(res, error);
  }
});

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

// Local/dev: listen. On Vercel the app is imported by api/index.js as a serverless handler (no listen).
if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`[vessel] server on ${config.publicBase}  (backend=${store.name()})`);
  });
}

export default app;
