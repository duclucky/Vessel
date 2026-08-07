import crypto from 'node:crypto';
import {
  ShelbyBlobClient,
  createDefaultErasureCodingProvider,
  generateCommitments,
} from '@shelby-protocol/sdk/node';

const TOKEN_PREFIX = 'vupload';
const DEFAULT_TTL_MS = 60 * 60_000;
const ADDRESS = /^0x[0-9a-f]{64}$/i;
const UPLOAD_ID = /^[A-Za-z0-9_-]{1,200}$/;
const UINT_DECIMAL = /^[0-9]+$/;

const gatewayError = (message, code, status) => Object.assign(
  new Error(message),
  { code, status, retriable: status >= 500 },
);

function normalizeWalletArgument(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => normalizeWalletArgument(item));
  if (
    value
    && typeof value === 'object'
    && Object.hasOwn(value, 'value')
    && (
      typeof value.value === 'number'
      || typeof value.value === 'bigint'
      || typeof value.value === 'string'
    )
  ) {
    return normalizeWalletArgument(value.value);
  }
  return value;
}

function normalizeWalletPayload(payload) {
  return Object.freeze({
    ...payload,
    functionArguments: Array.isArray(payload?.functionArguments)
      ? payload.functionArguments.map((value) => normalizeWalletArgument(value))
      : payload?.functionArguments,
  });
}

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
    rpcClient,
    createProvider = createDefaultErasureCodingProvider,
    generateCommitmentsImpl = generateCommitments,
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
    this.rpcClient = rpcClient;
    this.createProvider = createProvider;
    this.generateCommitments = generateCommitmentsImpl;
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
        || !UINT_DECIMAL.test(String(payload.registrationUid || ''))
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

  async start({
    account,
    blobName,
    totalBytes,
    partSize,
    registrationUid,
    blobMerkleRoot,
  }) {
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
    if (!UINT_DECIMAL.test(String(registrationUid || ''))) {
      throw gatewayError('Invalid Shelby registration uid', 'invalid_registration_uid', 400);
    }
    const uploadId = crypto.randomUUID();
    const issuedAtMs = this.now();
    return Object.freeze({
      uploadId,
      partSize,
      uploadToken: this.issue({
        v: 1,
        id: uploadId,
        account: normalizedAccount,
        blobName: normalizedBlobName,
        registrationUid: String(registrationUid),
        blobMerkleRoot: String(blobMerkleRoot || ''),
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
    if (totalParts !== 1 || partIdx !== 0 || bytes.byteLength !== scope.totalBytes) {
      throw gatewayError('Vessel currently requires a single complete upload part', 'invalid_upload_part', 400);
    }
    if (!this.rpcClient?.putBlobChunksets) {
      throw gatewayError('Shelby v2 upload client is unavailable', 'shelby_upload_failed', 503);
    }
    const provider = await this.createProvider();
    const commitments = await this.generateCommitments(provider, bytes);
    if (scope.blobMerkleRoot && commitments.blob_merkle_root !== scope.blobMerkleRoot) {
      throw gatewayError('Upload bytes do not match the registered Shelby commitment', 'blob_commitment_mismatch', 409);
    }
    const result = await this.rpcClient.putBlobChunksets({
      accountAddress: scope.account,
      uid: scope.registrationUid,
      blobData: bytes,
      commitments,
      totalBytes: scope.totalBytes,
    });
    return Object.freeze({
      uploadedBytes: bytes.byteLength,
      spAcks: result?.spAcks || [],
    });
  }

  async complete({ uploadId, uploadToken, spAcks }) {
    const scope = this.validate(uploadToken, String(uploadId || ''));
    if (!Array.isArray(spAcks) || spAcks.length === 0) {
      throw gatewayError('Storage provider acknowledgements are required', 'missing_storage_acks', 400);
    }
    return Object.freeze({
      commitPayload: normalizeWalletPayload(ShelbyBlobClient.createCommitObjectPayload({
        uid: scope.registrationUid,
        blobName: scope.blobName,
        overwrite: true,
        storageProviderAcks: spAcks,
      })),
    });
  }
}
