import { OverwriteConflictError, NotFoundError } from './types.js';
import { sha256Hex } from '../lib/keys.js';

/**
 * In-memory StorageProvider. Build against this first; it is the demo fallback and the
 * fast dev loop. Zero Shelby access — the full UI works with STORAGE_BACKEND=mock.
 * @implements {import('./types.js').StorageProvider}
 */
export class MockProvider {
  constructor({ publicBase }) {
    this.publicBase = publicBase; // e.g. http://localhost:8787
    /** @type {Map<string, {data: Uint8Array, contentType: string, createdAt: number, expiresAt: number, owner?: string, sha: string}>} */
    this.store = new Map();
  }

  name() { return 'mock'; }

  urlFor(key) { return `${this.publicBase}/api/media/${key}`; }

  async put(key, data, opts = {}) {
    const sha = sha256Hex(data);
    const existing = this.store.get(key);
    if (existing && existing.sha !== sha) throw new OverwriteConflictError();
    const contentType = opts.contentType || 'application/octet-stream';
    const expiresInSec = Number(opts.expiresInSec);
    if (!Number.isSafeInteger(expiresInSec) || expiresInSec <= 0) {
      throw new TypeError('expiresInSec is required for hot storage');
    }
    const expiresAt = Date.now() + expiresInSec * 1000;
    this.store.set(key, { data, contentType, createdAt: Date.now(), expiresAt, owner: opts.owner, sha });
    return { key, url: this.urlFor(key), size: data.length, contentType, etag: sha, expiresAt };
  }

  async get(key) {
    const e = this.store.get(key);
    if (!e) return null;
    return { data: e.data, contentType: e.contentType };
  }

  async list(prefix = '') {
    const items = [];
    for (const [key, e] of this.store) {
      if (prefix && !key.startsWith(prefix)) continue;
      items.push({ key, url: this.urlFor(key), size: e.data.length, contentType: e.contentType, createdAt: e.createdAt, expiresAt: e.expiresAt });
    }
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(key) {
    if (!this.store.has(key)) throw new NotFoundError();
    this.store.delete(key);
  }

  /** Times in-memory reads — near-zero; the panel labels this a mock backend. */
  async measureRead(key, samples = 20) {
    const times = [];
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      await this.get(key);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { medianMs: Math.round(times[Math.floor(samples / 2)]), minMs: Math.round(times[0]), p90Ms: Math.round(times[Math.floor(samples * 0.9)]), samples };
  }
}
