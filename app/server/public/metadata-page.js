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
import {
  contentAddressedBlobName,
  createFileHashCache,
  vesselBlobUrl,
} from './content-address.js';
import { collectDirectoryFiles } from './directory-picker.js';

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
  hostFiles = async () => { throw metadataPageError('Wallet-owned metadata hosting is not ready', 'wallet_owned_metadata_host_not_ready'); },
  notify = () => {},
  copyText = (value) => globalThis.navigator?.clipboard?.writeText?.(value),
  origin = globalThis.location?.origin || 'http://localhost',
  scope = globalThis,
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
    folderPicker: byId('metadata-folder-picker'),
    folderInput: byId('metadata-folder-input'),
    folderStatus: byId('metadata-folder-status'),
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
    hostingStatus: byId('metadata-hosting-status'),
  };

  let currentWallet = walletState;
  let canHost = Boolean(hostingAvailable);
  let sourceState = 'empty';
  let singleTraits = [{ id: 1, trait_type: '', value: '' }];
  let nextTraitId = 2;
  let batchFiles = [];
  let csvRows = [];
  let batchPlan = null;
  let selectedBatchItemId = '';
  let batchGeneration = 0;
  let pendingBatchRebuild = 0;
  const hashFile = createFileHashCache();

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

  function renderHostingState() {
    const walletReady = readyWallet(currentWallet);
    const singleValid = validateNftMetadata(currentSingleMetadata()).valid && sourceState === 'ready';
    const allBatchValid = Boolean(batchPlan?.items.length) && batchPlan.errors.length === 0;
    if (element.singleHost) element.singleHost.disabled = !(canHost && walletReady && singleValid);
    if (element.batchHost) element.batchHost.disabled = !(canHost && walletReady && allBatchValid);
    if (!element.hostingStatus) return;
    if (!canHost) {
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
        element.batchSummary.textContent = 'Select a folder to build the collection plan.';
      } else {
        element.batchSummary.replaceChildren(
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

  async function rebuildBatch() {
    const generation = ++batchGeneration;
    if (!batchFiles.length) {
      batchPlan = null;
      renderBatch();
      return;
    }
    if (element.folderStatus) element.folderStatus.textContent = `Preparing ${batchFiles.length} selected files...`;
    const useCustom = Boolean(element.customUri?.checked);
    if (element.baseUriWrap) element.baseUriWrap.classList.toggle('hidden', !useCustom);
    try {
      const plan = await buildMetadataBatch({
        files: batchFiles,
        csvRows,
        defaults: {
          namePrefix: element.batchName?.value,
          description: element.batchDescription?.value,
          externalUrl: element.batchExternalUrl?.value,
          startNumber: Number(element.startNumber?.value || 1),
        },
        uriForImage: async (file, relativePath) => {
          if (useCustom) return joinMetadataBaseUri(element.baseUri?.value, relativePath);
          if (!readyWallet(currentWallet)) {
            throw metadataPageError('Connect a wallet to generate automatic Vessel image URIs', 'metadata_wallet_required');
          }
          const hash = await hashFile(file);
          return vesselBlobUrl({
            origin,
            storageAddress: currentWallet.session.storageAddress,
            blobName: contentAddressedBlobName(file, hash),
          });
        },
      });
      if (generation !== batchGeneration) return;
      batchPlan = plan;
      selectedBatchItemId = plan.items[0]?.id || '';
      if (element.folderStatus) {
        const imageCount = plan.items.length;
        element.folderStatus.textContent = `${imageCount} image${imageCount === 1 ? '' : 's'} mapped. ${plan.errors.length} validation error${plan.errors.length === 1 ? '' : 's'}.`;
      }
    } catch (error) {
      if (generation !== batchGeneration) return;
      batchPlan = null;
      if (element.folderStatus) element.folderStatus.textContent = error.message;
      notify(error.message, 'error');
    }
    renderBatch();
  }

  async function selectFolder(files) {
    batchFiles = [...(files || [])];
    csvRows = [];
    if (element.csvInput) element.csvInput.value = '';
    await rebuildBatch();
  }

  function scheduleBatchRebuild() {
    clearTimeout(pendingBatchRebuild);
    pendingBatchRebuild = setTimeout(rebuildBatch, 180);
  }

  async function pickFolder() {
    if (typeof scope.showDirectoryPicker !== 'function') {
      element.folderInput?.click();
      return;
    }
    try {
      const directory = await scope.showDirectoryPicker({ mode: 'read' });
      await selectFolder(await collectDirectoryFiles(directory));
    } catch (error) {
      if (error?.name !== 'AbortError') notify(error.message, 'error');
    }
  }

  async function hostSingle() {
    const current = renderSingle();
    if (!current.ready) throw metadataPageError('Complete valid metadata before hosting', 'metadata_invalid');
    const file = metadataJsonFile(current.metadata, `${fileNameStem(artifactKey)}.json`);
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
  }

  async function hostBatch() {
    if (!batchPlan?.items.length || batchPlan.errors.length) {
      throw metadataPageError('Resolve all collection errors before hosting', 'metadata_batch_invalid');
    }
    const files = batchPlan.items.map((item) => new File(
      [item.serialized],
      item.outputPath.split('/').pop(),
      { type: 'application/json' },
    ));
    return hostFiles(files, {
      days: Number(element.batchDays?.value || 30),
      sourcePaths: batchPlan.items.map((item) => item.outputPath),
    });
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
    element.folderPicker?.addEventListener('click', pickFolder);
    element.folderInput?.addEventListener('change', () => selectFolder(element.folderInput.files));
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
    batchFiles = [];
    csvRows = [];
    batchPlan = null;
    selectedBatchItemId = '';
    renderTraitRows();
    renderSingle();
    renderBatch();
  }

  function refreshWallet(next) {
    const previousAddress = currentWallet?.session?.storageAddress || '';
    currentWallet = next || {};
    renderHostingState();
    if (batchFiles.length && element.vesselUri?.checked && previousAddress !== (currentWallet?.session?.storageAddress || '')) {
      void rebuildBatch();
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
  renderBatch();
  renderHostingState();

  return Object.freeze({
    reset,
    refreshWallet,
    refreshHosting,
    hostSingle,
    hostBatch,
  });
}
