const IMAGE_TYPE = /^image\//i;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function canonicalAddress(value) {
  const text = String(value || '').toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(text)) return text;
  return `0x${text.slice(2).replace(/^0+/, '') || '0'}`;
}

function safeSourcePath(value) {
  const parts = String(value || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

export function groupVaultCollections(artifacts, {
  storageAddress,
  now = Date.now(),
  verification = 'shelby',
} = {}) {
  const owner = canonicalAddress(storageAddress);
  if (!owner) return Object.freeze([]);

  const groups = new Map();
  const seenKeys = new Set();

  for (const artifact of artifacts || []) {
    const sourcePath = safeSourcePath(artifact?.sourcePath);
    const key = String(artifact?.key || '');
    if (!sourcePath || !key || seenKeys.has(key)) continue;
    if (canonicalAddress(artifact.storageAddress || artifact.account) !== owner) continue;
    if (!IMAGE_TYPE.test(String(artifact.contentType || ''))) continue;
    if (artifact.state !== 'active' || artifact.isWritten === false || artifact.isDeleted === true) continue;
    if (!Number.isFinite(Number(artifact.expiresAt)) || Number(artifact.expiresAt) <= now) continue;
    if (!String(artifact.url || '').trim()) continue;

    seenKeys.add(key);
    const name = sourcePath.split('/')[0];
    const id = name.toLowerCase();
    if (!groups.has(id)) groups.set(id, { id, name, items: [] });
    groups.get(id).items.push(Object.freeze({ ...artifact, sourcePath }));
  }

  const collections = [...groups.values()].map((group) => {
    group.items.sort((left, right) => collator.compare(left.sourcePath, right.sourcePath));
    return Object.freeze({
      id: group.id,
      name: group.name,
      items: Object.freeze(group.items),
      itemCount: group.items.length,
      totalBytes: group.items.reduce((sum, item) => sum + Number(item.size || 0), 0),
      earliestExpiry: Math.min(...group.items.map((item) => Number(item.expiresAt))),
      verification: verification === 'vault-cache' ? 'vault-cache' : 'shelby',
    });
  });

  collections.sort((left, right) => collator.compare(left.name, right.name));
  return Object.freeze(collections);
}

export function metadataFilesFromCollection(collection, { origin } = {}) {
  return Object.freeze((collection?.items || []).map((artifact) => Object.freeze({
    name: artifact.sourcePath.split('/').pop() || 'artifact.png',
    type: artifact.contentType,
    size: artifact.size,
    vesselRelativePath: artifact.sourcePath,
    url: new URL(artifact.url, origin).href,
    artifact,
  })));
}
