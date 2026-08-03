const canonicalAddress = (value) => {
  const text = String(value?.toString?.() ?? value ?? '').toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(text)) return text;
  return `0x${text.slice(2).replace(/^0+/, '') || '0'}`;
};

const remoteKey = (item) => String(item.blobNameSuffix || item.name || '');

export function reconcileArtifacts(local = [], remote = [], walletIdentity = {}) {
  const storageAddress = canonicalAddress(walletIdentity.storageAddress);
  const scopedLocal = local.filter((item) => (
    canonicalAddress(item.storageAddress || item.account) === storageAddress
  ));
  const localByKey = new Map(scopedLocal.map((item) => [item.key, item]));
  return remote
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
}
