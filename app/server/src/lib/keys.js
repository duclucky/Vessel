import crypto from 'node:crypto';

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'application/json': 'json',
};

export function extForMime(mime) {
  return EXT_BY_MIME[mime] || 'bin';
}

/** Content-addressed key: <sha256>.<ext> — makes re-upload idempotent and sidesteps the
 *  Shelby 409-on-overwrite rule. Flat namespace → clean URLs /api/media/<sha>.<ext>. */
export function contentKey(data, mime) {
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  return `${sha}.${extForMime(mime)}`;
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));
export function mimeForKey(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}
