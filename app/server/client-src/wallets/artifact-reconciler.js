const canonicalAddress = (value) => {
  const text = String(value?.toString?.() ?? value ?? '').trim().toLowerCase();
  const hex = text.replace(/^@/, '').replace(/^0x/, '');
  if (!/^[0-9a-f]+$/.test(hex)) return text;
  return `0x${hex.replace(/^0+/, '') || '0'}`;
};

const remoteKey = (item) => String(item.blobNameSuffix || item.name || '');

const CONTENT_TYPE_BY_EXTENSION = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  json: 'application/json',
});

const inferContentType = (key) => {
  const extension = String(key).split('.').pop()?.toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream';
};

export function reconcileArtifacts(local = [], remote = [], walletIdentity = {}, now = Date.now) {
  const storageAddress = canonicalAddress(walletIdentity.storageAddress);
  const scopedLocal = local.filter((item) => (
    canonicalAddress(item.storageAddress || item.account) === storageAddress
  ));
  const localByKey = new Map(scopedLocal.map((item) => [item.key, item]));
  const remoteItems = remote
    .filter((item) => canonicalAddress(item.owner) === storageAddress)
    .map((item) => {
      const key = remoteKey(item);
      const cached = localByKey.get(key) || {};
      return Object.freeze({
        ...cached,
        key,
        name: item.name || key,
        url: item.url || cached.url || '',
        storageAddress: String(item.owner?.toString?.() ?? item.owner),
        account: String(item.owner?.toString?.() ?? item.owner),
        size: Number(item.size || 0),
        contentType: item.contentType || cached.contentType || inferContentType(key),
        encoding: item.encoding,
        createdAt: Number(item.creationMicros) / 1_000,
        expiresAt: Number(item.expirationMicros) / 1_000,
        expirationMicros: Number(item.expirationMicros),
        isWritten: Boolean(item.isWritten),
        isDeleted: Boolean(item.isDeleted),
        state: item.isDeleted ? 'deleted' : item.isWritten ? 'active' : 'finalizing',
        lastReconciledAt: Date.now(),
      });
    });
  const remoteKeys = new Set(remoteItems.map((item) => item.key));
  const authorizedServiceItems = scopedLocal.filter((item) => (
    item.authorizedByYou === true
    && item.ownedByYou !== true
    && item.state !== 'deleted'
    && item.isDeleted !== true
    && Number(item.expiresAt) > now()
    && !remoteKeys.has(item.key)
  ));
  return [...remoteItems, ...authorizedServiceItems];
}
