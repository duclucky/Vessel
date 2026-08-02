// The single seam every storage operation crosses. No route/component talks to
// @shelby-protocol/* or an S3 client directly — only through a StorageProvider.
// (See guides/03-conventions.md.)

/** @typedef {Object} PutOptions
 * @property {string} [contentType]
 * @property {number} [expiresInSec] Hot storage: blobs expire. Provider maps to expirationMicros.
 * @property {string} [owner] External wallet address this upload is attributed to.
 */

/** @typedef {Object} PutResult
 * @property {string} key
 * @property {string} url         Resolvable read URL (points at THIS server's /api/media proxy).
 * @property {number} size
 * @property {string} contentType
 * @property {string} [etag]      Shelby: merkle root, NOT MD5 — do not compare against a local MD5.
 * @property {number} [expiresAt] ms epoch
 */

/** @typedef {Object} BlobRef
 * @property {string} key
 * @property {string} url
 * @property {number} [size]
 * @property {string} [contentType]
 * @property {number} [createdAt]
 * @property {number} [expiresAt]
 */

/** @typedef {Object} StorageProvider
 * @property {() => string} name
 * @property {(key: string, data: Uint8Array, opts?: PutOptions) => Promise<PutResult>} put
 * @property {(key: string) => Promise<{ data: Uint8Array, contentType: string } | null>} get
 * @property {(prefix?: string) => Promise<BlobRef[]>} list
 * @property {(key: string) => Promise<void>} delete
 */

export class OverwriteConflictError extends Error {
  constructor(msg = 'Different content already exists at this key') {
    super(msg);
    this.name = 'OverwriteConflictError';
    this.code = 'overwrite_conflict';
    this.status = 409;
  }
}
export class UpstreamUnavailableError extends Error {
  constructor(msg = 'Storage backend is warming up, retry shortly') {
    super(msg);
    this.name = 'UpstreamUnavailableError';
    this.code = 'upstream_unavailable';
    this.status = 503;
    this.retriable = true;
  }
}
export class NotFoundError extends Error {
  constructor(msg = 'Not found') {
    super(msg);
    this.name = 'NotFoundError';
    this.code = 'not_found';
    this.status = 404;
  }
}
