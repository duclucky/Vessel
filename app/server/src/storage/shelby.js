import { Shelby } from '@shelby-protocol/solana-kit/node';
import { isBlobAlreadyExistsError } from '@shelby-protocol/sdk/node';
import { Network } from '@aptos-labs/ts-sdk';
import { Connection, Keypair } from '@solana/web3.js';
import { OverwriteConflictError, UpstreamUnavailableError, NotFoundError } from './types.js';
import { mimeForKey } from '../lib/keys.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Real StorageProvider backed by Shelby via Solana Derived Account Abstraction.
 * A Solana keypair controls the Aptos storage account that owns every blob.
 * Runtime selection is injected so Aptos Testnet can remain available while ShelbyNet is live.
 * @implements {import('./types.js').StorageProvider}
 */
export class ShelbyProvider {
  constructor({ apiKey, solanaSecretKey, domain = 'vessel.demo', publicBase, runtime }) {
    if (!solanaSecretKey) throw new Error('ShelbyProvider requires SHELBY_SOLANA_SECRET_KEY');
    this.apiKey = apiKey;
    this.publicBase = publicBase;
    this.domain = domain;
    this.runtime = runtime || {
      aptosNetwork: Network.TESTNET,
      rpcBaseUrl: 'https://api.testnet.shelby.xyz/shelby',
      name: 'testnet',
    };
    const secret = Uint8Array.from(JSON.parse(solanaSecretKey));
    this.keypair = Keypair.fromSecretKey(secret);
    this.client = new Shelby({
      network: this.runtime.aptosNetwork,
      connection: new Connection('https://api.devnet.solana.com'), // Solana side (unused for storage)
      apiKey: apiKey || undefined,
      rpc: {
        baseUrl: this.runtime.rpcBaseUrl,
        apiKey: apiKey || undefined,
      },
    });
    this.account = this.client.createStorageAccount(this.keypair, domain);
    this.address = this.account.accountAddress;
    this.index = new Map();
  }

  name() { return 'shelby'; }
  urlFor(key) { return `${this.publicBase}/api/media/${key}`; }
  rawReadUrl(key) { return `${this.runtime.rpcBaseUrl}/v1/blobs/${this.address.toString()}/${key}`; }

  async health() {
    try {
      const apt = await this.client.aptos.getAccountAPTAmount({ accountAddress: this.address });
      return { ok: apt >= 10_000_000, network: this.runtime.name, chain: 'solana-DAA', account: this.address.toString(), solana: this.keypair.publicKey.toBase58(), aptOctas: apt };
    } catch (e) {
      return { ok: false, network: this.runtime.name, account: this.address.toString(), error: String(e?.message || e).slice(0, 120) };
    }
  }

  async put(key, data, opts = {}) {
    const contentType = opts.contentType || mimeForKey(key);
    const expirationMicros = Date.now() * 1000 + (opts.expiresInSec ?? 7 * 24 * 3600) * 1_000_000;
    let lastErr;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await this.client.upload({ blobData: data, signer: this.account, blobName: key, expirationMicros });
        break; // testnet contract: no location arg
      } catch (e) {
        const msg = String(e?.message || e);
        if (isBlobAlreadyExistsError?.(msg)) break;
        lastErr = e;
        if (msg.includes('ABORTED') || msg.includes('4016') || msg.includes('upstream') || msg.includes('429')) {
          if (attempt === 5) throw new UpstreamUnavailableError();
          await sleep(1500 * attempt);
          continue;
        }
        throw e;
      }
    }
    const expiresAt = Math.floor(expirationMicros / 1000);
    this.index.set(key, { size: data.length, contentType, createdAt: Date.now(), expiresAt, owner: opts.owner });
    return { key, url: this.urlFor(key), size: data.length, contentType, expiresAt };
  }

  async get(key) {
    try {
      const blob = await this.client.download({ account: this.address, blobName: key });
      const reader = blob.readable.getReader();
      const chunks = []; let n = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); n += value.length; }
      return { data: new Uint8Array(Buffer.concat(chunks, n)), contentType: this.index.get(key)?.contentType || mimeForKey(key) };
    } catch (e) {
      const msg = String(e?.message || e).toLowerCase();
      if (msg.includes('not found') || msg.includes('notfound') || msg.includes('404')) return null;
      throw e;
    }
  }

  async measureRead(key, samples = 20) {
    const url = this.rawReadUrl(key);
    const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
    const times = [];
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      const res = await fetch(url, { headers });
      await res.arrayBuffer();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const at = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
    return { medianMs: Math.round(at(0.5)), minMs: Math.round(times[0]), p90Ms: Math.round(at(0.9)), samples };
  }

  async list(prefix = '') {
    const out = [];
    for (const [key, m] of this.index) {
      if (prefix && !key.startsWith(prefix)) continue;
      out.push({ key, url: this.urlFor(key), size: m.size, contentType: m.contentType, createdAt: m.createdAt, expiresAt: m.expiresAt });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(key) {
    try { await this.client.coordination.deleteBlob({ account: this.account, blobName: key }); } catch {}
    if (!this.index.delete(key)) throw new NotFoundError();
  }
}
