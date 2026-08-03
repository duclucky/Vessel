import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import {
  expectedTotalChunksets,
  SHELBYUSD_FA_METADATA_ADDRESS,
} from '@shelby-protocol/sdk/node';
import { config } from './config.js';
import { getStorageProvider } from './storage/index.js';
import { contentKey, mimeForKey } from './lib/keys.js';
import { makeChallenge, verifySignature, deriveStorageAccount } from './lib/identity.js';
import { PaymentManager } from './lib/payments.js';
import { SponsorManager } from './lib/sponsor.js';
import { createShelbyPricingReader, calculateUploadQuote } from './lib/shelby-pricing.js';
import { normalizeUploadQuoteContext, QuoteManager } from './lib/quotes.js';
import { PaidAuthorizationManager } from './lib/paid-authorizations.js';
import { verifyAptosShelbyUsdTransfer } from './lib/aptos-settlement.js';
import { targetExpirationMicros } from '../public/retention.js';
import { extractShelbyTransactionEvidence } from '../client-src/wallets/transaction-evidence.js';
import { createTelemetry } from './lib/telemetry.js';
import { loadSettlementDeployments } from './lib/settlement/deployments.js';
import { SettlementAdapterRegistry } from './lib/settlement/adapters.js';
import { AptosSettlementAdapter } from './lib/settlement/aptos-adapter.js';
import { verifyContractQuoteSignature } from './lib/settlement/contract-quotes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const store = getStorageProvider();
const telemetry = createTelemetry({ walletSalt: config.telemetryWalletSalt });
let payments = null;
try {
  if (config.treasurySecretKey) payments = new PaymentManager({
    rpc: config.solanaRpc,
    treasurySecretKey: config.treasurySecretKey,
    usdcMint: config.usdcMint,
  });
} catch (e) { console.warn('[pay] disabled:', String(e?.message || e)); }
let sponsor = null;
try {
  if (config.gasStationApiKey) sponsor = new SponsorManager({ gasStationApiKey: config.gasStationApiKey, network: config.network });
} catch (e) { console.warn('[sponsor] disabled:', String(e?.message || e)); }
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
const pricingReader = createShelbyPricingReader({ aptos });
let settlementDeployments = Object.freeze({ enabled: false });
let settlementAdapters = null;
try {
  settlementDeployments = loadSettlementDeployments({
    file: path.resolve(process.cwd(), config.settlementDeploymentsFile),
    quotePublicKey: config.quoteSignerPublicKeyHex,
    enabled: config.settlementContractsEnabled,
    environment: process.env.NODE_ENV || 'development',
  });
  if (settlementDeployments.enabled) {
    settlementAdapters = new SettlementAdapterRegistry({
      aptos: new AptosSettlementAdapter({
        aptos,
        moduleAddress: settlementDeployments.aptos.moduleAddress,
        vaultAddress: settlementDeployments.aptos.vaultAddress,
        chainId: settlementDeployments.aptos.chainId,
      }),
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

async function enrichSettlementQuote(quote) {
  if (quote.chain === 'solana') {
    return Object.freeze({
      ...quote,
      treasuryAta: payments ? (await payments.treasuryAta()).toString() : '',
      usdcMint: config.usdcMint,
    });
  }
  return Object.freeze({
    ...quote,
    aptosTreasuryAddress: config.aptosTreasuryAddress,
    shelbyUsdAssetAddress: SHELBYUSD_FA_METADATA_ADDRESS.toString(),
  });
}

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
function fail(res, e) {
  const status = e?.status || 500;
  return send(res, status, { error: e?.message || 'Internal error', code: e?.code, retriable: !!e?.retriable });
}

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
    const expiresInSec = req.body?.expiresInSec ? Number(req.body.expiresInSec) : undefined;
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

// ---- Delete ----
app.delete('/api/media/*', async (req, res) => {
  try { await store.delete(req.params[0]); send(res, 200, { ok: true }); }
  catch (e) { fail(res, e); }
});

// ---- NFT metadata (host JSON on Shelby, referencing the Shelby-hosted image) ----
app.post('/api/metadata', async (req, res) => {
  try {
    const { name, description, imageKey, imageUrl: imageUrlIn, external_url, attributes } = req.body || {};
    if (!imageKey && !imageUrlIn) return send(res, 400, { error: 'imageKey or imageUrl required' });
    // Prefer the visitor's real Shelby URL (their DAA account owns the blob); fall back to the proxy.
    const imageUrl = imageUrlIn || `${config.publicBase}/api/media/${imageKey}`;
    const json = { name: name || '', description: description || '', image: imageUrl };
    if (external_url) json.external_url = external_url;
    if (Array.isArray(attributes) && attributes.length) json.attributes = attributes;
    const bytes = new TextEncoder().encode(JSON.stringify(json, null, 2));
    const key = contentKey(bytes, 'application/json');
    const put = await store.put(key, bytes, { contentType: 'application/json' });
    send(res, 200, { tokenUri: put.url, url: put.url, json });
  } catch (e) { fail(res, e); }
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
    domain: config.daaDomain,
    solanaRpc: config.solanaRpc,
    shelbyApiKey: '', // never exposed; anonymous testnet reads/writes don't need it client-side
    usdcMint: config.usdcMint,
    gasStationAccount: config.gasStationAccount, // public fee-payer address (safe to expose)
    dynamicQuotes: !!quoteManager,
    settlementContracts: settlementDeployments.enabled ? {
      enabled: true,
      quotePublicKey: settlementDeployments.quotePublicKey,
      configVersion: settlementDeployments.configVersion,
      aptos: settlementDeployments.aptos,
      solana: settlementDeployments.solana,
    } : { enabled: false },
    sponsored: !!sponsor && !!payments && !!paidAuthorizations,
    walletFamilies: {
      aptos: config.walletAptosEnabled,
      solana: config.walletSolanaEnabled && !!sponsor && !!payments && !!paidAuthorizations,
      evm: false,
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
    const quote = await enrichSettlementQuote(await quoteManager.issueUpload(context));
    recordQuoteOperation('quoted', quote);
    send(res, 200, quote);
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
    const quote = await enrichSettlementQuote(await quoteManager.issueUpload(context));
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

// ---- Sponsored on-chain submit (gas station key stays server-side; see NOTES 5j) ----
app.post('/api/sponsor/submit', async (req, res) => {
  try {
    if (!sponsor) return send(res, 501, { error: 'sponsor not configured' });
    if (!quoteManager || !paidAuthorizations) {
      return send(res, 503, { error: 'paid authorization not configured' });
    }
    const {
      transaction,
      senderAuthenticator,
      quoteToken,
      paidAuthorization,
      uploadContext,
    } = req.body || {};
    if (!transaction || !senderAuthenticator) return send(res, 400, { error: 'transaction and senderAuthenticator required' });
    const quote = quoteManager.validate(quoteToken, uploadContext, { allowExpired: true });
    paidAuthorizations.validate(paidAuthorization, quote);
    const r = await sponsor.submit(String(transaction), String(senderAuthenticator), {
      expectedSender: quote.context.storageAddress,
    });
    if (!r.hash) return send(res, 502, { error: 'gas station returned no hash' });
    const completed = await aptos.waitForTransaction({ transactionHash: r.hash });
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
    });
    fail(res, e);
  }
});

// ---- Quote-bound settlement verification ----
function aptosAddressBytesHex(value) {
  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  return /^[0-9a-f]{1,64}$/.test(text) ? text.padStart(64, '0') : '';
}

function assertContractEvidenceMatchesContext(contractQuote, signedQuote) {
  const context = signedQuote.context;
  const expectedChain = context.chain === 'aptos' ? 1 : 2;
  const expectedAmount = context.chain === 'aptos'
    ? (BigInt(signedQuote.breakdown.serviceFeeAccountingMicro) * 100n).toString()
    : String(signedQuote.breakdown.totalAccountingMicro);
  const mismatched = (
    Number(contractQuote?.chain) !== expectedChain
    || String(contractQuote?.fileHash || '').toLowerCase() !== context.fileHash
    || Number(contractQuote?.retentionDays) !== context.days
    || String(contractQuote?.storageExpirationMicros) !== String(context.expirationMicros)
    || String(contractQuote?.amount) !== expectedAmount
    || String(contractQuote?.configVersion) !== settlementDeployments.configVersion
    || (context.chain === 'aptos' && (
      String(contractQuote?.payer || '') !== aptosAddressBytesHex(context.sourceAddress)
      || String(contractQuote?.storageAddress || '') !== aptosAddressBytesHex(context.storageAddress)
      || String(contractQuote?.asset || '')
        !== aptosAddressBytesHex(settlementDeployments.aptos.acceptedAsset)
    ))
  );
  if (mismatched) {
    throw Object.assign(new Error('Contract quote does not match the signed upload context'), {
      code: 'quote_context_mismatch',
      status: 409,
      retriable: false,
    });
  }
}

app.post('/api/settlements/verify', async (req, res) => {
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
    assertContractEvidenceMatchesContext(contractQuote, signedQuote);
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
    send(res, 200, { ok: true, paidAuthorization, receipt });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/pay/solana/verify', async (req, res) => {
  try {
    if (!quoteManager || !paidAuthorizations || !payments) {
      return send(res, 503, { error: 'Solana settlement is unavailable' });
    }
    const { quoteToken, signature } = req.body || {};
    if (!quoteToken || !signature) {
      return send(res, 400, { error: 'quoteToken and signature required' });
    }
    const quote = quoteManager.validate(quoteToken);
    if (quote.context.chain !== 'solana') {
      return send(res, 400, { error: 'Solana quote required', code: 'quote_chain_mismatch' });
    }
    const settlementQuote = {
      ...quote,
      sourceAddress: quote.context.sourceAddress,
      solanaAmountMicro: quote.breakdown.totalAccountingMicro,
    };
    const verified = await payments.verifyQuotePayment({ quote: settlementQuote, signature });
    if (!verified.ok) return send(res, 402, verified);
    const paidAuthorization = paidAuthorizations.issue({
      quote,
      settlementChain: 'solana',
      settlementHash: verified.signature,
    });
    recordQuoteOperation('paid', quote, { transactionHash: verified.signature });
    send(res, 200, { ok: true, paidAuthorization, settlementHash: verified.signature });
  } catch (e) {
    telemetry.operation({
      stage: 'failed', operation: 'upload', network: 'solana-devnet',
      errorCode: 'payment_verification_failed',
    });
    fail(res, e);
  }
});

app.post('/api/pay/aptos/verify', async (req, res) => {
  try {
    if (!quoteManager || !paidAuthorizations) {
      return send(res, 503, { error: 'Aptos settlement is unavailable' });
    }
    const { quoteToken, transactionHash = '' } = req.body || {};
    if (!quoteToken) return send(res, 400, { error: 'quoteToken required' });
    const quote = quoteManager.validate(quoteToken);
    if (quote.context.chain !== 'aptos') {
      return send(res, 400, { error: 'Aptos quote required', code: 'quote_chain_mismatch' });
    }
    const nativeServiceFeeShelbyUsdUnits = (
      BigInt(quote.breakdown.serviceFeeAccountingMicro) * 100n
    ).toString();
    const settlementHash = nativeServiceFeeShelbyUsdUnits === '0'
      ? `no-service-fee:${quote.quoteId}`
      : (await verifyAptosShelbyUsdTransfer({
        transactionHash,
        quote: {
          ...quote,
          sourceAddress: quote.context.sourceAddress,
          nativeServiceFeeShelbyUsdUnits,
        },
        aptos,
        treasury: config.aptosTreasuryAddress,
        assetAddress: SHELBYUSD_FA_METADATA_ADDRESS,
      })).transactionHash;
    const paidAuthorization = paidAuthorizations.issue({
      quote,
      settlementChain: 'aptos',
      settlementHash,
    });
    recordQuoteOperation('paid', quote, { transactionHash: settlementHash });
    send(res, 200, { ok: true, paidAuthorization, settlementHash });
  } catch (e) {
    telemetry.operation({
      stage: 'failed', operation: 'upload', network: 'aptos-testnet',
      errorCode: 'payment_verification_failed',
    });
    fail(res, e);
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
