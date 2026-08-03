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

export function batchRelativePath(file) {
  const raw = String(file?.webkitRelativePath || file?.name || '').replaceAll('\\', '/');
  return raw
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
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
  return {
    message: String(error?.message || error || 'Upload failed').slice(0, 180),
    code: String(error?.code || 'upload_failed'),
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
        if (item.status !== 'failed') continue;
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
