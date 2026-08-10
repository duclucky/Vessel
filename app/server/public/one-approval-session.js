export const APTOS_UPLOAD_NONCE = 'vessel-upload-session';

export function oneApprovalMessage({ intent, quote }) {
  return [
    'VESSEL_UPLOAD_SESSION',
    `Chain: ${intent.chain}`,
    `Source: ${intent.sourceAddress}`,
    `Storage: ${intent.storageAddress}`,
    `FileHash: ${intent.fileHash}`,
    `BlobName: ${intent.blobName}`,
    `SizeBytes: ${intent.sizeBytes}`,
    `RetentionDays: ${intent.days}`,
    `ExpirationMicros: ${intent.expirationMicros}`,
    `MaxAccountingMicro: ${quote.totalAccountingMicro}`,
    `QuoteId: ${quote.quoteId}`,
    `QuoteExpiresAtMs: ${quote.expiresAtMs}`,
  ].join('\n');
}

export function oneApprovalBatchMessage({ intent, quote, manifest }) {
  return [
    'VESSEL_BATCH_UPLOAD_SESSION',
    `Chain: ${intent.chain}`,
    `Source: ${intent.sourceAddress}`,
    `Storage: ${intent.storageAddress}`,
    `ManifestHash: ${manifest.manifestHash}`,
    `ItemCount: ${manifest.items.length}`,
    `TotalSizeBytes: ${manifest.totalBytes}`,
    `RetentionDays: ${intent.days}`,
    `ExpirationMicros: ${intent.expirationMicros}`,
    `MaxAccountingMicro: ${quote.totalAccountingMicro}`,
    `QuoteId: ${quote.quoteId}`,
    `QuoteExpiresAtMs: ${quote.expiresAtMs}`,
  ].join('\n');
}

export function parseAptosSignedMessage({ signedMessage, canonicalMessage }) {
  const value = String(signedMessage || '');
  const expected = String(canonicalMessage || '');
  const messageMarker = '\nmessage: ';
  const nonceMarker = '\nnonce: ';
  const messageStart = value.indexOf(messageMarker);
  const nonceStart = value.lastIndexOf(nonceMarker);
  if (
    !value.startsWith('APTOS\n')
    || !expected
    || messageStart < 0
    || nonceStart <= messageStart
  ) {
    return Object.freeze({ valid: false, nonce: '' });
  }
  const embeddedMessage = value.slice(messageStart + messageMarker.length, nonceStart);
  const nonce = value.slice(nonceStart + nonceMarker.length);
  return Object.freeze({
    valid: embeddedMessage === expected && nonce === APTOS_UPLOAD_NONCE,
    nonce,
  });
}
