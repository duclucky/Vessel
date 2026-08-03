export const LS = {
  addr: 'vessel_addr',
  sa: 'vessel_sa',
  verified: 'vessel_verified',
  sel: 'vessel_selected_key',
  mine: 'vessel_mine',
};

export const UPLOAD_HISTORY_LIMIT = 3000;

export function createLedger(storage = globalThis.localStorage, now = Date.now) {
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

  function forgetMine(key) {
    storage.setItem(
      LS.mine,
      JSON.stringify(loadMine().filter((entry) => entry.key !== key)),
    );
  }

  function replaceMine(items) {
    storage.setItem(LS.mine, JSON.stringify((Array.isArray(items) ? items : []).slice(0, UPLOAD_HISTORY_LIMIT)));
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
        actualStorageUnits: result.actualStorageUnits,
        actualGasUsed: result.actualGasUsed,
        lastReconciledAt: result.lastReconciledAt || now(),
      });
    }
  }

  return { loadMine, rememberMine, replaceMine, forgetMine, selected, selectArtifact, commitUpload };
}
