const SHA256_HEX = /^[a-f0-9]{64}$/i;

export async function sha256FileHex(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw Object.assign(new TypeError('A File or Blob is required'), { code: 'file_required' });
  }
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createFileHashCache(hashFile = sha256FileHex) {
  const cache = new WeakMap();
  return function cachedFileHash(file) {
    if (!file || (typeof file !== 'object' && typeof file !== 'function')) {
      return Promise.reject(Object.assign(new TypeError('A File or Blob is required'), { code: 'file_required' }));
    }
    let pending = cache.get(file);
    if (!pending) {
      pending = Promise.resolve().then(() => hashFile(file));
      cache.set(file, pending);
      pending.catch(() => {
        if (cache.get(file) === pending) cache.delete(file);
      });
    }
    return pending;
  };
}

export function contentAddressedBlobName(file, fileHash) {
  if (!SHA256_HEX.test(String(fileHash || ''))) {
    throw Object.assign(new Error('A valid SHA-256 hash is required'), { code: 'content_hash_invalid' });
  }
  const parts = String(file?.name || '').split('.');
  const rawExtension = parts.length > 1 ? parts.pop() : 'bin';
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `media/${String(fileHash).toLowerCase()}.${extension}`;
}

export function vesselBlobUrl({ origin, storageAddress, blobName } = {}) {
  const account = String(storageAddress || '').trim();
  const segments = String(blobName || '').split('/');
  if (!account || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw Object.assign(new Error('Storage address and blob name are required'), { code: 'blob_url_invalid' });
  }
  const base = new URL(origin);
  const encodedPath = segments.map(encodeURIComponent).join('/');
  return new URL(`/api/shelby/blobs/${encodeURIComponent(account)}/${encodedPath}`, base).href;
}
