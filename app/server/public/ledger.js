import { canonicalWalletAddress, normalizeAptosLikeAddress } from './address-utils.js';

export const LS = {
  addr: 'vessel_addr',
  sa: 'vessel_sa',
  verified: 'vessel_verified',
  sel: 'vessel_selected_key',
  mine: 'vessel_mine',
  collectionManifests: 'vessel_collection_manifests',
};

export const UPLOAD_HISTORY_LIMIT = 3000;

function resourceUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text).href;
  } catch {
    return text;
  }
}

function artifactOwner(item) {
  return canonicalWalletAddress(normalizeAptosLikeAddress(item?.storageAddress || item?.account));
}

function indexArtifact(map, owner, url, index) {
  if (!owner || !url) return;
  const key = `${owner}\u0000${url}`;
  const indexes = map.get(key) || new Set();
  indexes.add(index);
  map.set(key, indexes);
}

export function linkArtifactsToCollectionManifests(artifacts = [], manifests = []) {
  const linked = (Array.isArray(artifacts) ? artifacts : []).map((item) => ({ ...item }));
  const artifactsByUrl = new Map();
  const metadataByUrl = new Map();
  linked.forEach((item, index) => {
    const owner = artifactOwner(item);
    indexArtifact(artifactsByUrl, owner, resourceUrl(item?.url), index);
    for (const value of [item?.url, item?.tokenUri, item?.metadataUrl]) {
      indexArtifact(metadataByUrl, owner, resourceUrl(value), index);
    }
  });
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    const collectionId = String(manifest?.id || manifest?.name || '').trim();
    const collectionName = String(manifest?.name || collectionId);
    const owner = canonicalWalletAddress(normalizeAptosLikeAddress(manifest?.storageAddress));
    if (!collectionId || !owner) continue;
    for (const row of Array.isArray(manifest?.rows) ? manifest.rows : []) {
      const imageUrl = resourceUrl(row?.imageUrl);
      const metadataUrl = resourceUrl(row?.metadataUrl);
      if (!imageUrl || !metadataUrl) continue;
      const mediaMatches = [...(artifactsByUrl.get(`${owner}\u0000${imageUrl}`) || [])];
      const metadataMatches = [...(metadataByUrl.get(`${owner}\u0000${metadataUrl}`) || [])];
      if (mediaMatches.length !== 1 || metadataMatches.length !== 1) continue;
      const [mediaIndex] = mediaMatches;
      const [metadataIndex] = metadataMatches;
      linked[mediaIndex] = {
        ...linked[mediaIndex],
        collectionId,
        collectionName,
        tokenUri: metadataUrl,
        metadataUrl,
      };
      linked[metadataIndex] = {
        ...linked[metadataIndex],
        collectionId,
        collectionName,
        tokenUri: metadataUrl,
        metadataUrl,
        sourceArtifactKey: linked[mediaIndex].key,
        sourceArtifactUrl: imageUrl,
      };
    }
  }
  return linked;
}

export function createLedger(storage = globalThis.localStorage, now = Date.now) {
  function normalizeAddress(value) {
    return canonicalWalletAddress(value);
  }

  function loadMine() {
    try {
      const value = JSON.parse(storage.getItem(LS.mine) || '[]');
      return Array.isArray(value)
        ? linkArtifactsToCollectionManifests(value, loadAllCollectionManifests())
        : [];
    } catch {
      return [];
    }
  }

  function rememberMine(item) {
    const list = loadMine().filter((entry) => entry.key !== item.key);
    list.unshift(item);
    storage.setItem(LS.mine, JSON.stringify(list.slice(0, UPLOAD_HISTORY_LIMIT)));
  }

  function attachTokenUriToArtifact(key, tokenUri, options = {}) {
    const artifactKey = String(key || '').trim();
    const uri = String(tokenUri || '').trim();
    if (!artifactKey || !uri) throw new TypeError('Artifact key and TokenURI are required');
    const list = loadMine();
    const source = list.find((entry) => entry.key === artifactKey);
    const metadataKey = String(options?.metadataKey || options?.result?.key || '').trim();
    const sourceArtifactUrl = String(options?.mediaUrl || source?.url || '').trim();
    const metadataUrl = String(options?.metadataUrl || options?.result?.url || uri).trim();
    storage.setItem(LS.mine, JSON.stringify(list.map((entry) => {
      if (entry.key === artifactKey) {
        return { ...entry, tokenUri: uri, metadataUrl: uri, tokenUriUpdatedAt: now() };
      }
      if (metadataKey && entry.key === metadataKey) {
        return {
          ...entry,
          tokenUri: metadataUrl,
          metadataUrl,
          sourceArtifactKey: artifactKey,
          sourceArtifactUrl,
          sourceArtifactUpdatedAt: now(),
        };
      }
      return entry;
    }).slice(0, UPLOAD_HISTORY_LIMIT)));
  }

  function forgetMine(key) {
    storage.setItem(
      LS.mine,
      JSON.stringify(loadMine().filter((entry) => entry.key !== key)),
    );
  }

  function assignCustomFolder(keys, folderName) {
    const selectedKeys = new Set((Array.isArray(keys) ? keys : [keys])
      .map((key) => String(key || '').trim())
      .filter(Boolean));
    const customFolder = String(folderName || '').trim().replace(/\s+/g, ' ');
    if (!selectedKeys.size) throw new TypeError('At least one artifact key is required');
    if (!customFolder) throw new TypeError('A custom folder name is required');
    storage.setItem(LS.mine, JSON.stringify(loadMine().map((entry) => (
      selectedKeys.has(entry.key)
        ? { ...entry, customFolder, customFolderUpdatedAt: now() }
        : entry
    )).slice(0, UPLOAD_HISTORY_LIMIT)));
  }

  function replaceMine(items) {
    storage.setItem(LS.mine, JSON.stringify((Array.isArray(items) ? items : []).slice(0, UPLOAD_HISTORY_LIMIT)));
  }

  function loadAllCollectionManifests() {
    try {
      const value = JSON.parse(storage.getItem(LS.collectionManifests) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function loadCollectionManifests(storageAddress = '') {
    const owner = normalizeAddress(storageAddress);
    return loadAllCollectionManifests().filter((manifest) => normalizeAddress(manifest.storageAddress) === owner);
  }

  function rememberCollectionManifest(manifest) {
    const storageAddress = normalizeAptosLikeAddress(manifest?.storageAddress);
    const id = String(manifest?.id || manifest?.name || '').trim();
    if (!storageAddress || !id) throw new TypeError('Collection manifest requires an id and storage address');
    const next = {
      id,
      name: String(manifest?.name || id),
      storageAddress,
      rows: Array.isArray(manifest?.rows) ? manifest.rows.map((row) => ({
        itemName: String(row?.itemName || ''),
        sourcePath: String(row?.sourcePath || ''),
        imageUrl: String(row?.imageUrl || ''),
        metadataPath: String(row?.metadataPath || ''),
        metadataUrl: String(row?.metadataUrl || ''),
      })) : [],
      tokenUris: Array.isArray(manifest?.tokenUris) ? manifest.tokenUris.map(String).filter(Boolean) : [],
      updatedAt: now(),
    };
    const owner = normalizeAddress(storageAddress);
    const key = id.toLowerCase();
    const list = loadAllCollectionManifests().filter((entry) => !(
      normalizeAddress(entry.storageAddress) === owner && String(entry.id || '').toLowerCase() === key
    ));
    list.unshift(next);
    storage.setItem(LS.collectionManifests, JSON.stringify(list.slice(0, 100)));
  }

  function selected() {
    return {
      key: storage.getItem(LS.sel) || '',
      url: storage.getItem(`${LS.sel}_url`) || '',
    };
  }

  function selectArtifact({ key, url }) {
    if (!key) throw new TypeError('Artifact key is required');
    storage.setItem(LS.sel, String(key));
    storage.setItem(`${LS.sel}_url`, String(url || ''));
  }

  function commitUpload(result) {
    storage.setItem(LS.sel, result.key);
    storage.setItem(`${LS.sel}_url`, result.url);
    if (result.ownedByYou || result.authorizedByYou) {
      const expirationMicros = Number.isSafeInteger(result.expirationMicros)
        ? result.expirationMicros
        : Number.isSafeInteger(result.expiresAt)
          ? result.expiresAt * 1_000
          : 0;
      if (!Number.isSafeInteger(expirationMicros) || expirationMicros <= 0) {
        throw new TypeError('Authoritative Shelby expiration is required');
      }
      rememberMine({
        key: result.key,
        url: result.url,
        size: result.size,
        contentType: result.contentType || '',
        sourcePath: result.sourcePath || '',
        expiresAt: expirationMicros / 1_000,
        expirationMicros,
        account: normalizeAptosLikeAddress(result.account),
        storageAddress: normalizeAptosLikeAddress(result.storageAddress || result.account),
        ownedByYou: result.ownedByYou === true,
        authorizedByYou: result.authorizedByYou === true,
        paymentMode: result.paymentMode || '',
        paymentGroupId: result.paymentGroupId || '',
        state: 'active',
        registerTransactionHash: result.registerTransactionHash || result.transactionHash,
        acknowledgementHash: result.acknowledgementHash,
        paymentSignature: result.paymentSignature || result.settlementHash,
        quotedAccountingMicro: result.quotedAccountingMicro,
        storageCostAccountingMicro: result.storageCostAccountingMicro,
        gasAccountingMicro: result.gasAccountingMicro,
        serviceFeeAccountingMicro: result.serviceFeeAccountingMicro,
        totalAccountingMicro: result.totalAccountingMicro || result.quotedAccountingMicro,
        actualStorageUnits: result.actualStorageUnits,
        actualGasUsed: result.actualGasUsed,
        lastReconciledAt: result.lastReconciledAt || now(),
      });
    }
  }

  return {
    loadMine,
    rememberMine,
    attachTokenUriToArtifact,
    assignCustomFolder,
    replaceMine,
    forgetMine,
    loadCollectionManifests,
    rememberCollectionManifest,
    selected,
    selectArtifact,
    commitUpload,
  };
}
