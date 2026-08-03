import crypto from 'node:crypto';

const TOKEN_PREFIX = 'vupload';
const DEFAULT_TTL_MS = 60 * 60_000;
const ADDRESS = /^0x[0-9a-f]{64}$/i;
const UPLOAD_ID = /^[A-Za-z0-9_-]{1,200}$/;

const gatewayError = (message, code, status) => Object.assign(
  new Error(message),
  { code, status, retriable: status >= 500 },
);

function cleanBlobName(value) {
  const name = String(value || '');
  if (!name || name.startsWith('/') || name.includes('..') || name.includes('//')) {
    throw gatewayError('Invalid Shelby blob name', 'invalid_blob_name', 400);
  }
  return name;
}

export class ShelbyUploadGateway {
  constructor({
    apiKey,
    rpcBaseUrl,
    secret,
    fetchImpl = fetch,
    now = Date.now,
    ttlMs = DEFAULT_TTL_MS,
    maxPartBytes = 3 * 1024 * 1024,
  } = {}) {
    if (!apiKey) throw new TypeError('Shelby API key is required');
    if (!rpcBaseUrl) throw new TypeError('Shelby RPC base URL is required');
    if (!secret) throw new TypeError('Upload token secret is required');
    this.apiKey = String(apiKey);
    this.rpcBaseUrl = String(rpcBaseUrl).replace(/\/$/, '');
    this.secret = Buffer.from(String(secret));
    this.fetch = fetchImpl;
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxPartBytes = maxPartBytes;
  }

  sign(encoded) {
    return crypto.createHmac('sha256', this.secret)
      .update(`${TOKEN_PREFIX}.${encoded}`)
      .digest('base64url');
  }

  issue(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${TOKEN_PREFIX}.${encoded}.${this.sign(encoded)}`;
  }

  validate(uploadToken, expectedUploadId) {
    try {
      const parts = String(uploadToken || '').split('.');
      if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) throw new Error();
      const expected = Buffer.from(this.sign(parts[1]));
      const actual = Buffer.from(parts[2]);
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error();
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (
        payload.v !== 1
        || payload.id !== expectedUploadId
        || !UPLOAD_ID.test(payload.id)
        || !ADDRESS.test(payload.account)
        || !Number.isSafeInteger(payload.partSize)
        || !Number.isSafeInteger(payload.totalBytes)
        || !Number.isSafeInteger(payload.exp)
        || this.now() >= payload.exp
      ) throw new Error();
      cleanBlobName(payload.blobName);
      return Object.freeze(payload);
    } catch {
      throw gatewayError('Invalid or expired upload token', 'invalid_upload_token', 401);
    }
  }

  async upstream(path, options) {
    const response = await this.fetch(`${this.rpcBaseUrl}${path}`, {
      ...options,
      headers: {
        ...options?.headers,
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw gatewayError(
        `Shelby RPC rejected the upload (${response.status})${body ? `: ${body.slice(0, 240)}` : ''}`,
        'shelby_upload_failed',
        502,
      );
    }
    return response;
  }

  async start({ account, blobName, totalBytes, partSize }) {
    const normalizedAccount = String(account || '').toLowerCase();
    const normalizedBlobName = cleanBlobName(blobName);
    if (!ADDRESS.test(normalizedAccount)) {
      throw gatewayError('Invalid Shelby account', 'invalid_storage_address', 400);
    }
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
      throw gatewayError('Invalid upload size', 'invalid_upload_size', 400);
    }
    if (
      !Number.isSafeInteger(partSize)
      || partSize <= 0
      || partSize > this.maxPartBytes
    ) {
      throw gatewayError('Invalid upload part size', 'invalid_upload_part_size', 400);
    }
    const response = await this.upstream('/v1/multipart-uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawAccount: normalizedAccount,
        rawBlobName: normalizedBlobName,
        rawPartSize: partSize,
      }),
    });
    const json = await response.json();
    const uploadId = String(json?.uploadId || '');
    if (!UPLOAD_ID.test(uploadId)) {
      throw gatewayError('Shelby RPC returned an invalid upload id', 'shelby_upload_failed', 502);
    }
    const issuedAtMs = this.now();
    return Object.freeze({
      uploadId,
      partSize,
      uploadToken: this.issue({
        v: 1,
        id: uploadId,
        account: normalizedAccount,
        blobName: normalizedBlobName,
        totalBytes,
        partSize,
        iat: issuedAtMs,
        exp: issuedAtMs + this.ttlMs,
      }),
    });
  }

  async putPart({ uploadId, partIdx, data, uploadToken }) {
    const scope = this.validate(uploadToken, String(uploadId || ''));
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
    const totalParts = Math.ceil(scope.totalBytes / scope.partSize);
    if (!Number.isSafeInteger(partIdx) || partIdx < 0 || partIdx >= totalParts) {
      throw gatewayError('Invalid upload part index', 'invalid_upload_part', 400);
    }
    if (bytes.byteLength <= 0 || bytes.byteLength > scope.partSize || bytes.byteLength > this.maxPartBytes) {
      throw gatewayError('Upload part is too large', 'upload_part_too_large', 413);
    }
    await this.upstream(`/v1/multipart-uploads/${encodeURIComponent(scope.id)}/parts/${partIdx}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
  }

  async complete({ uploadId, uploadToken }) {
    const scope = this.validate(uploadToken, String(uploadId || ''));
    await this.upstream(`/v1/multipart-uploads/${encodeURIComponent(scope.id)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
