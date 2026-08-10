import { groupVaultCollections as defaultGroupVaultCollections } from './vault-collections.js';
import {
  buildAptosDigitalAssetRows,
  buildContractUri,
  buildErc1155Rows,
  buildErc721Rows,
  buildLaunchItems,
  buildSolanaCoreRows,
  buildSolanaTokenMetadataRows,
  defaultLaunchProfile,
  rowsToCsv,
} from './launch-kit.js';
import { validateLaunchKit } from './launch-kit-validator.js';
import { buildLaunchOutputs, launchPackageFileName } from './launch-kit-export.js';

const TARGETS = Object.freeze([
  ['evmErc721', 'Ethereum ERC-721', 'tokenURI rows for standard ERC-721 contracts'],
  ['evmErc1155', 'Ethereum ERC-1155', 'Decimal and {id} hex URI handoff'],
  ['solanaCore', 'Solana Metaplex Core', 'Asset rows for Core launch tooling'],
  ['solanaTokenMetadata', 'Solana Token Metadata', 'Legacy Metaplex handoff rows'],
  ['aptosDigitalAsset', 'Aptos Digital Asset', 'Collection and token URI rows'],
]);

function text(value) {
  return String(value ?? '').trim();
}

function storageAddressFromState(state) {
  return text(state?.session?.storageAddress || state?.storageAddress || state?.address || '');
}

function byId(document, id) {
  return document.getElementById(id);
}

function element(document, tag, className = '', textContent = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
}

function formValue(form, name) {
  const field = form?.elements?.[name];
  return text(field?.value);
}

function setFormValue(form, name, value) {
  const field = form?.elements?.[name];
  if (field && !field.value) field.value = value ?? '';
}

function profileFromForm(form, defaults, targets) {
  const royaltyRaw = formValue(form, 'royaltyPercent');
  return {
    ...defaults,
    collectionName: formValue(form, 'collectionName') || defaults.collectionName,
    symbol: formValue(form, 'symbol') || defaults.symbol,
    description: formValue(form, 'description') || defaults.description,
    creatorWallet: formValue(form, 'creatorWallet') || defaults.creatorWallet,
    royaltyPercent: royaltyRaw === '' ? defaults.royaltyPercent : Number(royaltyRaw),
    externalLink: formValue(form, 'externalLink') || defaults.externalLink,
    avatarImageUrl: formValue(form, 'avatarImageUrl') || defaults.avatarImageUrl,
    bannerImageUrl: formValue(form, 'bannerImageUrl') || defaults.bannerImageUrl,
    featuredImageUrl: formValue(form, 'featuredImageUrl') || defaults.featuredImageUrl,
    tokenIdStart: Number(formValue(form, 'tokenIdStart') || defaults.tokenIdStart || 1),
    targets,
  };
}

function downloadText(document, downloadBlob, fileName, content, type) {
  downloadBlob(new Blob([content], { type }), fileName, document);
}

function issueTone(severity) {
  if (severity === 'error') return 'border-error/40 text-error';
  if (severity === 'warning') return 'border-secondary/30 text-secondary';
  return 'border-primary-container/25 text-primary-container';
}

function targetRows(profile, items) {
  return Object.freeze({
    evmErc721: buildErc721Rows(profile, items),
    evmErc1155: buildErc1155Rows(profile, items),
    solanaCore: buildSolanaCoreRows(profile, items),
    solanaTokenMetadata: buildSolanaTokenMetadataRows(profile, items),
    aptosDigitalAsset: buildAptosDigitalAssetRows(profile, items),
  });
}

function previewTitle(key) {
  return ({
    evmErc721: 'Ethereum ERC-721',
    evmErc1155: 'Ethereum ERC-1155',
    solanaCore: 'Solana Metaplex Core',
    solanaTokenMetadata: 'Solana Token Metadata',
    aptosDigitalAsset: 'Aptos Digital Asset',
  })[key] || key;
}

function previewFileName(key) {
  return ({
    evmErc721: 'erc721-tokenuris.csv',
    evmErc1155: 'erc1155-tokenuris.csv',
    solanaCore: 'metaplex-core-assets.csv',
    solanaTokenMetadata: 'token-metadata-assets.csv',
    aptosDigitalAsset: 'digital-asset-tokens.csv',
  })[key] || `${key}.csv`;
}

function csvSample(rows) {
  return rowsToCsv(rows).split('\r\n').slice(0, 4).join('\n');
}

export function initLaunchKitPage({
  document = globalThis.document,
  location = globalThis.location,
  ledger,
  getWalletState = () => ({}),
  groupVaultCollections = defaultGroupVaultCollections,
  notify = () => {},
  downloadBlob,
} = {}) {
  const walletStatus = byId(document, 'launch-wallet-status');
  const storageAddressEl = byId(document, 'launch-storage-address');
  const collectionList = byId(document, 'launch-collection-list');
  const form = byId(document, 'launch-profile-form');
  const targetsEl = byId(document, 'launch-targets');
  const validationEl = byId(document, 'launch-validation');
  const previewEl = byId(document, 'launch-output-preview');
  const packageButton = byId(document, 'launch-download-package');
  if (!ledger || !downloadBlob || !collectionList || !form || !targetsEl || !validationEl || !previewEl || !packageButton) {
    return { refresh() {} };
  }

  let selectedCollectionId = '';
  let collections = [];
  let currentOutputs = null;
  let currentProfile = null;

  function selectedCollection() {
    return collections.find((entry) => entry.id === selectedCollectionId) || collections[0] || null;
  }

  function currentTargets() {
    return Object.fromEntries(TARGETS.map(([key]) => {
      const checkbox = document.querySelector(`[data-launch-target="${key}"]`);
      return [key, checkbox ? checkbox.checked : true];
    }));
  }

  function populateDefaults(collection, storageAddress) {
    const defaults = defaultLaunchProfile(collection, {
      storageAddress,
      origin: location?.origin,
      tokenIdStart: Number(formValue(form, 'tokenIdStart') || 1),
    });
    for (const [name, value] of Object.entries(defaults)) {
      if (name !== 'targets') setFormValue(form, name, value);
    }
    return defaults;
  }

  function renderTargets() {
    const rows = TARGETS.map(([key, label, copy]) => {
      const row = element(document, 'label', 'flex items-start gap-3 rounded-2xl border border-white/10 bg-surface-lowest/35 p-4 transition hover:border-primary-container/35');
      const input = element(document, 'input', 'mt-1');
      input.type = 'checkbox';
      input.checked = true;
      input.dataset.launchTarget = key;
      input.addEventListener('change', renderAll);
      const body = element(document, 'span');
      const title = element(document, 'span', 'block font-display text-base font-semibold', label);
      const detail = element(document, 'span', 'mt-1 block text-sm text-on-surface-variant', copy);
      body.append(title, detail);
      row.append(input, body);
      return row;
    });
    targetsEl.replaceChildren(...rows);
  }

  function renderCollections() {
    if (!collections.length) {
      const empty = element(document, 'p', 'rounded-3xl border border-white/10 bg-surface-lowest/35 p-5 text-sm leading-6 text-on-surface-variant', 'No launch-ready collection yet. Upload a folder first, then return here to generate chain handoff files.');
      collectionList.replaceChildren(empty);
      return;
    }
    const rows = collections.map((collection) => {
      const row = element(document, 'button', 'rounded-3xl border border-white/10 bg-surface-lowest/35 p-5 text-left transition hover:border-primary-container/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary');
      row.type = 'button';
      row.dataset.collectionId = collection.id;
      row.setAttribute('aria-pressed', String(collection.id === selectedCollectionId));
      if (collection.id === selectedCollectionId) row.classList.add('border-primary-container/50');
      const source = element(document, 'span', 'block vessel-kicker text-primary-container', collection.verification === 'vault-cache' ? 'Vault cache' : 'Shelby verified');
      const name = element(document, 'span', 'mt-2 block font-display text-xl font-semibold', collection.name);
      const detail = element(document, 'span', 'mt-1 block text-sm text-on-surface-variant', `${collection.itemCount} item${collection.itemCount === 1 ? '' : 's'}`);
      row.append(source, name, detail);
      row.addEventListener('click', () => {
        selectedCollectionId = collection.id;
        populateDefaults(collection, storageAddressFromState(getWalletState()));
        renderAll();
      });
      return row;
    });
    collectionList.replaceChildren(...rows);
  }

  function renderIssues(validation) {
    const groups = [
      ['Errors', validation.errors],
      ['Warnings', validation.warnings],
      ['Notes', validation.notes],
    ];
    validationEl.replaceChildren(...groups.map(([label, issues]) => {
      const wrap = element(document, 'section', 'rounded-3xl border border-white/10 bg-surface-lowest/35 p-4');
      const title = element(document, 'p', 'vessel-kicker text-outline', `${label}: ${issues.length}`);
      const list = element(document, 'ul', 'mt-3 grid gap-2 text-sm text-on-surface-variant');
      for (const item of issues.slice(0, 10)) {
        const row = element(document, 'li', `rounded-2xl border px-3 py-2 ${issueTone(item.severity)}`, item.message);
        list.append(row);
      }
      if (!issues.length) list.append(element(document, 'li', 'text-outline', `No ${label.toLowerCase()}.`));
      wrap.append(title, list);
      return wrap;
    }));
  }

  function renderPreviewCard({ title, count, sample, onDownload }) {
    const wrap = element(document, 'article', 'rounded-3xl border border-white/10 bg-surface-lowest/35 p-4');
    const heading = element(document, 'h3', 'font-display text-xl font-semibold', title);
    const meta = element(document, 'p', 'mt-2 text-sm text-outline', `${count} row${count === 1 ? '' : 's'}`);
    const code = element(document, 'pre', 'mt-4 max-h-40 overflow-auto rounded-2xl bg-black/30 p-3 text-xs leading-5 text-on-surface-variant');
    code.textContent = sample;
    const action = element(document, 'button', 'vessel-button vessel-button-secondary mt-4', `Download ${title}`);
    action.type = 'button';
    action.addEventListener('click', onDownload);
    wrap.append(heading, meta, code, action);
    return wrap;
  }

  function renderPreviews(outputs, profile, items) {
    const rows = targetRows(profile, items);
    const cards = [];
    const contract = JSON.stringify(buildContractUri(profile), null, 2);
    cards.push(renderPreviewCard({
      title: 'OpenSea contractURI',
      count: 1,
      sample: contract,
      onDownload: () => downloadText(document, downloadBlob, 'contractURI.json', `${contract}\n`, 'application/json'),
    }));
    for (const [key] of TARGETS) {
      if (!profile.targets[key]) continue;
      const csv = rowsToCsv(rows[key]);
      cards.push(renderPreviewCard({
        title: previewTitle(key),
        count: rows[key].length,
        sample: csvSample(rows[key]),
        onDownload: () => downloadText(document, downloadBlob, previewFileName(key), csv, 'text/csv'),
      }));
    }
    previewEl.replaceChildren(...cards);
    currentOutputs = outputs;
  }

  function renderAll() {
    const walletState = getWalletState();
    const storageAddress = storageAddressFromState(walletState);
    if (walletStatus) walletStatus.textContent = storageAddress ? 'Wallet connected. Launch Kit reads your existing Shelby Vault collections.' : 'Connect a wallet to load Shelby Vault collections.';
    if (storageAddressEl) storageAddressEl.textContent = storageAddress || 'Not connected';
    if (!collections.length) {
      renderCollections();
      renderIssues({ errors: [], warnings: [], notes: [] });
      previewEl.replaceChildren();
      packageButton.disabled = true;
      return;
    }
    const collection = selectedCollection();
    if (!selectedCollectionId && collection) selectedCollectionId = collection.id;
    const defaults = populateDefaults(collection, storageAddress);
    const profile = profileFromForm(form, defaults, currentTargets());
    const items = buildLaunchItems(collection, ledger.loadCollectionManifests(storageAddress), { tokenIdStart: profile.tokenIdStart });
    const validation = validateLaunchKit({ collection, profile, items });
    const outputs = buildLaunchOutputs(profile, items, validation, {
      collection,
      vesselOrigin: location?.origin,
      storageRuntime: 'shelbynet',
      storageAddress,
    });
    currentProfile = profile;
    renderCollections();
    renderIssues(validation);
    renderPreviews(outputs, profile, items);
    packageButton.disabled = validation.errors.length > 0;
  }

  function refresh() {
    const storageAddress = storageAddressFromState(getWalletState());
    collections = storageAddress
      ? groupVaultCollections(ledger.loadMine(), { storageAddress, verification: 'vault-cache' })
      : [];
    if (!collections.some((entry) => entry.id === selectedCollectionId)) selectedCollectionId = collections[0]?.id || '';
    renderAll();
  }

  renderTargets();
  form.addEventListener('input', renderAll);
  packageButton.addEventListener('click', () => {
    if (!currentOutputs || !currentProfile) return;
    downloadBlob(currentOutputs.zip, launchPackageFileName(currentProfile), document);
    notify('Launch package downloaded', 'ok');
  });
  refresh();
  return { refresh };
}
