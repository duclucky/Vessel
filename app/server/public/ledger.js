export const LS = {
  addr: 'vessel_addr',
  sa: 'vessel_sa',
  verified: 'vessel_verified',
  sel: 'vessel_selected_key',
  mine: 'vessel_mine',
  collectionManifests: 'vessel_collection_manifests',
};

export const UPLOAD_HISTORY_LIMIT = 3000;

export function createLedger(storage = globalThis.localStorage, now = Date.now) {
  function normalizeAddress(value) {
    return String(value || '').toLowerCase();
  }

  function loadMine() {
    try {
      const value = JSON.parse(storage.getItem(LS.mine) || '[]');
      return Array.isArray(value) ? value : [];
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
    const storageAddress = String(manifest?.storageAddress || '');
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
    if (result.ownedByYou) {
      if (!Number.isSafeInteger(result.expirationMicros) || result.expirationMicros <= 0) {
        throw new TypeError('Authoritative Shelby expiration is required');
      }
      rememberMine({
        key: result.key,
        url: result.url,
        size: result.size,
        contentType: result.contentType || '',
        sourcePath: result.sourcePath || '',
        expiresAt: result.expirationMicros / 1_000,
        expirationMicros: result.expirationMicros,
        account: result.account,
        storageAddress: result.account,
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
    replaceMine,
    forgetMine,
    loadCollectionManifests,
    rememberCollectionManifest,
    selected,
    selectArtifact,
    commitUpload,
  };
}
