export const LS = {
  addr: 'vessel_addr',
  sa: 'vessel_sa',
  verified: 'vessel_verified',
  sel: 'vessel_selected_key',
  mine: 'vessel_mine',
};

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
    storage.setItem(LS.mine, JSON.stringify(list.slice(0, 60)));
  }

  function forgetMine(key) {
    storage.setItem(
      LS.mine,
      JSON.stringify(loadMine().filter((entry) => entry.key !== key)),
    );
  }

  function selected() {
    return {
      key: storage.getItem(LS.sel) || '',
      url: storage.getItem(`${LS.sel}_url`) || '',
    };
  }

  function commitUpload(result) {
    storage.setItem(LS.sel, result.key);
    storage.setItem(`${LS.sel}_url`, result.url);
    if (result.ownedByYou) {
      rememberMine({
        key: result.key,
        url: result.url,
        size: result.size,
        contentType: result.contentType || '',
        expiresAt: now() + 7 * 24 * 3600 * 1000,
        account: result.account,
      });
    }
  }

  return { loadMine, rememberMine, forgetMine, selected, commitUpload };
}
