export const BATCH_MAX_BYTES = 1024 * 1024 * 1024;

export const BATCH_SUPPORTED_TYPES = Object.freeze([
  'image/',
  'video/',
  'application/json',
  'text/plain',
]);

const SUPPORTED_EXTENSIONS = new Set([
  'avif', 'gif', 'jpeg', 'jpg', 'json', 'm4v', 'mov', 'mp4',
  'png', 'svg', 'txt', 'webm', 'webp',
]);

export class BatchValidationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'BatchValidationError';
    this.code = code;
    Object.assign(this, details);
  }
}

const textEncoder = new TextEncoder();

async function sha256Utf8Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function batchRelativePath(file) {
  const raw = String(
    file?.vesselRelativePath || file?.webkitRelativePath || file?.name || '',
  ).replaceAll('\\', '/');
  return raw
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

function canonicalBatchPayload(items) {
  return Object.freeze({
    version: 1,
    kind: 'vessel.batch.upload',
    items: items.map((item) => Object.freeze({
      relativePath: item.relativePath,
      fileHash: item.fileHash,
      blobName: item.blobName,
      sizeBytes: item.sizeBytes,
      contentType: item.contentType,
    })),
  });
}

export async function createBatchUploadManifest(items, {
  sha256FileHex,
  contentAddressedBlobName,
} = {}) {
  if (!Array.isArray(items) || !items.length) {
    throw new BatchValidationError('Batch manifest requires at least one file', 'batch_empty');
  }
  if (typeof sha256FileHex !== 'function') throw new TypeError('sha256FileHex is required');
  if (typeof contentAddressedBlobName !== 'function') throw new TypeError('contentAddressedBlobName is required');

  const prepared = [];
  for (const item of items) {
    const file = item.file || item;
    const relativePath = String(item.relativePath || batchRelativePath(file));
    const fileHash = String(item.fileHash || await sha256FileHex(file)).toLowerCase();
    const blobName = String(item.blobName || contentAddressedBlobName(file, fileHash));
    const sizeBytes = Number(item.sizeBytes || item.size || file.size);
    if (!relativePath || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new BatchValidationError('Invalid batch manifest item', 'batch_manifest_invalid', { relativePath });
    }
    prepared.push(Object.freeze({
      id: item.id || relativePath,
      file,
      relativePath,
      fileHash,
      blobName,
      sizeBytes,
      contentType: file.type || item.contentType || 'application/octet-stream',
    }));
  }

  prepared.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, {
    numeric: true,
    sensitivity: 'base',
  }));
  const payload = canonicalBatchPayload(prepared);
  const canonicalJson = JSON.stringify(payload);
  const manifestHash = await sha256Utf8Hex(canonicalJson);
  const totalBytes = prepared.reduce((sum, item) => sum + item.sizeBytes, 0);
  const manifest = Object.freeze({
    ...payload,
    manifestHash,
    manifestJson: canonicalJson,
    totalBytes,
    virtualFile: Object.freeze({
      name: `${manifestHash}.vessel-batch.json`,
      type: 'application/vnd.vessel.batch-manifest+json',
      size: totalBytes,
    }),
    items: prepared,
  });
  return manifest;
}

function isSupported(file) {
  const type = String(file?.type || '').toLowerCase();
  if (BATCH_SUPPORTED_TYPES.some((allowed) => (
    allowed.endsWith('/') ? type.startsWith(allowed) : type === allowed
  ))) return true;
  const extension = String(file?.name || '').split('.').pop()?.toLowerCase() || '';
  return SUPPORTED_EXTENSIONS.has(extension);
}

function rejectionReason(file, maxFileBytes) {
  if (!Number.isFinite(file?.size) || file.size <= 0) return 'Empty files cannot be uploaded';
  if (file.size > maxFileBytes) {
    return `File exceeds the ${Math.floor(maxFileBytes / 1048576)} MB per-file limit`;
  }
  if (!isSupported(file)) return 'Unsupported file type';
  return '';
}

function toErrorDetails(error) {
  const code = String(error?.code || 'upload_failed');
  const recoveryRequired = new Set([
    'acknowledgement_timeout',
    'receipt_pending',
    'registration_evidence_missing',
  ]);
  return {
    message: String(error?.message || error || 'Upload failed').slice(0, 180),
    code,
    retryable: !recoveryRequired.has(code),
  };
}

export function createBatchQueue(files, {
  maxTotalBytes = BATCH_MAX_BYTES,
  maxFileBytes = Number.POSITIVE_INFINITY,
} = {}) {
  const rejected = [];
  const items = [];

  for (const [index, file] of [...(files || [])].entries()) {
    const relativePath = batchRelativePath(file);
    const reason = rejectionReason(file, maxFileBytes);
    if (reason) {
      rejected.push(Object.freeze({ file, relativePath, reason }));
      continue;
    }
    items.push({
      id: `batch-${index}-${relativePath}`,
      file,
      relativePath,
      size: Number(file.size),
      status: 'queued',
      error: null,
      result: null,
    });
  }

  if (!items.length) {
    throw new BatchValidationError('No supported non-empty files were selected', 'batch_empty', { rejected });
  }

  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  if (totalBytes > maxTotalBytes) {
    throw new BatchValidationError('Batch exceeds the 1 GB beta limit', 'batch_too_large', {
      limitBytes: maxTotalBytes,
      totalBytes,
    });
  }

  const find = (id) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new TypeError(`Unknown batch item: ${id}`);
    return item;
  };

  const transition = (id, status, details = {}) => {
    const item = find(id);
    item.status = status;
    Object.assign(item, details);
    return item;
  };

  return {
    items,
    rejected,
    totalBytes,
    next: () => items.find((item) => item.status === 'queued') || null,
    markUploading: (id) => transition(id, 'uploading', { error: null }),
    markSucceeded: (id, result) => transition(id, 'succeeded', { result, error: null }),
    markFailed: (id, error) => transition(id, 'failed', { error: toErrorDetails(error) }),
    retryFailed() {
      let count = 0;
      for (const item of items) {
        if (item.status !== 'failed' || item.error?.retryable === false) continue;
        transition(item.id, 'queued', { error: null });
        count += 1;
      }
      return count;
    },
    summary() {
      const count = (status) => items.filter((item) => item.status === status).length;
      const succeeded = count('succeeded');
      const failed = count('failed');
      const completedBytes = items
        .filter((item) => item.status === 'succeeded' || item.status === 'failed')
        .reduce((sum, item) => sum + item.size, 0);
      return {
        total: items.length,
        queued: count('queued'),
        uploading: count('uploading'),
        succeeded,
        failed,
        completed: succeeded + failed,
        totalBytes,
        completedBytes,
        progressPercent: totalBytes ? Math.round((completedBytes / totalBytes) * 100) : 0,
      };
    },
  };
}

export async function runBatchQueue(queue, uploadItem, { onUpdate } = {}) {
  if (!queue?.next || typeof uploadItem !== 'function') {
    throw new TypeError('A batch queue and upload function are required');
  }

  while (queue.next()) {
    const item = queue.next();
    queue.markUploading(item.id);
    onUpdate?.({ phase: 'uploading', item, summary: queue.summary() });
    try {
      const result = await uploadItem(item);
      queue.markSucceeded(item.id, result);
      onUpdate?.({ phase: 'succeeded', item, result, summary: queue.summary() });
    } catch (error) {
      queue.markFailed(item.id, error);
      onUpdate?.({ phase: 'failed', item, error, summary: queue.summary() });
      return Object.freeze({ status: 'paused', item, error, summary: queue.summary() });
    }
  }

  return Object.freeze({ status: 'complete', summary: queue.summary() });
}
