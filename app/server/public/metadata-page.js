import {
  createNftMetadata,
  validateNftMetadata,
} from './metadata-schema.js';
import {
  buildMetadataBatch,
  parseMetadataCsv,
} from './metadata-batch.js';
import {
  buildMetadataZip,
  downloadBlob,
  metadataJsonFile,
} from './metadata-export.js';
import { createBatchQueue, runBatchQueue } from './batch-upload.js';
import { metadataFilesFromCollection } from './vault-collections.js';

const MIME_BY_EXTENSION = Object.freeze({
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
});

function metadataPageError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function safeSegments(relativePath) {
  const segments = String(relativePath || '').replaceAll('\\', '/').split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    throw metadataPageError('A safe relative image path is required', 'metadata_relative_path_invalid');
  }
  return segments;
}

export function joinMetadataBaseUri(baseUri, relativePath) {
  const base = String(baseUri || '').trim().replace(/\/+$/, '');
  if (!/^(?:https:\/\/|ipfs:\/\/|ar:\/\/)[^\s]+$/i.test(base)) {
    throw metadataPageError('Use an HTTPS, IPFS, or Arweave base URI', 'metadata_base_uri_invalid');
  }
  if (base.toLowerCase().startsWith('https://')) {
    try {
      const parsed = new URL(base);
      if (!parsed.hostname || parsed.search || parsed.hash) throw new TypeError('Invalid base URI');
    } catch {
      throw metadataPageError('Use a valid HTTPS base URI without a query or fragment', 'metadata_base_uri_invalid');
    }
  }
  return `${base}/${safeSegments(relativePath).map(encodeURIComponent).join('/')}`;
}

export function metadataImageMimeType(file) {
  const browserType = String(file?.type || '').toLowerCase();
  if (browserType.startsWith('image/')) return browserType;
  const extension = String(file?.name || '').split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXTENSION[extension] || 'image/png';
}

function imagePathFromKey(key) {
  return String(key || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function validationMessage(errors) {
  const labels = {
    name_required: 'Enter a name.',
    description_required: 'Enter a description.',
    image_uri_invalid: 'Select an available image from your Vault.',
    external_uri_invalid: 'Use an HTTPS, IPFS, or Arweave external URL.',
    attribute_trait_required: 'Every trait needs a trait type.',
    attribute_value_invalid: 'Every trait value must be text or a number.',
    primary_file_required: 'The primary image mapping is incomplete.',
  };
  return [...new Set(errors.map((error) => labels[error.code] || 'Review the highlighted metadata fields.'))].join(' ');
}

function readyWallet(state) {
  return state?.status === 'ready' && Boolean(state?.session?.storageAddress);
}

function fileNameStem(value, fallback = 'metadata') {
  const raw = String(value || '').split('/').pop()?.replace(/\.[^.]+$/, '') || fallback;
  return raw.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || fallback;
}

export function initMetadataPage({
  document,
  selectedArtifact = {},
  walletState = {},
  hostingAvailable = false,
  loadCollections = async () => [],
  hostFiles = async () => { throw metadataPageError('Wallet-owned metadata hosting is not ready', 'wallet_owned_metadata_host_not_ready'); },
  notify = () => {},
  copyText = (value) => globalThis.navigator?.clipboard?.writeText?.(value),
  origin = globalThis.location?.origin || 'http://localhost',
} = {}) {
  if (!document?.querySelector) throw new TypeError('A document is required');
  const byId = (id) => document.querySelector(`#${id}`);
  const element = {
    singleTab: byId('metadata-single-tab'),
    batchTab: byId('metadata-batch-tab'),
    singlePanel: byId('metadata-single-panel'),
    batchPanel: byId('metadata-batch-panel'),
    image: byId('meta-image-preview'),
    imageFallback: byId('meta-image-fallback'),
    imageKey: byId('meta-image-key'),
    imageStatus: byId('meta-image-status'),
    name: byId('nft-name'),
    description: byId('nft-desc'),
    externalUrl: byId('nft-link'),
    singleTraits: byId('single-traits'),
    addSingleTrait: byId('single-add-trait'),
    singleDays: byId('single-retention-days'),
    singlePreview: byId('json-preview'),
    singleValidation: byId('single-validation'),
    singleDownload: byId('single-download-json'),
    singleHost: byId('single-host-shelby'),
    resultArea: byId('result-area'),
    resultUri: byId('result-uri'),
    copyUri: byId('copy-uri'),
    collectionList: byId('metadata-collection-list'),
    collectionRefresh: byId('metadata-collection-refresh'),
    collectionStatus: byId('metadata-collection-status'),
    batchName: byId('batch-name-prefix'),
    batchDescription: byId('batch-description'),
    batchExternalUrl: byId('batch-external-url'),
    vesselUri: byId('batch-uri-vessel'),
    customUri: byId('batch-uri-custom'),
    baseUriWrap: byId('batch-base-uri-wrap'),
    baseUri: byId('batch-base-uri'),
    csvInput: byId('batch-csv-input'),
    startNumber: byId('batch-start-number'),
    batchDays: byId('batch-retention-days'),
    batchSummary: byId('batch-summary'),
    batchSearch: byId('batch-search'),
    batchTable: byId('batch-item-table'),
    batchPreview: byId('batch-json-preview'),
    batchDownload: byId('batch-download-zip'),
    batchHost: byId('batch-host-shelby'),
    batchHostResults: byId('batch-host-results'),
    batchHostProgress: byId('batch-host-progress'),
    batchHostStatus: byId('batch-host-status'),
    batchHostCurrent: byId('batch-host-current'),
    batchHostCounts: byId('batch-host-counts'),
    batchHostRetry: byId('batch-host-retry'),
    hostingStatus: byId('metadata-hosting-status'),
  };

  let currentWallet = walletState;
  let canHost = Boolean(hostingAvailable);
  let sourceState = 'empty';
  let singleTraits = [{ id: 1, trait_type: '', value: '' }];
  let nextTraitId = 2;
  let collections = [];
  let selectedCollectionId = '';
  let collectionState = readyWallet(walletState) ? 'loading' : 'wallet';
  let collectionGeneration = 0;
  let csvRows = [];
  let batchPlan = null;
  let selectedBatchItemId = '';
  let batchGeneration = 0;
  let pendingBatchRebuild = 0;
  let isHosting = false;
  let batchHostQueue = null;

  const artifactKey = String(selectedArtifact.key || '');
  const artifactUrl = selectedArtifact.url
    ? new URL(selectedArtifact.url, origin).href
    : artifactKey ? new URL(`/api/media/${imagePathFromKey(artifactKey)}`, origin).href : '';
  const artifactFile = {
    name: artifactKey.split('/').pop() || 'artifact.png',
    type: selectedArtifact.contentType || '',
  };

  function setSourceState(state) {
    sourceState = state;
    element.image?.classList.toggle('hidden', state !== 'ready');
    element.imageFallback?.classList.toggle('hidden', state === 'ready');
    if (element.imageStatus) {
      element.imageStatus.dataset.state = state;
      element.imageStatus.textContent = ({
        empty: 'Choose an artifact from your Vault to continue.',
        loading: 'Checking source artifact availability...',
        ready: 'Source artifact is available and ready for metadata.',
        error: 'Source artifact is unavailable. Choose another artifact from your Vault.',
      })[state];
    }
    renderSingle();
  }

  function traitValues() {
    return singleTraits
      .filter((trait) => trait.trait_type || trait.value)
      .map(({ trait_type, value }) => ({ trait_type, value }));
  }

  function currentSingleMetadata() {
    return createNftMetadata({
      name: element.name?.value,
      description: element.description?.value,
      image: artifactUrl,
      externalUrl: element.externalUrl?.value,
      attributes: traitValues(),
      mimeType: metadataImageMimeType(artifactFile),
    });
  }

  function selectedCollection() {
    return collections.find((entry) => entry.id === selectedCollectionId) || null;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  function formatExpiry(value) {
    const expiry = Number(value || 0);
    return Number.isFinite(expiry) && expiry > 0
      ? new Date(expiry).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : 'unknown expiry';
  }

  function renderCollections(error = null) {
    if (!element.collectionList || !element.collectionStatus) return;
    const selected = selectedCollection();
    const usingVaultCache = collections.some((collection) => collection.verification === 'vault-cache') || !canHost;
    const messages = {
      wallet: 'Connect your wallet to load Shelby collections.',
      loading: usingVaultCache
        ? "Loading this browser's Vault history while the Shelby API is paused..."
        : 'Checking your wallet-owned collections on Shelby...',
      ready: usingVaultCache
        ? collections.length
          ? `Shelby API is paused. Showing ${collections.length} collection${collections.length === 1 ? '' : 's'} recorded in this browser's Vault.${selected ? ` Selected ${selected.name}.` : ''}`
          : "Shelby API is paused. No active batch collection is recorded in this browser's Vault."
        : collections.length
          ? `${collections.length} active Shelby collection${collections.length === 1 ? '' : 's'} found.${selected ? ` Selected ${selected.name}.` : ''}`
          : 'No eligible folder collection was found. Upload a folder as a batch first.',
      error: `Unable to load Shelby collections: ${String(error?.message || 'Unknown error')}`,
    };
    element.collectionStatus.dataset.state = collectionState;
    element.collectionStatus.textContent = messages[collectionState] || messages.wallet;
    if (element.collectionRefresh) element.collectionRefresh.disabled = collectionState === 'loading';

    if (!collections.length) {
      const empty = document.createElement('div');
      empty.className = 'rounded-2xl border border-dashed border-white/10 p-5 text-sm leading-6 text-outline';
      empty.setAttribute('role', 'listitem');
      empty.append(document.createTextNode(
        collectionState === 'error'
          ? 'Shelby could not verify this Vault. Refresh to try again.'
          : usingVaultCache
            ? 'Only collections previously uploaded from this browser can be reconstructed while the API is paused.'
          : 'Upload a folder as a batch to make it available here. ',
      ));
      if (collectionState !== 'error' && !usingVaultCache) {
        const link = document.createElement('a');
        link.className = 'text-primary underline decoration-primary/30 underline-offset-4';
        link.href = '/upload.html';
        link.textContent = 'Open Upload';
        empty.appendChild(link);
      }
      element.collectionList.replaceChildren(empty);
      return;
    }

    const rows = collections.map((collection) => {
      const row = document.createElement('div');
      row.setAttribute('role', 'listitem');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'metadata-collection-choice flex min-h-20 w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-surface-lowest/35 px-5 py-4 text-left transition hover:border-primary-container/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
      button.dataset.collectionId = collection.id;
      button.setAttribute('aria-pressed', String(collection.id === selectedCollectionId));
      if (collection.id === selectedCollectionId) button.dataset.state = 'selected';
      const label = document.createElement('span');
      label.className = 'min-w-0';
      const name = document.createElement('strong');
      name.className = 'block truncate font-display text-lg text-on-surface';
      name.textContent = collection.name;
      const details = document.createElement('small');
      details.className = 'vessel-technical mt-2 block text-[10px] leading-5 text-on-surface-variant';
      details.textContent = `${collection.itemCount} image${collection.itemCount === 1 ? '' : 's'} · ${formatBytes(collection.totalBytes)} · expires ${formatExpiry(collection.earliestExpiry)}`;
      label.append(name, details);
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined shrink-0 text-primary';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = collection.id === selectedCollectionId ? 'check_circle' : 'folder_open';
      button.append(label, icon);
      button.addEventListener('click', () => selectCollection(collection.id));
      row.appendChild(button);
      return row;
    });
    element.collectionList.replaceChildren(...rows);
  }

  function renderHostingState() {
    const walletReady = readyWallet(currentWallet);
    const singleValid = validateNftMetadata(currentSingleMetadata()).valid && sourceState === 'ready';
    const allBatchValid = Boolean(batchPlan?.items.length) && batchPlan.errors.length === 0;
    if (element.singleHost) element.singleHost.disabled = isHosting || !(canHost && walletReady && singleValid);
    if (element.batchHost) element.batchHost.disabled = isHosting || !(canHost && walletReady && allBatchValid);
    if (!element.hostingStatus) return;
    if (isHosting) {
      element.hostingStatus.dataset.state = 'hosting';
      element.hostingStatus.textContent = 'Hosting wallet-owned metadata. Keep this tab open and approve the wallet request.';
    } else if (!canHost) {
      element.hostingStatus.dataset.state = 'paused';
      element.hostingStatus.textContent = 'Shelby testnet hosting is temporarily paused. Local JSON and ZIP export remain available.';
    } else if (!walletReady) {
      element.hostingStatus.dataset.state = 'wallet';
      element.hostingStatus.textContent = 'Connect an Aptos or Solana wallet to host metadata under your wallet-owned storage address.';
    } else {
      element.hostingStatus.dataset.state = 'ready';
      element.hostingStatus.textContent = 'Wallet-owned Shelby hosting is ready. Every hosted JSON uses a Vessel settlement receipt.';
    }
  }

  function renderSingle() {
    const metadata = currentSingleMetadata();
    const validation = validateNftMetadata(metadata);
    if (element.singlePreview) element.singlePreview.textContent = `${JSON.stringify(metadata, null, 2)}\n`;
    const ready = validation.valid && sourceState === 'ready';
    if (element.singleDownload) element.singleDownload.disabled = !ready;
    if (element.singleValidation) {
      element.singleValidation.dataset.state = ready ? 'valid' : 'invalid';
      element.singleValidation.textContent = ready
        ? 'Valid marketplace-ready JSON. You can download it without a wallet signature.'
        : sourceState === 'loading'
          ? 'Checking the selected source image.'
          : validationMessage(validation.errors);
    }
    renderHostingState();
    return { metadata, validation, ready };
  }

  function makeTraitRow(trait) {
    const row = document.createElement('div');
    row.className = 'metadata-trait-row';
    row.dataset.traitId = String(trait.id);
    const typeWrap = document.createElement('div');
    const typeLabel = document.createElement('label');
    const typeInput = document.createElement('input');
    typeLabel.className = 'sr-only';
    typeLabel.htmlFor = `single-trait-type-${trait.id}`;
    typeLabel.textContent = 'Trait type';
    typeInput.id = typeLabel.htmlFor;
    typeInput.className = 'vessel-input';
    typeInput.type = 'text';
    typeInput.placeholder = 'Trait type';
    typeInput.value = trait.trait_type;
    typeInput.addEventListener('input', () => { trait.trait_type = typeInput.value; renderSingle(); });
    typeWrap.append(typeLabel, typeInput);
    const valueWrap = document.createElement('div');
    const valueLabel = document.createElement('label');
    const valueInput = document.createElement('input');
    valueLabel.className = 'sr-only';
    valueLabel.htmlFor = `single-trait-value-${trait.id}`;
    valueLabel.textContent = 'Trait value';
    valueInput.id = valueLabel.htmlFor;
    valueInput.className = 'vessel-input';
    valueInput.type = 'text';
    valueInput.placeholder = 'Value';
    valueInput.value = trait.value;
    valueInput.addEventListener('input', () => { trait.value = valueInput.value; renderSingle(); });
    valueWrap.append(valueLabel, valueInput);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'metadata-trait-remove';
    remove.setAttribute('aria-label', `Remove trait ${trait.id}`);
    remove.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
    remove.addEventListener('click', () => {
      singleTraits = singleTraits.filter((entry) => entry.id !== trait.id);
      if (!singleTraits.length) singleTraits.push({ id: nextTraitId++, trait_type: '', value: '' });
      renderTraitRows();
      renderSingle();
    });
    row.append(typeWrap, valueWrap, remove);
    return row;
  }

  function renderTraitRows() {
    if (!element.singleTraits) return;
    element.singleTraits.replaceChildren(...singleTraits.map(makeTraitRow));
  }

  function selectMode(mode, focus = false) {
    const single = mode === 'single';
    element.singleTab?.setAttribute('aria-selected', String(single));
    element.batchTab?.setAttribute('aria-selected', String(!single));
    if (element.singleTab) element.singleTab.tabIndex = single ? 0 : -1;
    if (element.batchTab) element.batchTab.tabIndex = single ? -1 : 0;
    if (element.singlePanel) element.singlePanel.hidden = !single;
    if (element.batchPanel) element.batchPanel.hidden = single;
    if (focus) (single ? element.singleTab : element.batchTab)?.focus();
  }

  function handleTabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const goSingle = event.key === 'ArrowLeft' || event.key === 'Home';
    selectMode(goSingle ? 'single' : 'batch', true);
  }

  function renderSummaryChip(label, value, state = '') {
    const chip = document.createElement('span');
    chip.className = 'metadata-summary-chip';
    if (state) chip.dataset.state = state;
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    chip.append(strong, document.createTextNode(` ${label}`));
    return chip;
  }

  function renderBatchTable() {
    if (!element.batchTable) return;
    const query = String(element.batchSearch?.value || '').trim().toLowerCase();
    const items = (batchPlan?.items || []).filter((item) => (
      !query || item.sourcePath.toLowerCase().includes(query) || item.metadata.name.toLowerCase().includes(query)
    ));
    const rows = items.slice(0, 200).map((item) => {
      const row = document.createElement('tr');
      if (item.status === 'invalid') row.dataset.state = 'invalid';
      const source = document.createElement('td');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'metadata-item-select';
      choose.textContent = item.sourcePath;
      choose.addEventListener('click', () => {
        selectedBatchItemId = item.id;
        renderBatchPreview();
      });
      source.appendChild(choose);
      const name = document.createElement('td');
      name.textContent = item.metadata.name || '(missing name)';
      const traits = document.createElement('td');
      traits.textContent = String(item.metadata.attributes.length);
      const status = document.createElement('td');
      status.textContent = item.status === 'valid' ? 'Ready' : `${item.errors.length} error${item.errors.length === 1 ? '' : 's'}`;
      row.append(source, name, traits, status);
      return row;
    });
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = batchPlan ? 'No items match your search.' : 'No collection loaded.';
      row.appendChild(cell);
      rows.push(row);
    }
    element.batchTable.replaceChildren(...rows);
  }

  function renderBatchPreview() {
    if (!element.batchPreview) return;
    const item = batchPlan?.items.find((entry) => entry.id === selectedBatchItemId) || batchPlan?.items[0];
    element.batchPreview.textContent = item ? `${JSON.stringify(item.metadata, null, 2)}\n` : '{}';
  }

  function renderBatch() {
    const items = batchPlan?.items || [];
    const validCount = items.filter((item) => item.status === 'valid').length;
    const invalidCount = items.length - validCount;
    if (element.batchSummary) {
      if (!batchPlan) {
        element.batchSummary.textContent = 'Select a Shelby collection to build the collection plan.';
      } else {
        element.batchSummary.replaceChildren(
          renderSummaryChip('collection', selectedCollection()?.name || 'Shelby'),
          renderSummaryChip('images', items.length),
          renderSummaryChip('ready', validCount, 'valid'),
          renderSummaryChip('invalid', invalidCount, invalidCount ? 'invalid' : ''),
          renderSummaryChip('warnings', batchPlan.warnings.length, batchPlan.warnings.length ? 'warning' : ''),
        );
      }
    }
    if (element.batchDownload) element.batchDownload.disabled = validCount === 0;
    renderBatchTable();
    renderBatchPreview();
    renderHostingState();
  }

  function renderBatchHosting({ phase = 'ready', item = null, error = null } = {}) {
    if (!batchHostQueue || !element.batchHostResults) return;
    const summary = batchHostQueue.summary();
    element.batchHostResults.classList.remove('hidden');
    if (element.batchHostProgress) {
      element.batchHostProgress.value = summary.progressPercent;
      element.batchHostProgress.textContent = `${summary.progressPercent}%`;
    }
    if (element.batchHostCounts) {
      element.batchHostCounts.textContent = `${summary.succeeded} hosted · ${summary.failed} failed · ${summary.total} total`;
    }
    if (element.batchHostCurrent) {
      element.batchHostCurrent.textContent = item?.relativePath || 'No JSON is uploading.';
    }
    if (element.batchHostStatus && phase !== 'controls') {
      const activePhase = !['ready', 'complete', 'failed'].includes(phase);
      element.batchHostStatus.textContent = phase === 'uploading' || activePhase
        ? `Approve item ${summary.completed + 1} of ${summary.total}. Each JSON receives its own Vessel settlement receipt.`
        : phase === 'complete'
          ? `${summary.succeeded} TokenURI file${summary.succeeded === 1 ? '' : 's'} hosted successfully.`
          : phase === 'failed' && error?.code === 'receipt_pending'
            ? 'Paused while the current contract receipt reaches finality. No second settlement will be requested.'
            : phase === 'failed'
              ? `Paused after ${summary.succeeded} success${summary.succeeded === 1 ? '' : 'es'}: ${String(error?.message || error).slice(0, 140)}`
              : `${summary.total} wallet approvals expected. Pricing is estimated until each live quote is validated; the minimum service charge is $0.01.`;
    }
    const retryable = batchHostQueue.items.some(
      (entry) => entry.status === 'failed' && entry.error?.retryable !== false,
    );
    element.batchHostRetry?.classList.toggle('hidden', !retryable || isHosting);
    const completed = batchHostQueue.items.filter((entry) => entry.status === 'succeeded');
    if (phase === 'complete' && completed.length) {
      const lastUrl = completed.at(-1)?.result?.url;
      if (lastUrl && element.resultUri) element.resultUri.value = lastUrl;
    }
  }

  async function rebuildBatch() {
    const generation = ++batchGeneration;
    batchHostQueue = null;
    element.batchHostResults?.classList.add('hidden');
    const collection = selectedCollection();
    const files = metadataFilesFromCollection(collection, { origin });
    if (!files.length) {
      batchPlan = null;
      renderBatch();
      return;
    }
    const useCustom = Boolean(element.customUri?.checked);
    if (element.baseUriWrap) element.baseUriWrap.classList.toggle('hidden', !useCustom);
    try {
      const plan = await buildMetadataBatch({
        files,
        csvRows,
        defaults: {
          namePrefix: element.batchName?.value || collection.name,
          description: element.batchDescription?.value,
          externalUrl: element.batchExternalUrl?.value,
          startNumber: Number(element.startNumber?.value || 1),
        },
        uriForImage: async (file, relativePath) => (
          useCustom ? joinMetadataBaseUri(element.baseUri?.value, relativePath) : file.url
        ),
      });
      if (generation !== batchGeneration) return;
      batchPlan = plan;
      selectedBatchItemId = plan.items[0]?.id || '';
    } catch (error) {
      if (generation !== batchGeneration) return;
      batchPlan = null;
      notify(error.message, 'error');
    }
    renderBatch();
  }

  function scheduleBatchRebuild() {
    clearTimeout(pendingBatchRebuild);
    pendingBatchRebuild = setTimeout(rebuildBatch, 180);
  }

  async function refreshCollections() {
    const generation = ++collectionGeneration;
    const requestedAddress = currentWallet?.session?.storageAddress || '';
    batchHostQueue = null;
    batchPlan = null;
    selectedBatchItemId = '';
    if (!readyWallet(currentWallet)) {
      collections = [];
      selectedCollectionId = '';
      collectionState = 'wallet';
      renderCollections();
      renderBatch();
      return [];
    }
    collectionState = 'loading';
    renderCollections();
    renderBatch();
    try {
      const loaded = await loadCollections();
      if (
        generation !== collectionGeneration
        || requestedAddress !== (currentWallet?.session?.storageAddress || '')
      ) return [];
      collections = [...(loaded || [])];
      if (!collections.some((entry) => entry.id === selectedCollectionId)) selectedCollectionId = '';
      collectionState = 'ready';
      renderCollections();
      await rebuildBatch();
      return collections;
    } catch (error) {
      if (generation !== collectionGeneration) return [];
      collections = [];
      selectedCollectionId = '';
      collectionState = 'error';
      renderCollections(error);
      renderBatch();
      throw error;
    }
  }

  function refreshCollectionsWithNotice() {
    refreshCollections().catch((error) => {
      notify(error.message, 'error');
    });
  }

  function clearCsvOverrides() {
    csvRows = [];
    if (element.csvInput) element.csvInput.value = '';
  }

  function selectCollection(collectionId) {
    if (!collections.some((entry) => entry.id === collectionId)) {
      throw metadataPageError('Select an active Shelby collection', 'metadata_collection_invalid');
    }
    if (selectedCollectionId !== collectionId) {
      selectedCollectionId = collectionId;
      clearCsvOverrides();
      const collection = selectedCollection();
      if (element.batchName && !element.batchName.value.trim()) element.batchName.value = collection.name;
      renderCollections();
      void rebuildBatch();
      return;
    }
    renderCollections();
  }

  async function hostSingle() {
    const current = renderSingle();
    if (!current.ready) throw metadataPageError('Complete valid metadata before hosting', 'metadata_invalid');
    const file = metadataJsonFile(current.metadata, `${fileNameStem(artifactKey)}.json`);
    isHosting = true;
    renderHostingState();
    try {
      const results = await hostFiles([file], {
        days: Number(element.singleDays?.value || 30),
        sourcePath: file.name,
      });
      const result = Array.isArray(results) ? results[0] : results;
      const tokenUri = result?.url || result?.tokenUri;
      if (!tokenUri) throw metadataPageError('Shelby did not return an active TokenURI', 'metadata_token_uri_missing');
      if (element.resultArea) {
        element.resultArea.classList.remove('hidden');
        element.resultArea.classList.add('flex');
      }
      if (element.resultUri) element.resultUri.value = tokenUri;
      notify('TokenURI hosted under your wallet-owned storage address', 'ok');
      return result;
    } finally {
      isHosting = false;
      renderHostingState();
    }
  }

  async function hostBatch() {
    if (!batchPlan?.items.length || batchPlan.errors.length) {
      throw metadataPageError('Resolve all collection errors before hosting', 'metadata_batch_invalid');
    }
    if (!batchHostQueue) {
      const files = batchPlan.items.map((item) => {
        const file = new File(
          [item.serialized],
          item.outputPath.split('/').pop(),
          { type: 'application/json' },
        );
        Object.defineProperty(file, 'vesselRelativePath', { value: item.outputPath });
        return file;
      });
      batchHostQueue = createBatchQueue(files);
    }
    isHosting = true;
    renderHostingState();
    renderBatchHosting({ phase: 'uploading', item: batchHostQueue.next() });
    try {
      const outcome = await runBatchQueue(batchHostQueue, async (item) => {
        const [result] = await hostFiles([item.file], {
          days: Number(element.batchDays?.value || 30),
          sourcePath: item.relativePath,
          onUpdate: (update) => renderBatchHosting({ phase: update.phase, item }),
        });
        return result;
      }, { onUpdate: renderBatchHosting });
      renderBatchHosting({
        phase: outcome.status === 'complete' ? 'complete' : 'failed',
        item: outcome.item,
        error: outcome.error,
      });
      if (outcome.status === 'complete') notify(`${outcome.summary.succeeded} collection TokenURI files hosted`, 'ok');
      return outcome;
    } finally {
      isHosting = false;
      renderHostingState();
      renderBatchHosting({ phase: 'controls' });
    }
  }

  async function retryFailedBatch() {
    if (!batchHostQueue) throw metadataPageError('No failed collection hosting job exists', 'metadata_batch_retry_unavailable');
    if (!batchHostQueue.retryFailed()) {
      const pending = batchHostQueue.items.some((entry) => entry.error?.code === 'receipt_pending');
      throw metadataPageError(
        pending ? 'The submitted receipt is still pending and cannot be charged again' : 'No retryable metadata files remain',
        pending ? 'receipt_pending' : 'metadata_batch_retry_unavailable',
      );
    }
    return hostBatch();
  }

  function wireEvents() {
    element.singleTab?.addEventListener('click', () => selectMode('single'));
    element.batchTab?.addEventListener('click', () => selectMode('batch'));
    element.singleTab?.addEventListener('keydown', handleTabKey);
    element.batchTab?.addEventListener('keydown', handleTabKey);
    [element.name, element.description, element.externalUrl].forEach((input) => {
      input?.addEventListener('input', renderSingle);
    });
    element.addSingleTrait?.addEventListener('click', () => {
      singleTraits.push({ id: nextTraitId++, trait_type: '', value: '' });
      renderTraitRows();
    });
    element.singleDownload?.addEventListener('click', () => {
      const current = renderSingle();
      if (!current.ready) return;
      downloadBlob(metadataJsonFile(current.metadata, `${fileNameStem(artifactKey)}.json`), `${fileNameStem(artifactKey)}.json`, document);
    });
    element.singleHost?.addEventListener('click', () => hostSingle().catch((error) => notify(error.message, 'error')));
    element.copyUri?.addEventListener('click', () => copyText(element.resultUri?.value || ''));
    element.collectionRefresh?.addEventListener('click', refreshCollectionsWithNotice);
    [element.batchName, element.batchDescription, element.batchExternalUrl, element.baseUri, element.startNumber].forEach((input) => {
      input?.addEventListener('input', scheduleBatchRebuild);
    });
    [element.vesselUri, element.customUri].forEach((input) => {
      input?.addEventListener('change', scheduleBatchRebuild);
    });
    element.csvInput?.addEventListener('change', async () => {
      const file = element.csvInput.files?.[0];
      if (!file) {
        csvRows = [];
      } else {
        try {
          csvRows = parseMetadataCsv(await file.text());
        } catch (error) {
          csvRows = [];
          notify(error.message, 'error');
        }
      }
      await rebuildBatch();
    });
    element.batchSearch?.addEventListener('input', renderBatchTable);
    element.batchDownload?.addEventListener('click', async () => {
      const validItems = batchPlan?.items.filter((item) => item.status === 'valid') || [];
      if (!validItems.length) return;
      const reportWarnings = [...batchPlan.warnings, ...batchPlan.errors];
      const zip = await buildMetadataZip(validItems, { warnings: reportWarnings });
      downloadBlob(zip, `${fileNameStem(element.batchName?.value, 'collection')}-metadata.zip`, document);
    });
    element.batchHost?.addEventListener('click', () => hostBatch().catch((error) => notify(error.message, 'error')));
    element.batchHostRetry?.addEventListener('click', () => retryFailedBatch().catch((error) => notify(error.message, 'error')));
  }

  function initializeSource() {
    if (element.imageKey) element.imageKey.textContent = artifactKey || '(pick from gallery)';
    if (!element.image || !artifactUrl) {
      setSourceState('empty');
      return;
    }
    setSourceState('loading');
    element.image.addEventListener('load', () => setSourceState('ready'), { once: true });
    element.image.addEventListener('error', () => setSourceState('error'), { once: true });
    element.image.src = artifactUrl;
  }

  function reset() {
    clearTimeout(pendingBatchRebuild);
    singleTraits = [{ id: nextTraitId++, trait_type: '', value: '' }];
    collections = [];
    selectedCollectionId = '';
    clearCsvOverrides();
    batchPlan = null;
    selectedBatchItemId = '';
    renderTraitRows();
    renderSingle();
    renderCollections();
    renderBatch();
  }

  function refreshWallet(next) {
    const previousAddress = currentWallet?.session?.storageAddress || '';
    const previousReady = readyWallet(currentWallet);
    const nextAddress = next?.session?.storageAddress || '';
    const nextReady = readyWallet(next);
    currentWallet = next || {};
    renderHostingState();
    if (previousAddress !== nextAddress || previousReady !== nextReady) {
      collections = [];
      selectedCollectionId = '';
      clearCsvOverrides();
      refreshCollectionsWithNotice();
    }
  }

  function refreshHosting(next) {
    canHost = Boolean(next);
    renderHostingState();
  }

  renderTraitRows();
  wireEvents();
  selectMode('single');
  initializeSource();
  renderCollections();
  renderBatch();
  renderHostingState();
  refreshCollectionsWithNotice();

  return Object.freeze({
    reset,
    refreshWallet,
    refreshHosting,
    refreshCollections,
    hostSingle,
    hostBatch,
    retryFailedBatch,
  });
}
