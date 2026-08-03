const TRUSTED_MEDIA_PATHS = [
  /^\/api\/media\/.+/,
  /^\/api\/shelby\/blobs\/.+/,
];

export class MetadataSourceError extends Error {
  constructor(message, { status, code }) {
    super(message);
    this.name = 'MetadataSourceError';
    this.status = status;
    this.code = code;
  }
}

function invalidSource() {
  return new MetadataSourceError('Invalid metadata image source', {
    status: 400,
    code: 'invalid_metadata_source',
  });
}

function unavailableSource() {
  return new MetadataSourceError('Source artifact is unavailable. Choose another artifact from your Vault.', {
    status: 422,
    code: 'metadata_source_unavailable',
  });
}

function encodedKeyPath(imageKey) {
  return String(imageKey || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function resolveMetadataImageUrl({ imageUrl, imageKey, publicBase }) {
  let base;
  try {
    base = new URL(publicBase);
  } catch {
    throw invalidSource();
  }
  if (!['http:', 'https:'].includes(base.protocol)) throw invalidSource();

  const submitted = String(imageUrl || '').trim();
  const keyPath = encodedKeyPath(imageKey);
  if (!submitted && !keyPath) throw invalidSource();

  let resolved;
  try {
    resolved = submitted
      ? new URL(submitted, base)
      : new URL(`/api/media/${keyPath}`, base);
  } catch {
    throw invalidSource();
  }

  if (
    !['http:', 'https:'].includes(resolved.protocol)
    || resolved.origin !== base.origin
    || resolved.username
    || resolved.password
    || !TRUSTED_MEDIA_PATHS.some((pattern) => pattern.test(resolved.pathname))
  ) {
    throw invalidSource();
  }

  return resolved.href;
}

export async function assertMetadataImageAvailable({ imageUrl, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(imageUrl, { headers: { Range: 'bytes=0-0' } });
  } catch {
    throw unavailableSource();
  }
  const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
  if (!response?.ok || !contentType.startsWith('image/')) throw unavailableSource();
}
