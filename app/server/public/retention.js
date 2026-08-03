const DAY_MS = 86_400_000;
const HEX_64 = /^[0-9a-f]{64}$/;

export function normalizeRetentionDays(value) {
  if (value === '') {
    throw new RangeError('Storage duration must be an integer between 1 and 365 days');
  }
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new RangeError('Storage duration must be an integer between 1 and 365 days');
  }
  return days;
}

export function targetExpirationMicros({ serverTimeMs, days }) {
  const normalized = normalizeRetentionDays(days);
  if (!Number.isSafeInteger(serverTimeMs) || serverTimeMs <= 0) {
    throw new TypeError('Invalid quote server time');
  }
  return (serverTimeMs + normalized * DAY_MS) * 1_000;
}

export function createUploadIntent(input) {
  const days = normalizeRetentionDays(input.days);
  const fileHash = String(input.fileHash || '').toLowerCase();
  if (!HEX_64.test(fileHash)) throw new TypeError('Invalid SHA-256 file hash');
  if (!Number.isSafeInteger(input.file?.size) || input.file.size <= 0) {
    throw new TypeError('Invalid file size');
  }
  return Object.freeze({
    operation: 'upload',
    chain: input.session.chain,
    sourceAddress: input.session.sourceAddress,
    storageAddress: input.session.storageAddress,
    fileHash,
    blobName: String(input.blobName),
    sizeBytes: input.file.size,
    contentType: input.file.type || 'application/octet-stream',
    encoding: Number(input.encoding),
    days,
    expirationMicros: targetExpirationMicros({ serverTimeMs: input.serverTimeMs, days }),
  });
}
