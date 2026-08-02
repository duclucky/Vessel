import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getStorageProvider } from './storage/index.js';
import { contentKey, mimeForKey } from './lib/keys.js';
import { makeChallenge, verifySignature, deriveStorageAccount } from './lib/identity.js';
import { PaymentManager } from './lib/payments.js';
import { SponsorManager } from './lib/sponsor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const store = getStorageProvider();
let payments = null;
try {
  if (config.treasurySecretKey) payments = new PaymentManager({ rpc: config.solanaRpc, treasurySecretKey: config.treasurySecretKey, usdcMint: config.usdcMint, priceBaseUsdc: config.priceBaseUsdc, pricePerMbUsdc: config.pricePerMbUsdc, secret: config.paySecret });
} catch (e) { console.warn('[pay] disabled:', String(e?.message || e)); }
let sponsor = null;
try {
  if (config.gasStationApiKey) sponsor = new SponsorManager({ gasStationApiKey: config.gasStationApiKey, network: config.network });
} catch (e) { console.warn('[sponsor] disabled:', String(e?.message || e)); }
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

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
    priceBaseUsdc: config.priceBaseUsdc,
    pricePerMbUsdc: config.pricePerMbUsdc,
    sponsored: !!sponsor && !!payments,
    maxUploadBytes: config.maxUploadBytes,
  });
});

// ---- Sponsored on-chain submit (gas station key stays server-side; see NOTES 5j) ----
app.post('/api/sponsor/submit', async (req, res) => {
  try {
    if (!sponsor) return send(res, 501, { error: 'sponsor not configured' });
    if (!payments) return send(res, 501, { error: 'payments not configured' });
    const { transaction, senderAuthenticator, paymentId, uploadToken } = req.body || {};
    if (!transaction || !senderAuthenticator) return send(res, 400, { error: 'transaction and senderAuthenticator required' });
    if (!payments.checkUploadToken(paymentId, uploadToken)) return send(res, 402, { error: 'payment required', code: 'unpaid' });
    const r = await sponsor.submit(String(transaction), String(senderAuthenticator));
    if (!r.hash) return send(res, 502, { error: 'gas station returned no hash' });
    send(res, 200, r);
  } catch (e) { fail(res, e); }
});

// ---- USDC payment (customer pays app; app then sponsors the Aptos-side upload) ----
app.post('/api/pay/quote', async (req, res) => {
  try {
    if (!payments) return send(res, 501, { error: 'payments not configured' });
    const sizeBytes = Math.max(0, Number(req.body?.sizeBytes || 0));
    send(res, 200, await payments.createIntent(sizeBytes));
  } catch (e) { fail(res, e); }
});
app.post('/api/pay/verify', async (req, res) => {
  try {
    if (!payments) return send(res, 501, { error: 'payments not configured' });
    const { paymentId, signature } = req.body || {};
    if (!paymentId || !signature) return send(res, 400, { error: 'paymentId and signature required' });
    const r = await payments.verify(String(paymentId), String(signature));
    send(res, r.ok ? 200 : 402, r);
  } catch (e) { fail(res, e); }
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
