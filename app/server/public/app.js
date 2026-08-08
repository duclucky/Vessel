// Vessel — shared frontend wiring. Vanilla ES module. Talks only to the backend REST API
// (same origin). The only browser-side credential is the user's wallet signature.

import { createLedger } from './ledger.js';
import { walletPresentation } from './wallet-ui.js';
import { mountWalletUi } from './wallet-modal.js';
import { confirmAction } from './confirm-dialog.js';
import { createUploadIntent } from './retention.js';
import { formatAccountingMicro, mountQuoteUi } from './quote-ui.js';
import { settleContractQuote } from './settlement-client.js';
import { createRecoveryLedger } from './recovery-ledger.js';
import { createBatchQueue, runBatchQueue } from './batch-upload.js';
import { collectDirectoryFiles, supportsDirectoryPicker } from './directory-picker.js';
import { contentAddressedBlobName, sha256FileHex } from './content-address.js';
import { initMetadataPage } from './metadata-page.js';
import { downloadBlob } from './metadata-export.js';
import { groupVaultCollections } from './vault-collections.js';
import { createWalletOwnedUploadService } from './wallet-owned-upload.js';

const API = location.origin;
const ledger = createLedger(localStorage);
const recovery = createRecoveryLedger(localStorage);
const { loadMine, replaceMine, forgetMine, loadCollectionManifests, attachTokenUriToArtifact } = ledger;

/* ------------------------------- helpers ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const shortMid = (a, n = 6) => (a && a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a || '');

async function api(path, { method = 'GET', body, form, signal } = {}) {
  const opts = { method };
  if (signal) opts.signal = signal;
  if (form) opts.body = form;
  else if (body) { opts.headers = { 'content-type': 'application/json' }; opts.body = JSON.stringify(body); }
  const res = await fetch(API + path, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), data, { status: res.status });
  return data;
}

function toast(msg, kind = 'info') {
  let host = $('#vessel-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'vessel-toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.className = 'fixed bottom-5 left-5 right-5 z-[9999] flex flex-col gap-2 sm:left-auto sm:max-w-md';
    document.body.appendChild(host);
  }
  const colors = { info: '#5ee6ff', error: '#ffb4ab', ok: '#5eead4', warn: '#cebdff' };
  const el = document.createElement('div');
  el.className = 'vessel-glass vessel-technical rounded-control px-5 py-4 text-sm shadow-xl';
  el.style.color = colors[kind] || '#e2e2e9';
  el.style.borderColor = colors[kind] || 'rgba(255,255,255,.12)';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Copied', 'ok')).catch(() => {}); }

function settlementExplorerUrl(chain, transactionId) {
  const id = encodeURIComponent(String(transactionId || ''));
  return chain === 'aptos'
    ? `https://explorer.aptoslabs.com/txn/${id}?network=testnet`
    : `https://explorer.solana.com/tx/${id}?cluster=devnet`;
}

/* ------------------------------- wallet ------------------------------- */
const walletController = () => window.VesselWallets;
const walletOwnedUpload = createWalletOwnedUploadService({
  request: api,
  controller: walletController,
  getSolana: () => window.VesselSolana,
  recovery,
  settleContractQuote,
  createUploadIntent,
  sha256FileHex,
  contentAddressedBlobName,
});
let pendingWalletWork = new AbortController();
let activeUploadContext = null;
let activeWalletIdentity = '';

const walletIdentityKey = (next) => (
  next?.status === 'ready' && next.session
    ? `${next.session.chain}:${next.session.sourceAddress}:${next.session.storageAddress}`
    : ''
);

function invalidateWalletWork(next) {
  const identity = walletIdentityKey(next);
  if (identity === activeWalletIdentity) return;
  activeWalletIdentity = identity;
  pendingWalletWork.abort();
  pendingWalletWork = new AbortController();
  activeUploadContext = null;
  $('#pay-gate')?.remove();
  $('#aptos-funding-gate')?.remove();
  window.resetUpload?.();
}

function renderWallet() {
  const controller = walletController();
  const next = controller?.getState?.() || {};
  const presentation = walletPresentation(next);
  $$('[data-wallet-label]').forEach((el) => { el.textContent = presentation.headerLabel; });
  $$('[data-wallet-summary]').forEach((el) => {
    el.setAttribute('aria-label', presentation.headerAria);
    el.dataset.connected = presentation.connected ? 'true' : 'false';
    el.onclick = (event) => {
      event.preventDefault();
      if (next.status === 'identity_required') {
        return;
      }
      if (next.status === 'network_required') {
        void controller.ensureNetwork().catch((error) => toast(error.message, 'error'));
      } else if (next.session) walletUi?.openAccountMenu(el);
      else void walletUi?.open(el);
    };
  });
  const identityLabel = $('#sign-btn-label');
  if (identityLabel) identityLabel.textContent = presentation.identityLabel;
  const identityButton = $('#sign-btn');
  if (identityButton) identityButton.disabled = presentation.identityDisabled;
}

/* ------------------------------- pages -------------------------------- */
function page() {
  const p = location.pathname.split('/').pop() || 'index.html';
  return p.replace('.html', '') || 'index';
}

function initLanding() {}

async function initIdentity() {
  const renderIdentitySession = (next) => {
    const { session, status: walletStatus } = next;
    const origin = $('#origin-wallet');
    const storage = $('#derived-account');
    const originLabel = $('#origin-wallet-label');
    const storageLabel = $('#storage-account-label');
    if (origin) origin.textContent = session ? shortMid(session.sourceAddress) : '—';
    if (storage) storage.textContent = session ? shortMid(session.storageAddress) : '(connect wallet)';
    if (originLabel) {
      originLabel.textContent = session?.chain === 'aptos'
        ? 'Controlling wallet (Aptos)'
        : session?.chain === 'solana' ? 'Controlling wallet (Solana)' : 'Connected wallet';
    }
    if (storageLabel) {
      storageLabel.textContent = session?.mode === 'native'
        ? 'Native Aptos storage account'
        : session?.mode === 'daa' ? 'Derived Aptos storage account' : 'Shelby storage account';
    }
    const status = $('#auth-status');
    if (status) {
      status.textContent = walletStatus === 'identity_required'
        ? 'Updating the derived Aptos storage identity'
        : walletStatus === 'network_required'
        ? next.error || 'Switch your wallet to the required Aptos network'
        : session
        ? 'Wallet connected · storage identity ready'
        : 'Choose an Aptos or Solana wallet';
    }
    window.__storageSolana = session?.chain === 'solana' ? session.sourceAddress : '';
    window.__storageAcct = session?.storageAddress || '';
  };

  renderIdentitySession(walletController().getState());
  walletController().subscribe(renderIdentitySession);
  const signBtn = $('#sign-btn');
  if (signBtn) signBtn.onclick = (event) => {
    event.preventDefault();
    const next = walletController().getState();
    if (next.status === 'network_required') {
      void walletController().ensureNetwork().catch((error) => toast(error.message, 'error'));
    } else if (!next.session) void walletUi.open(signBtn);
  };
  $$('.js-copy-origin').forEach((button) => {
    button.onclick = () => copy(walletController().getState().session?.sourceAddress || '');
  });
  $$('.js-copy-derived').forEach((button) => {
    button.onclick = () => copy(walletController().getState().session?.storageAddress || '');
  });
}

function initUpload() {
  const dz = $('#drop-zone'); const input = $('#file-input'); const folderInput = $('#folder-input');
  const folderPicker = $('#folder-picker');
  const vInit = $('#upload-initial-view'); const vProg = $('#upload-progress-view'); const vDone = $('#upload-success-view');
  const bar = $('#progress-bar'); const pct = $('#progress-percentage'); const fname = $('#upload-filename');
  const quoteRoot = $('#upload-options');
  const selectedName = $('#selected-file-name');
  const selectedDetails = $('#selected-file-details');
  const quoteConfirm = $('#quote-confirm');
  const batchSummary = $('#batch-summary');
  const batchStatus = $('#batch-status');
  const batchCurrentFile = $('#batch-current-file');
  const batchProgress = $('#batch-progress');
  const batchResults = $('#batch-results');
  const batchRetry = $('#batch-retry');
  const batchReset = $('#batch-reset');
  const show = (el) => { [vInit, vProg, vDone].forEach((v) => v && v.classList.add('hidden')); el && el.classList.remove('hidden'); };

  const SOL = () => window.VesselSolana;
  let selectedFile = null;
  let quoteUi = null;
  let batchQueue = null;
  let batchRunning = false;

  const stepPct = {
    encoding: 20,
    signing: 40,
    settlementApproval: 55,
    settlementPending: 65,
    receiptVerified: 72,
    confirming: 80,
    sponsoring: 84,
    uploading: 92,
  };
  const stepMsg = {
    encoding: 'ENCODING COMMITMENTS',
    signing: 'SIGNING OWNERSHIP',
    settlementApproval: 'APPROVE VESSEL CONTRACT FEE',
    settlementPending: 'CONFIRMING CONTRACT RECEIPT',
    receiptVerified: 'VESSEL RECEIPT VERIFIED',
    confirming: 'REGISTERING ON APTOS',
    sponsoring: 'SPONSORING APTOS',
    uploading: 'WRITING TO SHELBY',
  };
  function setStep(s) { if (bar) bar.style.width = (stepPct[s] || 20) + '%'; if (pct) pct.textContent = stepMsg[s] || s; }

  async function requestQuote(file) {
    if (!file || !quoteUi) return;
    const walletState = walletController().getState();
    if (!walletState.session || walletState.status !== 'ready') {
      activeUploadContext = null;
      quoteUi.render({ kind: 'unavailable', message: 'Connect a supported testnet wallet to request a quote.' });
      const opener = document.querySelector('[data-wallet-summary]');
      if (walletState.status === 'network_required') {
        void walletController().ensureNetwork().catch((error) => toast(error.message, 'error'));
      } else {
        void walletUi.open(opener);
      }
      return;
    }

    pendingWalletWork.abort();
    pendingWalletWork = new AbortController();
    const signal = pendingWalletWork.signal;
    activeUploadContext = null;
    quoteRoot?.classList.remove('hidden');
    quoteUi.render({ kind: 'loading' });
    try {
      activeUploadContext = await walletOwnedUpload.quote(file, { days: quoteUi.days(), signal });
      if (signal.aborted) return null;
      quoteUi.render({ kind: 'ready', quote: activeUploadContext.quote });
      return activeUploadContext;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      quoteUi.render({ kind: 'unavailable', message: String(error?.message || error).slice(0, 180) });
      return null;
    }
  }

  async function selectFile(file) {
    if (!file) return;
    batchQueue = null;
    batchRunning = false;
    batchSummary?.classList.add('hidden');
    dz?.classList.remove('hidden');
    selectedFile = file;
    if (selectedName) selectedName.textContent = file.name;
    if (selectedDetails) selectedDetails.textContent = `${(file.size / 1048576).toFixed(2)} MB · ${file.type || 'application/octet-stream'}`;
    if (fname) fname.textContent = `${file.name} (${(file.size / 1048576).toFixed(2)}MB)`;
    quoteRoot?.classList.remove('hidden');
    await requestQuote(file);
  }

  async function validateUploadQuote(current, signal = pendingWalletWork.signal) {
    const context = await walletOwnedUpload.validate(current, { signal });
    activeUploadContext = context;
    return Object.freeze({ context, requiresConfirmation: context.requiresConfirmation });
  }

  function renderChangedQuote(context) {
    quoteUi.render({
      kind: 'ready',
      quote: context.quote,
      message: 'The live price changed by more than 5%. Review the new total and confirm again.',
      confirmLabel: 'CONFIRM UPDATED PRICE',
    });
  }

  async function confirmQuotedUpload() {
    const current = activeUploadContext;
    if (!current) return;
    const walletState = walletController().getState();
    if (walletIdentityKey(walletState) !== `${current.intent.chain}:${current.intent.sourceAddress}:${current.intent.storageAddress}`) {
      activeUploadContext = null;
      quoteUi.render({ kind: 'unavailable', message: 'The connected wallet changed. Request a new quote.' });
      return;
    }
    if (Date.now() >= current.quote.expiresAtMs) {
      quoteUi.render({ kind: 'expired', message: 'Quote expired — refresh to continue' });
      return;
    }
    pendingWalletWork.abort();
    pendingWalletWork = new AbortController();
    quoteUi.render({ kind: 'loading' });
    try {
      const validated = await validateUploadQuote(current);
      if (validated.requiresConfirmation) {
        renderChangedQuote(validated.context);
        return;
      }
      const outcome = await doUpload(current.file, validated.context);
      if (outcome?.ok) renderSuccess(outcome.result);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      const expired = error?.code === 'quote_expired' || error?.status === 410;
      quoteUi.render({
        kind: expired ? 'expired' : 'unavailable',
        message: String(error?.message || error).slice(0, 180),
      });
    }
  }

  quoteUi = mountQuoteUi({
    root: quoteRoot,
    onRetentionChange: () => {
      activeUploadContext = null;
      if (selectedFile) void requestQuote(selectedFile);
    },
  });
  quoteConfirm?.addEventListener('click', () => void (batchQueue ? startBatchUpload() : confirmQuotedUpload()));

  const formatBytes = (bytes) => (
    bytes >= 1073741824
      ? `${(bytes / 1073741824).toFixed(2)} GB`
      : `${(bytes / 1048576).toFixed(2)} MB`
  );
  const waitForBatchReceiptFinality = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function findUploadRecoveryRecordForFile(file) {
    const session = walletController().getState().session;
    if (!session || !file) return null;
    const fileHash = await sha256FileHex(file);
    const blobName = contentAddressedBlobName(file, fileHash);
    return recovery.loadForWallet(session).find((record) => (
      record.context?.fileHash === fileHash
      && record.context?.blobName === blobName
      && !['quoted', 'active'].includes(record.stage)
    )) || null;
  }

  async function resumePendingBatchUpload(file, recoveryRecord, item) {
    let lastError = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      renderBatchState({ phase: 'receiptPending', item });
      if (attempt > 0) await waitForBatchReceiptFinality(Math.min(1200 + attempt * 700, 4000));
      try {
        const result = await walletOwnedUpload.resume(file, recoveryRecord, {
          signal: pendingWalletWork.signal,
          onStep: setStep,
        });
        activeUploadContext = null;
        $('#upload-recovery')?.remove();
        return result;
      } catch (error) {
        if (error?.code !== 'receipt_pending') throw error;
        lastError = error;
        recoveryRecord = await findUploadRecoveryRecordForFile(file) || recoveryRecord;
      }
    }
    throw Object.assign(
      new Error('Settlement receipt is still finalizing. No second payment is required. Use Check Payment Status or retry this batch later.'),
      { code: 'receipt_pending', retriable: true, cause: lastError },
    );
  }

  function renderBatchState({ phase = 'ready', item = null, error = null } = {}) {
    if (!batchQueue || !batchSummary) return;
    const summary = batchQueue.summary();
    batchSummary.classList.remove('hidden');
    const set = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
    set('#batch-file-count', `${summary.total}`);
    set('#batch-total-size', formatBytes(summary.totalBytes));
    set('#batch-success-count', `${summary.succeeded}`);
    set('#batch-failure-count', `${summary.failed}`);
    if (batchProgress) {
      batchProgress.value = summary.progressPercent;
      batchProgress.textContent = `${summary.progressPercent}%`;
    }
    if (batchCurrentFile) {
      batchCurrentFile.textContent = item?.relativePath
        ? `${summary.completed + 1} of ${summary.total}: ${item.relativePath}`
        : 'No file is uploading.';
    }
    if (batchStatus) {
      batchStatus.textContent = phase === 'uploading'
        ? 'Keep this tab open. Complete each wallet approval as it appears.'
        : phase === 'receiptPending'
          ? 'Contract receipt is finalizing. Vessel is checking automatically. No second payment is required.'
        : phase === 'complete'
          ? `Batch complete. ${summary.succeeded} files are active on Shelby.`
          : phase === 'failed'
            ? `Batch paused: ${String(error?.message || error || 'Upload failed').slice(0, 160)}`
            : `${summary.total} supported files selected${batchQueue.rejected.length ? `; ${batchQueue.rejected.length} unsupported or empty files skipped` : ''}.`;
    }
    const retryableFailures = batchQueue.items.filter(
      (entry) => entry.status === 'failed' && entry.error?.retryable !== false,
    ).length;
    if (batchRetry) batchRetry.classList.toggle('hidden', retryableFailures === 0);
    if (batchReset) batchReset.disabled = batchRunning;

    if (batchResults) {
      const important = batchQueue.items.filter((entry) => entry.status === 'failed' || entry.status === 'uploading');
      const recent = batchQueue.items.filter((entry) => entry.status === 'succeeded').slice(-20);
      const upcoming = batchQueue.items.filter((entry) => entry.status === 'queued').slice(0, 5);
      const visible = [...new Map([...important, ...recent, ...upcoming].map((entry) => [entry.id, entry])).values()];
      batchResults.replaceChildren(...visible.map((entry) => {
        const row = document.createElement('li');
        row.className = 'flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3 text-left';
        const path = document.createElement('span');
        path.className = 'vessel-technical min-w-0 truncate text-xs text-on-surface-variant';
        path.title = entry.relativePath;
        path.textContent = entry.relativePath;
        const state = document.createElement('span');
        state.className = entry.status === 'succeeded'
          ? 'vessel-kicker shrink-0 text-primary'
          : entry.status === 'failed'
            ? 'vessel-kicker shrink-0 text-secondary'
            : 'vessel-kicker shrink-0 text-outline';
        state.textContent = entry.status;
        row.append(path, state);
        return row;
      }));
    }
  }

  function showTransactionProgress() {
    if (!batchQueue) {
      show(vProg);
      return;
    }
    show(vInit);
    dz?.classList.add('hidden');
    quoteRoot?.classList.add('hidden');
    batchSummary?.classList.remove('hidden');
  }

  async function selectBatch(files) {
    if (!files?.length || batchRunning) return;
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const maxFileBytes = cfg.maxUploadBytes || 25 * 1024 * 1024;
      batchQueue = createBatchQueue(files, { maxFileBytes });
      const first = batchQueue.next();
      selectedFile = first.file;
      if (selectedName) selectedName.textContent = first.relativePath;
      if (selectedDetails) selectedDetails.textContent = `${batchQueue.items.length} files · ${formatBytes(batchQueue.totalBytes)} · one retention period`;
      if (fname) fname.textContent = first.relativePath;
      show(vInit);
      renderBatchState();
      quoteRoot?.classList.remove('hidden');
      await requestQuote(first.file);
    } catch (error) {
      batchQueue = null;
      batchSummary?.classList.add('hidden');
      toast(String(error?.message || error).slice(0, 160), 'error');
    }
  }

  async function uploadBatchItem(item) {
    selectedFile = item.file;
    if (selectedName) selectedName.textContent = item.relativePath;
    if (selectedDetails) selectedDetails.textContent = `${formatBytes(item.size)} · batch item`;
    const recoveryRecord = await findUploadRecoveryRecordForFile(item.file);
    if (recoveryRecord) {
      const resumed = await resumePendingBatchUpload(item.file, recoveryRecord, item);
      const result = Object.freeze({ ...resumed, sourcePath: item.relativePath });
      ledger.commitUpload(result);
      return result;
    }
    let current = activeUploadContext?.file === item.file ? activeUploadContext : null;
    if (!current || Date.now() >= current.quote.expiresAtMs) current = await requestQuote(item.file);
    if (!current) throw Object.assign(new Error('A signed quote could not be prepared'), { code: 'quote_unavailable' });

    pendingWalletWork.abort();
    pendingWalletWork = new AbortController();
    const validated = await validateUploadQuote(current);
    if (validated.requiresConfirmation) {
      batchRunning = false;
      show(vInit);
      dz?.classList.add('hidden');
      quoteRoot?.classList.remove('hidden');
      renderChangedQuote(validated.context);
      throw Object.assign(new Error('Review the updated price, then continue the batch'), {
        code: 'batch_price_confirmation_required',
      });
    }

    const outcome = await doUpload(item.file, validated.context);
    let uploaded = outcome?.result;
    if (!outcome?.ok && outcome.error?.code === 'receipt_pending') {
      const pendingRecord = await findUploadRecoveryRecordForFile(item.file);
      if (!pendingRecord) throw outcome.error;
      uploaded = await resumePendingBatchUpload(item.file, pendingRecord, item);
    } else if (!outcome?.ok) {
      throw outcome?.error || new Error('Upload did not complete');
    }
    const result = Object.freeze({ ...uploaded, sourcePath: item.relativePath });
    ledger.commitUpload(result);
    return result;
  }

  async function startBatchUpload() {
    if (!batchQueue || batchRunning) return;
    if (batchQueue.summary().failed) batchQueue.retryFailed();
    batchRunning = true;
    dz?.classList.add('hidden');
    quoteRoot?.classList.add('hidden');
    renderBatchState({ phase: 'uploading', item: batchQueue.next() });
    const outcome = await runBatchQueue(batchQueue, uploadBatchItem, { onUpdate: renderBatchState });
    batchRunning = false;
    show(vInit);
    if (outcome.status === 'complete') {
      renderBatchState({ phase: 'complete' });
      toast(`${outcome.summary.succeeded} files stored on Shelby`, 'ok');
      return;
    }
    renderBatchState({ phase: 'failed', item: outcome.item, error: outcome.error });
    if (outcome.error?.code === 'batch_price_confirmation_required') {
      quoteRoot?.classList.remove('hidden');
    }
  }

  batchRetry?.addEventListener('click', () => {
    batchQueue?.retryFailed();
    void startBatchUpload();
  });
  batchReset?.addEventListener('click', () => window.resetUpload?.());

  async function renderRecoveryPanel() {
    $('#upload-recovery')?.remove();
    const session = walletController().getState().session;
    if (!session) return;
    const record = recovery.loadForWallet(session)
      .find((item) => item.stage !== 'quoted' && item.stage !== 'active');
    if (!record) return;
    const panel = document.createElement('section');
    panel.id = 'upload-recovery';
    panel.className = 'mt-6 rounded-control border border-secondary/20 bg-secondary/5 p-5';
    panel.setAttribute('aria-labelledby', 'upload-recovery-title');
    const kicker = document.createElement('p');
    kicker.className = 'vessel-kicker text-secondary';
    kicker.textContent = 'RECOVERY AVAILABLE';
    const title = document.createElement('h2');
    title.id = 'upload-recovery-title';
    title.className = 'mt-2 font-display text-xl font-semibold';
    title.textContent = record.stage === 'settlement_submitted'
      ? 'Contract submitted — receipt pending'
      : record.stage === 'paid'
        ? 'Payment verified — finish this upload'
        : 'Finish writing the registered artifact';
    const copyText = document.createElement('p');
    copyText.className = 'mt-3 text-sm leading-6 text-on-surface-variant';
    copyText.textContent = record.stage === 'settlement_submitted'
      ? 'Your wallet transaction is saved. Vessel will only check its existing receipt; it will not request another payment.'
      : `Reselect ${record.context.blobName}. Vessel will verify its SHA-256 before any irreversible action.`;
    panel.append(kicker, title, copyText);

    if (record.stage === 'settlement_submitted') {
      const explorer = document.createElement('a');
      explorer.className = 'vessel-technical mt-4 block break-all text-xs text-primary hover:text-primary-container';
      explorer.href = settlementExplorerUrl(record.context.chain, record.settlementTransactionId);
      explorer.target = '_blank';
      explorer.rel = 'noreferrer';
      explorer.textContent = `VIEW TRANSACTION ${shortMid(record.settlementTransactionId, 8)} ↗`;
      const status = document.createElement('p');
      status.className = 'mt-3 text-sm leading-6 text-on-surface-variant';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = 'Checking the finalized Vessel receipt…';
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'vessel-button vessel-button-secondary mt-4 min-h-11 px-5 py-3';
      check.textContent = 'CHECK PAYMENT STATUS';
      panel.append(explorer, status, check);
      quoteRoot?.parentElement?.appendChild(panel);

      const verifyRecordedSettlement = async () => {
        check.disabled = true;
        status.textContent = 'Checking the finalized Vessel receipt…';
        try {
          const verified = await settleContractQuote({
            quote: {
              quoteToken: record.quoteToken,
              uploadContext: record.context,
              contractQuote: record.contractQuote,
              contractSignature: record.contractSignature,
              quotePublicKey: record.quotePublicKey,
            },
            transactionId: record.settlementTransactionId,
            request: api,
          });
          const settlementHash = verified.receipt?.transactionId
            || record.settlementTransactionId;
          recovery.advance(record.id, 'paid', {
            paidAuthorization: verified.paidAuthorization,
            settlementHash,
            paymentSignature: settlementHash,
          });
          status.textContent = 'Vessel receipt verified. Reselect the file to finish writing it.';
          toast('Vessel contract receipt verified', 'ok');
          await renderRecoveryPanel();
        } catch (error) {
          if (error?.code === 'receipt_pending') {
            status.textContent = 'Receipt is still pending finality. No new payment is required.';
          } else {
            status.textContent = String(error?.message || error).slice(0, 180);
          }
          check.disabled = false;
        }
      };
      check.addEventListener('click', () => void verifyRecordedSettlement());
      void verifyRecordedSettlement();
      return;
    }

    const label = document.createElement('label');
    label.className = 'vessel-button vessel-button-secondary mt-4 px-5 py-3';
    label.textContent = 'RESELECT FILE TO RESUME';
    const recoveryInput = document.createElement('input');
    recoveryInput.type = 'file';
    recoveryInput.className = 'sr-only';
    label.appendChild(recoveryInput);
    panel.append(label);
    quoteRoot?.parentElement?.appendChild(panel);

    recoveryInput.addEventListener('change', async () => {
      const file = recoveryInput.files?.[0];
      if (!file) return;
      const hash = await sha256FileHex(file);
      if (hash !== record.context.fileHash) {
        toast('Selected file does not match the recovery SHA-256', 'error');
        return;
      }
      panel.remove();
      if (record.stage === 'paid') {
        const recoveredSettlementNetwork = record.context.chain === 'solana'
          ? 'Solana Devnet'
          : record.context.sourceNetwork === 'shelbynet' ? 'ShelbyNet' : 'Aptos Testnet';
        const recoveredSettlementToken = record.context.chain === 'solana'
          ? 'Devnet USDC'
          : record.context.sourceNetwork === 'shelbynet' ? 'APT + ShelbyUSD' : 'APT + ShelbyUSD';
        const recoveredExpirationMs = Math.floor(Number(record.context.expirationMicros || 0) / 1000);
        const config = await api('/api/config').catch(() => ({}));
        const quote = Object.freeze({
          ...record.context,
          quoteId: record.quoteId,
          quoteToken: record.quoteToken,
          tierId: record.paymentTier,
          totalAccountingMicro: record.quotedAccountingMicro,
          storageAccountingMicro: record.storageCostAccountingMicro,
          gasAccountingMicro: record.gasAccountingMicro,
          serviceFeeAccountingMicro: record.serviceFeeAccountingMicro,
          settlementToken: recoveredSettlementToken,
          settlementNetwork: recoveredSettlementNetwork,
          targetExpirationUtc: new Date(recoveredExpirationMs).toISOString(),
          expiresAtMs: Date.now() + 300_000,
          solanaAmountMicro: record.quotedAccountingMicro,
          contractQuote: record.contractQuote,
          contractSignature: record.contractSignature,
          quotePublicKey: record.quotePublicKey,
          settlementDeployment: record.settlementDeployment,
        });
        const recoveredContext = Object.freeze({
          file,
          intent: Object.freeze({ ...record.context }),
          quote,
          config: Object.freeze({ ...config }),
          walletKey: [
            record.context.chain,
            record.context.sourceAddress,
            record.context.storageAddress,
          ].join(':').toLowerCase(),
          settlement: Object.freeze({
            paidAuthorization: record.paidAuthorization,
            settlementHash: record.settlementHash,
          }),
        });
        selectedFile = file;
        activeUploadContext = recoveredContext;
        const outcome = await doUpload(file, recoveredContext);
        if (outcome?.ok) renderSuccess(outcome.result);
        return;
      }
      try {
        recovery.advance(record.id, 'uploading');
        await walletController().resumeBlobWrite(file, record);
        recovery.advance(record.id, 'finalizing');
        const remote = await walletController().listArtifacts();
        const matched = remote.find((item) => item.blobNameSuffix === record.context.blobName);
        if (matched?.isWritten) {
          renderSuccess({
            key: matched.blobNameSuffix || record.context.blobName,
            url: matched.url,
            size: Number(matched.size || record.context.sizeBytes || 0),
            contentType: matched.contentType || record.context.contentType,
            ownedByYou: true,
            account: record.context.storageAddress,
            expirationMicros: Number(matched.expirationMicros || record.context.expirationMicros),
            registerTransactionHash: record.registerTransactionHash,
            acknowledgementHash: record.acknowledgementHash,
            settlementHash: record.settlementHash,
            quotedAccountingMicro: record.quotedAccountingMicro,
          });
          recovery.complete(record.id);
          toast('Recovered upload is active on Shelby', 'ok');
        } else {
          recovery.advance(record.id, 'recovery_required', { errorCode: 'acknowledgement_timeout' });
          toast('Bytes were resent; Shelby acknowledgement is still pending', 'warn');
          await renderRecoveryPanel();
        }
      } catch (error) {
        recovery.advance(record.id, 'recovery_required', { errorCode: error.code || 'resume_failed' });
        toast(String(error?.message || error).slice(0, 160), 'error');
        await renderRecoveryPanel();
      }
    });
  }

  void renderRecoveryPanel();

  async function doUpload(file, quotedContext = activeUploadContext) {
    const failed = (error) => Object.freeze({ ok: false, error });
    if (!file) return failed(new Error('Choose a file before uploading'));
    if (!quotedContext?.quote || !quotedContext?.intent) {
      await requestQuote(file);
      return failed(new Error('Review the signed quote before uploading'));
    }

    const walletState = walletController().getState();
    const session = walletState.session;
    if (!session || walletState.status !== 'ready') {
      toast('Connect a wallet before uploading', 'warn');
      const opener = document.querySelector('[data-wallet-summary]');
      if (walletState.status === 'network_required') {
        void walletController().ensureNetwork().catch((error) => toast(error.message, 'error'));
      } else {
        void walletUi.open(opener);
      }
      return failed(Object.assign(
        new Error('Connect a wallet before uploading'),
        { code: 'wallet_required' },
      ));
    }

    if (fname) fname.textContent = `${file.name} (${(file.size / 1048576).toFixed(2)}MB)`;
    showTransactionProgress();
    try {
      const result = await walletOwnedUpload.upload(quotedContext, {
        signal: pendingWalletWork.signal,
        onStep: setStep,
        onSubmitted: ({ transactionId }) => {
          quotedContext = Object.freeze({ ...quotedContext, settlementTransactionId: transactionId });
          activeUploadContext = quotedContext;
        },
      });
      activeUploadContext = null;
      if (bar) bar.style.width = '100%';
      if (pct) pct.textContent = '100%';
      return Object.freeze({ ok: true, result });
    } catch (error) {
      show(vInit);
      if (error?.name === 'AbortError') return failed(error);
      if (error?.code === 'insufficient_usdc') {
        showPayGate(quotedContext.quote, error.balance, () => void confirmQuotedUpload());
      } else if (['insufficient_apt', 'insufficient_shelby_usd'].includes(error?.code)) {
        showAptosFundingGate({
          code: error.code,
          session,
          retry: () => void (batchQueue ? startBatchUpload() : confirmQuotedUpload()),
        });
      } else if (error?.code === 'receipt_pending') {
        toast('Contract submitted. Receipt is pending; no new payment is required.', 'warn');
        await renderRecoveryPanel();
      } else {
        const message = error?.code === 'user_rejected'
          ? 'Payment approval was rejected'
          : String(error?.message || error).slice(0, 160);
        activeUploadContext = quotedContext;
        quoteUi.render({ kind: 'ready', quote: quotedContext.quote, message });
        toast(message.toLowerCase().includes('reject') ? 'Signature rejected' : message, 'error');
        await renderRecoveryPanel();
      }
      return failed(error);
    }
  }

  function showAptosFundingGate({ code, session, retry }) {
    $('#aptos-funding-gate')?.remove();
    const panel = document.createElement('section');
    panel.id = 'aptos-funding-gate';
    panel.className = 'vessel-glass rounded-vessel p-6 mt-6 w-full';
    panel.setAttribute('role', 'alert');

    const title = document.createElement('p');
    title.className = 'vessel-kicker text-secondary';
    title.textContent = code === 'insufficient_apt'
      ? 'APT REQUIRED FOR GAS'
      : 'SHELBYUSD REQUIRED FOR STORAGE';
    const detail = document.createElement('p');
    detail.className = 'mt-3 text-sm leading-6 text-on-surface-variant';
    detail.textContent = `Fund ${shortMid(session.sourceAddress)} on ShelbyNet, then retry.`;

    const actions = document.createElement('div');
    actions.className = 'mt-5 flex flex-wrap gap-3';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = "I'VE FUNDED — RETRY";
    button.className = 'vessel-button vessel-button-primary px-4 py-3';
    button.addEventListener('click', retry, { once: true });
    actions.appendChild(button);
    panel.append(title, detail, actions);
    ($('#drop-zone')?.parentElement || document.body).appendChild(panel);
    toast('Fund your ShelbyNet wallet, then retry', 'warn');
  }

  function showPayGate(quote, have, retryUpload) {
    const host = $('#drop-zone')?.parentElement || document.body;
    let g = $('#pay-gate');
    if (!g) {
      g = document.createElement('div');
      g.id = 'pay-gate';
      g.setAttribute('role', 'alert');
      g.className = 'vessel-glass rounded-vessel p-6 mt-6 w-full';
      host.appendChild(g);
    }
    g.replaceChildren();
    const title = document.createElement('p');
    title.className = 'vessel-kicker text-secondary mb-3';
    title.textContent = 'NEED TESTNET USDC TO PAY STORAGE';
    const detail = document.createElement('p');
    detail.className = 'text-sm leading-6 text-on-surface-variant mb-4';
    const requiredUsdc = Number(quote.solanaAmountMicro) / 1_000_000;
    detail.textContent = `This upload costs ${requiredUsdc} USDC; your wallet has ${have.toFixed(4)}. Vessel sponsors Aptos gas and ShelbyUSD for the Solana DAA path.`;
    const retry = document.createElement('button');
    retry.id = 'pay-retry';
    retry.type = 'button';
    retry.className = 'vessel-button vessel-button-primary px-4 py-3';
    retry.textContent = 'I HAVE USDC — RETRY';
    g.append(title, detail, retry);
    retry.addEventListener('click', async () => {
      const b = await SOL().usdcBalance();
      if (b >= requiredUsdc) {
        g.remove();
        toast('USDC ready ✓', 'ok');
        retryUpload?.();
      } else toast(`Still ${b.toFixed(4)} USDC — add funds and retry`, 'warn');
    });
    toast('Add testnet USDC to continue (see panel)', 'warn');
  }
  function renderSuccess(r) {
    show(vDone);
    const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
    set('#result-key', r.key);
    const urlEl = $('#result-url'); if (urlEl) urlEl.textContent = r.url;
    set('#result-size', `${(r.size / 1048576).toFixed(2)} MB`);
    const img = $('#result-thumb'); if (img && (r.contentType || '').startsWith('image/')) img.src = r.url;
    ledger.commitUpload(r);
    if (r.ownedByYou) {
      const paid = r.paidUsdc ? ` · paid ${r.paidUsdc} USDC` : '';
      toast('Stored on Shelby — owned by YOUR wallet ✓' + (r.paidUsdc ? `, sponsored${paid}` : ''), 'ok');
      const k = $('#result-key'); if (k) k.textContent = r.key + '  (owned by your wallet' + paid + ')';
    }
    $('#copy-url')?.addEventListener('click', () => copy(r.url), { once: false });
    const meta = $('#to-metadata'); if (meta) meta.onclick = () => (location.href = '/metadata.html');
  }
  if (dz) {
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length > 1) void selectBatch(files);
      else void selectFile(files[0]);
    });
  }
  if (input) input.addEventListener('change', (e) => void selectFile(e.target.files[0]));
  if (folderPicker) folderPicker.addEventListener('click', () => void (async () => {
    if (!supportsDirectoryPicker(window)) {
      if (folderInput) folderInput.click();
      return;
    }
    try {
      const directory = await window.showDirectoryPicker({ mode: 'read' });
      const files = await collectDirectoryFiles(directory);
      await selectBatch(files);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        toast(String(error?.message || error).slice(0, 160), 'error');
      }
    }
  })());
  if (folderInput) folderInput.addEventListener('change', (event) => void selectBatch([...event.target.files]));
  window.resetUpload = () => {
    pendingWalletWork.abort();
    pendingWalletWork = new AbortController();
    selectedFile = null;
    activeUploadContext = null;
    batchQueue = null;
    batchRunning = false;
    quoteUi?.reset();
    quoteRoot?.classList.add('hidden');
    batchSummary?.classList.add('hidden');
    dz?.classList.remove('hidden');
    show(vInit);
    if (input) input.value = '';
    if (folderInput) folderInput.value = '';
  };
}

function safeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function toAppUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    return new URL(text, location.origin).href;
  } catch {
    return text;
  }
}

function sourceDisplayName(it) {
  const source = String(it?.sourcePath || '').split('/').filter(Boolean).pop();
  const key = String(it?.key || '').split('/').filter(Boolean).pop();
  return source || key || 'Untitled artifact';
}

function folderCollectionId(it) {
  const parts = String(it?.sourcePath || '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

function isMetadataArtifact(it) {
  const type = String(it?.contentType || '').toLowerCase();
  return type === 'application/json' || /\.json(?:$|[?#])/i.test(`${it?.key || ''} ${it?.url || ''}`);
}

function isMediaArtifact(it) {
  const type = String(it?.contentType || '').toLowerCase();
  return !isMetadataArtifact(it) && (
    type.startsWith('image/')
    || type.startsWith('video/')
    || /\.(?:avif|gif|jpe?g|png|svg|webp|mp4|mov|m4v|webm)(?:$|[?#])/i.test(`${it?.key || ''} ${it?.url || ''}`)
  );
}

function splitGalleryArtifacts(items, query = '') {
  const needle = String(query || '').trim().toLowerCase();
  const matches = (item) => !needle
    || sourceDisplayName(item).toLowerCase().includes(needle)
    || String(item?.sourcePath || item?.key || '').toLowerCase().includes(needle);
  const media = [];
  const metadata = [];
  for (const item of items || []) {
    if (isMetadataArtifact(item)) {
      if (matches(item)) metadata.push(item);
    } else if (isMediaArtifact(item) && matches(item)) {
      media.push(item);
    }
  }
  const looseMedia = [];
  const collectionMap = new Map();
  for (const item of media) {
    const collectionId = folderCollectionId(item);
    if (!collectionId) {
      looseMedia.push(item);
      continue;
    }
    if (!collectionMap.has(collectionId)) {
      collectionMap.set(collectionId, { id: collectionId, name: collectionId, items: [] });
    }
    collectionMap.get(collectionId).items.push(item);
  }
  const collections = [...collectionMap.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  looseMedia.sort((a, b) => sourceDisplayName(a).localeCompare(sourceDisplayName(b), undefined, { numeric: true }));
  metadata.sort((a, b) => sourceDisplayName(a).localeCompare(sourceDisplayName(b), undefined, { numeric: true }));
  return Object.freeze({ collections, looseMedia, metadata });
}

async function initGallery() {
  const grid = $('#gallery-grid');
  const imageGrid = $('#image-gallery-grid');
  const metadataGrid = $('#metadata-gallery-grid');
  const imageEmpty = $('#gallery-image-empty');
  const metadataEmpty = $('#gallery-metadata-empty');
  const search = $('#gallery-search');
  const exportCsv = $('#gallery-export-csv');
  const status = $('#gallery-view-status');
  const back = $('#gallery-back-collections');
  if (!grid || !imageGrid || !metadataGrid) return;
  let activeGalleryCollection = '';
  // Gallery = the visitor's OWN uploads (owned by their DAA account), tracked in this browser.
  let items = loadMine();
  const walletState = walletController().getState();
  if (walletState.status === 'ready' && walletState.session) {
    try {
      const remote = await walletController().listArtifacts();
      items = walletController().reconcileArtifacts(items, remote);
      replaceMine(items);
    } catch (error) {
      toast(`Using cached Gallery: ${String(error?.message || error).slice(0, 100)}`, 'warn');
    }
  }
  const count = $('#artifact-count');
  if (count) count.textContent = `${items.length} ${items.length === 1 ? 'artifact' : 'artifacts'}`;
  renderFeeDashboard(items);
  if (exportCsv) {
    exportCsv.disabled = !items.length;
    exportCsv.onclick = () => downloadBlob(galleryManifestCsv(items), 'vessel-gallery-manifest.csv', document);
  }

  const bindGalleryActions = () => {
    $$('.js-artifact-image', grid).forEach((img) => {
      const markUnavailable = () => {
        img.setAttribute('aria-hidden', 'true');
        img.classList.add('hidden');
        img.parentElement?.querySelector('.js-artifact-fallback')?.classList.remove('hidden');
      };
      img.addEventListener('error', markUnavailable, { once: true });
      if (img.complete && img.naturalWidth === 0) markUnavailable();
    });
    $$('.js-gallery-collection', grid).forEach((b) => (b.onclick = () => {
      activeGalleryCollection = b.dataset.collectionId || '';
      renderGallerySections();
    }));
    $$('.js-copy', grid).forEach((b) => (b.onclick = () => copy(b.dataset.url)));
    $$('.js-view', grid).forEach((b) => (b.onclick = () => window.open(b.dataset.url, '_blank')));
    $$('.js-meta', grid).forEach((b) => (b.onclick = () => {
      ledger.selectArtifact({ key: b.dataset.key, url: b.dataset.url });
      location.href = '/metadata.html';
    }));
    $$('.js-proof', grid).forEach((b) => (b.onclick = () => {
      const proof = new URL('/proof.html', location.origin);
      proof.searchParams.set('key', b.dataset.key || '');
      proof.searchParams.set('url', b.dataset.url || '');
      proof.searchParams.set('tokenuri', b.dataset.tokenuri || '');
      location.href = proof.pathname + proof.search;
    }));
    $$('.js-del', grid).forEach((b) => (b.onclick = async () => {
      const confirmed = await confirmAction({
        opener: b,
        kicker: 'GALLERY ACTION',
        title: 'Remove artifact?',
        message: "This removes the artifact from this browser's Gallery. The blob stays on Shelby until it expires.",
        cancelLabel: 'CANCEL',
        confirmLabel: 'REMOVE FROM GALLERY',
      });
      if (!confirmed) return;
      forgetMine(b.dataset.key);
      toast('Removed from gallery', 'ok');
      await initGallery();
      document.querySelector('#gallery-title')?.focus();
    }));
  };

  function renderGallerySections() {
    const query = search?.value || '';
    const split = splitGalleryArtifacts(items, query);
    const activeCollection = split.collections.find((entry) => entry.id === activeGalleryCollection);
    const mediaCards = activeCollection
      ? activeCollection.items.map(gcard)
      : [
        newSlot(),
        ...split.collections.map(folderCollectionCard),
        ...split.looseMedia.map(gcard),
      ];
    imageGrid.innerHTML = mediaCards.join('');
    metadataGrid.innerHTML = split.metadata.map(metadataCard).join('');
    imageEmpty?.classList.toggle('hidden', mediaCards.length > (activeCollection ? 0 : 1));
    metadataEmpty?.classList.toggle('hidden', split.metadata.length > 0);
    back?.classList.toggle('hidden', !activeCollection);
    if (status) {
      status.textContent = activeCollection
        ? `${activeCollection.name}: ${activeCollection.items.length} media file${activeCollection.items.length === 1 ? '' : 's'} shown by original folder filename.`
        : 'Images and hosted TokenURI metadata are separated for NFT workflows.';
    }
    bindGalleryActions();
  }

  back?.addEventListener('click', () => {
    activeGalleryCollection = '';
    renderGallerySections();
  });
  search?.addEventListener('input', () => {
    activeGalleryCollection = '';
    renderGallerySections();
  });
  renderGallerySections();
}
function accountingMicro(value) {
  try {
    const text = String(value ?? '').trim();
    return text ? BigInt(text) : 0n;
  } catch {
    return 0n;
  }
}
function formatAccountingUsd(micro) {
  const value = accountingMicro(micro);
  const whole = value / 1_000_000n;
  const frac = String(value % 1_000_000n).padStart(6, '0');
  return `$${whole}.${frac}`;
}
function hasAccountingValue(item, field) {
  return item?.[field] !== undefined && item?.[field] !== null && String(item[field]).trim() !== '';
}
function hasAccountingBreakdown(item) {
  return hasAccountingValue(item, 'storageCostAccountingMicro')
    && hasAccountingValue(item, 'serviceFeeAccountingMicro');
}
function renderFeeDashboard(items) {
  const totals = (items || []).reduce((sum, item) => {
    const total = accountingMicro(item.totalAccountingMicro || item.quotedAccountingMicro);
    const hasBreakdown = hasAccountingBreakdown(item);
    return {
      total: sum.total + total,
      storage: sum.storage + (hasBreakdown ? accountingMicro(item.storageCostAccountingMicro) : 0n),
      service: sum.service + (hasBreakdown ? accountingMicro(item.serviceFeeAccountingMicro) : 0n),
      unitemized: sum.unitemized + (total > 0n && !hasBreakdown ? total : 0n),
      breakdownCount: sum.breakdownCount + (hasBreakdown ? 1 : 0),
    };
  }, { total: 0n, storage: 0n, service: 0n, unitemized: 0n, breakdownCount: 0 });
  const setMoney = (id, value) => { const el = $(`#${id}`); if (el) el.textContent = formatAccountingUsd(value); };
  const setText = (id, value) => { const el = $(`#${id}`); if (el) el.textContent = value; };
  setMoney('fee-total-paid', totals.total);
  if (totals.breakdownCount) {
    setMoney('fee-storage-cost', totals.storage);
    setMoney('fee-service-fee', totals.service);
  } else if (totals.unitemized > 0n) {
    setText('fee-storage-cost', 'Not recorded');
    setText('fee-service-fee', 'Not recorded');
  } else {
    setMoney('fee-storage-cost', 0n);
    setMoney('fee-service-fee', 0n);
  }
  setMoney('fee-unitemized', totals.unitemized);
}
function ttl(expiresAt) {
  const ms = expiresAt - Date.now(); if (ms <= 0) return { t: 'EXPIRED', c: 'text-error' };
  const h = ms / 3600000; if (h < 24) return { t: `${Math.max(1, Math.round(h))}H LEFT`, c: 'text-error' };
  const d = Math.round(h / 24); return { t: `${d}D LEFT`, c: d <= 2 ? 'text-secondary' : 'text-primary' };
}
function isRenderableImageArtifact(it) {
  const type = String(it?.contentType || '').toLowerCase();
  if (type === 'image/svg+xml') return true;
  if (type.startsWith('image/')) return true;
  return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(`${it?.key || ''} ${it?.url || ''}`);
}
function isRenderableVideoArtifact(it) {
  const type = String(it?.contentType || '').toLowerCase();
  if (type.startsWith('video/')) return true;
  return /\.(?:mp4|mov|m4v|webm)(?:$|[?#])/i.test(`${it?.key || ''} ${it?.url || ''}`);
}
function gcard(it) {
  const k = ttl(it.expiresAt);
  const isImg = isRenderableImageArtifact(it);
  const isVideo = isRenderableVideoArtifact(it);
  const url = safeHtml(toAppUrl(it.url)); const key = safeHtml(it.key); const tokenUri = safeHtml(toAppUrl(it.tokenUri || it.metadataUrl || '')); const type = safeHtml((it.contentType || 'artifact').toUpperCase()); const name = safeHtml(sourceDisplayName(it));
  return `<article class="vessel-artifact group flex min-h-[30rem] flex-col">
    <div class="relative aspect-square overflow-hidden bg-surface-lowest">
      <span class="vessel-technical absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-surface-lowest/80 px-3 py-2 text-[10px] ${k.c}">${k.t}</span>
      ${isImg ? `<img class="js-artifact-image h-full w-full object-cover transition duration-700 group-hover:scale-105" src="${url}" alt="Wallet-owned uploaded artifact"><div class="js-artifact-fallback hidden flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"><span class="material-symbols-outlined text-6xl text-outline" aria-hidden="true">deployed_code</span><p class="vessel-technical text-xs text-outline">Blob unavailable or expired</p></div>` : isVideo ? `<video class="h-full w-full object-cover" src="${url}" controls preload="metadata" aria-label="Wallet-owned uploaded video artifact"></video>` : `<div class="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"><span class="material-symbols-outlined text-6xl text-outline" aria-hidden="true">deployed_code</span><p class="vessel-technical text-xs text-outline">Preview unavailable</p></div>`}
    </div>
    <div class="flex flex-1 flex-col p-5"><p class="vessel-kicker text-primary-container">Wallet-owned artifact</p><h2 class="mt-3 truncate font-display text-xl font-semibold text-on-surface" title="${name}">${name}</h2><p class="vessel-technical mt-2 truncate text-xs text-outline">${shortMid(key, 10)}</p><div class="mt-5 border-t border-white/5 pt-4"><div class="flex items-center justify-between gap-4 text-xs"><span class="vessel-technical text-outline">${type}</span><span class="vessel-technical text-on-surface-variant">${(Number(it.size || 0) / 1048576).toFixed(2)} MB</span></div></div>
      <div class="mt-auto flex gap-2 pt-5"><button class="js-copy flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-url="${url}" aria-label="Copy artifact URL"><span class="material-symbols-outlined" aria-hidden="true">content_copy</span></button><button class="js-view flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-url="${url}" aria-label="Open artifact"><span class="material-symbols-outlined" aria-hidden="true">visibility</span></button><button class="js-meta flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-key="${key}" data-url="${url}" aria-label="Build artifact metadata"><span class="material-symbols-outlined" aria-hidden="true">data_object</span></button><button class="js-proof flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-key="${key}" data-url="${url}" data-tokenuri="${tokenUri}" aria-label="Share proof"><span class="material-symbols-outlined" aria-hidden="true">ios_share</span></button><button class="js-del flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-error/15 text-error/80 hover:bg-error/10" data-key="${key}" aria-label="Remove artifact from gallery"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></div>
    </div></article>`;
}
function folderCollectionCard(collection) {
  const name = safeHtml(collection.name);
  const count = collection.items.length;
  return `<button type="button" class="js-gallery-collection vessel-artifact flex min-h-[18rem] flex-col items-start justify-between p-6 text-left transition hover:border-primary-container/40 hover:bg-primary-container/[0.03]" data-collection-id="${name}" aria-label="Open collection ${name}">
    <span class="material-symbols-outlined text-5xl text-primary-container" aria-hidden="true">folder_open</span>
    <span><span class="vessel-kicker text-primary-container">Folder collection</span><span class="mt-3 block font-display text-2xl font-semibold text-on-surface">${name}</span><span class="mt-2 block text-sm text-on-surface-variant">${count} media file${count === 1 ? '' : 's'}</span></span>
  </button>`;
}
function metadataCard(it) {
  const k = ttl(it.expiresAt);
  const url = safeHtml(toAppUrl(it.url)); const key = safeHtml(it.key); const tokenUri = safeHtml(toAppUrl(it.tokenUri || it.metadataUrl || it.url)); const name = safeHtml(sourceDisplayName(it)); const mediaUrl = safeHtml(toAppUrl(it.sourceArtifactUrl || it.sourceMediaUrl || it.imageUrl || '')); const proofKey = safeHtml(it.sourceArtifactKey || it.key);
  return `<article class="vessel-glass flex flex-col gap-4 rounded-3xl p-5">
    <div class="flex items-start justify-between gap-4"><div class="min-w-0"><p class="vessel-kicker text-secondary">Metadata TokenURI</p><h2 class="mt-2 truncate font-display text-xl font-semibold text-on-surface" title="${name}">${name}</h2><p class="vessel-technical mt-2 truncate text-xs text-outline">${shortMid(key, 10)}</p></div><span class="vessel-technical shrink-0 rounded-full border border-white/10 px-3 py-2 text-[10px] ${k.c}">${k.t}</span></div>
    <label class="block"><span class="vessel-kicker text-outline">TokenURI / JSON URL</span><input class="vessel-input mt-2 text-xs" readonly value="${tokenUri}"></label>
    <div class="flex gap-2"><button class="js-copy flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-url="${tokenUri}" aria-label="Copy TokenURI"><span class="material-symbols-outlined" aria-hidden="true">content_copy</span></button><button class="js-view flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-url="${url}" aria-label="Open metadata JSON"><span class="material-symbols-outlined" aria-hidden="true">visibility</span></button><button class="js-proof flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-key="${proofKey}" data-url="${mediaUrl}" data-tokenuri="${tokenUri}" aria-label="Share TokenURI proof"><span class="material-symbols-outlined" aria-hidden="true">ios_share</span></button><button class="js-del flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-error/15 text-error/80 hover:bg-error/10" data-key="${key}" aria-label="Remove metadata from gallery"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></div>
  </article>`;
}
function newSlot() {
  return `<a class="flex min-h-[30rem] flex-col items-center justify-center rounded-vessel border border-dashed border-primary-container/25 bg-primary-container/[0.025] p-8 text-center transition hover:border-primary-container/60 hover:bg-primary-container/[0.05]" href="/upload.html"><span class="flex h-20 w-20 items-center justify-center rounded-full border border-primary-container/20 text-primary"><span class="material-symbols-outlined text-4xl" aria-hidden="true">add</span></span><h2 class="mt-6 font-display text-2xl font-semibold">Upload New</h2><p class="vessel-technical mt-3 text-xs text-outline">Initialize artifact</p></a>`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function collectionManifestCsv(manifest) {
  const lines = [
    ['collection', 'item_name', 'source_path', 'image_url', 'metadata_path', 'metadata_url'],
    ...(manifest?.rows || []).map((row) => [
      manifest.name,
      row.itemName,
      row.sourcePath,
      toAppUrl(row.imageUrl),
      row.metadataPath,
      toAppUrl(row.metadataUrl),
    ]),
  ].map((row) => row.map(csvCell).join(','));
  return new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' });
}

function galleryManifestCsv(items) {
  const lines = [
    ['kind', 'collection', 'display_name', 'source_path', 'media_url', 'token_uri', 'metadata_url', 'content_type', 'size_bytes', 'expires_at'],
    ...(items || []).map((item) => {
      const metadata = isMetadataArtifact(item);
      const mediaUrl = metadata ? toAppUrl(item.sourceArtifactUrl || item.sourceMediaUrl || item.imageUrl || '') : toAppUrl(item.url);
      const metadataUrl = metadata ? toAppUrl(item.tokenUri || item.metadataUrl || item.url) : toAppUrl(item.metadataUrl || '');
      return [
        metadata ? 'metadata' : 'media',
        folderCollectionId(item),
        sourceDisplayName(item),
        item.sourcePath || '',
        mediaUrl,
        toAppUrl(item.tokenUri || metadataUrl),
        metadataUrl,
        item.contentType || '',
        item.size || 0,
        item.expiresAt ? new Date(item.expiresAt).toISOString() : '',
      ];
    }),
  ].map((row) => row.map(csvCell).join(','));
  return new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' });
}

async function initCollection() {
  const title = $('#collection-title');
  const status = $('#collection-status');
  const count = $('#collection-count');
  const tokenList = $('#collection-tokenuri-list');
  const copyTokenUris = $('#collection-copy-tokenuris');
  const exportManifest = $('#collection-export-manifest');
  const table = $('#collection-table');
  if (!title || !table) return;

  const state = walletController()?.getState?.();
  if (state?.status !== 'ready' || !state.session?.storageAddress) {
    if (status) status.textContent = 'Connect the wallet that hosted the collection metadata.';
    table.innerHTML = '<tr><td colspan="3">No connected wallet.</td></tr>';
    return;
  }
  const requested = new URLSearchParams(location.search).get('id') || '';
  const manifests = loadCollectionManifests(state.session.storageAddress);
  const manifest = manifests.find((entry) => entry.id === requested) || manifests[0];
  if (!manifest) {
    if (status) status.textContent = 'No hosted collection manifest is saved for this wallet yet.';
    table.innerHTML = '<tr><td colspan="3">Host batch metadata first, then return here.</td></tr>';
    return;
  }

  title.textContent = manifest.name;
  if (status) status.textContent = `Saved manifest for ${shortMid(state.session.storageAddress, 8)}. Export it before the current testnet wipe.`;
  if (count) count.textContent = `${manifest.rows.length} ${manifest.rows.length === 1 ? 'item' : 'items'}`;
  const absoluteTokenText = manifest.tokenUris.length ? `${manifest.tokenUris.map(toAppUrl).join('\n')}\n` : '';
  if (tokenList) tokenList.value = absoluteTokenText;
  if (copyTokenUris) {
    copyTokenUris.disabled = !absoluteTokenText;
    copyTokenUris.onclick = () => {
      copy(absoluteTokenText);
      toast('Collection TokenURIs copied', 'ok');
    };
  }
  if (exportManifest) {
    exportManifest.disabled = !manifest.rows.length;
    exportManifest.onclick = () => downloadBlob(collectionManifestCsv(manifest), `${manifest.id || 'collection'}-manifest.csv`, document);
  }

  const rows = manifest.rows.map((row) => {
    const tr = document.createElement('tr');
    const item = document.createElement('td');
    item.textContent = row.itemName || row.sourcePath || 'Untitled item';
    const image = document.createElement('td');
    const imageLink = document.createElement('a');
    const imageUrl = toAppUrl(row.imageUrl);
    imageLink.href = imageUrl;
    imageLink.target = '_blank';
    imageLink.rel = 'noreferrer';
    imageLink.textContent = imageUrl;
    image.appendChild(imageLink);
    const metadata = document.createElement('td');
    const metadataLink = document.createElement('a');
    const metadataUrl = toAppUrl(row.metadataUrl);
    metadataLink.href = metadataUrl;
    metadataLink.target = '_blank';
    metadataLink.rel = 'noreferrer';
    metadataLink.textContent = metadataUrl || 'Not hosted';
    metadata.appendChild(metadataLink);
    tr.append(item, image, metadata);
    return tr;
  });
  table.replaceChildren(...rows);
}

async function resolveProofMediaUrlFromTokenUri(tokenUriUrl) {
  const href = toAppUrl(tokenUriUrl);
  if (!href) return '';
  try {
    const response = await fetch(href, { headers: { accept: 'application/json' } });
    if (!response.ok) return '';
    const json = await response.json();
    const files = Array.isArray(json?.properties?.files) ? json.properties.files : [];
    const fileUri = files.map((file) => file?.uri || file?.url || file?.src).find(Boolean);
    const candidate = json?.image || json?.animation_url || fileUri || '';
    if (!candidate) return '';
    try {
      return new URL(String(candidate), href).href;
    } catch {
      return String(candidate);
    }
  } catch {
    return '';
  }
}

async function initProof() {
  const params = new URLSearchParams(location.search);
  const title = $('#proof-title');
  const status = $('#proof-status');
  const media = $('#proof-media-url');
  const tokenUri = $('#proof-tokenuri-url');
  const collectionList = $('#proof-collection-list');
  const copyLink = $('#proof-copy-link');
  let mediaUrl = toAppUrl(params.get('url') || '');
  let tokenUriUrl = toAppUrl(params.get('tokenuri') || '');
  const key = params.get('key') || '';
  const collectionId = params.get('collection') || '';
  let canonicalizedProofUrl = false;
  if (mediaUrl && mediaUrl !== (params.get('url') || '')) {
    params.set('url', mediaUrl);
    canonicalizedProofUrl = true;
  }
  if (tokenUriUrl && tokenUriUrl !== (params.get('tokenuri') || '')) {
    params.set('tokenuri', tokenUriUrl);
    canonicalizedProofUrl = true;
  }
  if (!mediaUrl && tokenUriUrl) {
    const recoveredMediaUrl = await resolveProofMediaUrlFromTokenUri(tokenUriUrl);
    if (recoveredMediaUrl) {
      mediaUrl = recoveredMediaUrl;
      params.set('url', mediaUrl);
      canonicalizedProofUrl = true;
    }
  }
  if (canonicalizedProofUrl) history.replaceState(null, '', `${location.pathname}?${params.toString()}`);

  if (media) media.value = mediaUrl;
  if (tokenUri) tokenUri.value = tokenUriUrl;
  if (title) title.textContent = collectionId ? 'Collection Proof' : 'Artifact Proof';
  if (status) {
    status.textContent = key || mediaUrl || tokenUriUrl || collectionId
      ? 'These links can be checked directly while the current ShelbyNet testnet data remains available.'
      : 'No proof parameters were provided. Open a proof link from the Vault or Collection page.';
  }
  if (copyLink) copyLink.onclick = () => copy(location.href);
  const tokenUriHelper = $('#proof-tokenuri-helper');
  const createTokenUri = $('#proof-create-tokenuri');
  const canCreateTokenUri = Boolean(!tokenUriUrl && key && mediaUrl);
  if (tokenUriHelper) {
    tokenUriHelper.textContent = tokenUriUrl
      ? 'This TokenURI points to the hosted NFT metadata JSON for this artifact.'
      : 'No TokenURI has been attached to this artifact yet. Create and host metadata first.';
  }
  if (createTokenUri) {
    createTokenUri.classList.toggle('hidden', !canCreateTokenUri);
    createTokenUri.onclick = (event) => {
      event.preventDefault();
      ledger.selectArtifact({ key, url: mediaUrl });
      location.href = '/metadata.html';
    };
  }

  const state = walletController()?.getState?.();
  const manifest = collectionId && state?.session?.storageAddress
    ? loadCollectionManifests(state.session.storageAddress).find((entry) => entry.id === collectionId)
    : null;
  if (collectionList && manifest?.rows?.length) {
    collectionList.replaceChildren(...manifest.rows.slice(0, 100).map((row) => {
      const item = document.createElement('div');
      item.className = 'rounded-2xl border border-white/10 bg-surface-lowest/40 p-4';
      const name = document.createElement('strong');
      name.className = 'block text-on-surface';
      name.textContent = row.itemName || row.sourcePath || 'Collection item';
      const uri = document.createElement('p');
      uri.className = 'vessel-technical mt-2 break-all text-xs text-primary';
      uri.textContent = toAppUrl(row.metadataUrl);
      item.append(name, uri);
      return item;
    }));
  }
}

async function initLatency() {
  const sMs = $('#shelby-ms'), iMs = $('#ipfs-ms'), sBar = $('#shelby-bar'), iBar = $('#ipfs-bar');
  const btn = $('#rerun-btn');
  async function run() {
    // Prefer the visitor's own uploaded asset (their DAA account) via its real Shelby URL.
    const selected = ledger.selected();
    const url = selected.url;
    let key = selected.key;
    if (!url && !key) { const m = loadMine(); if (m[0]) { key = m[0].key; } }
    if (!url && !key) { toast('Upload a file first to measure latency', 'warn'); return; }
    if (btn) btn.disabled = true;
    setStat('shelby', '…'); setStat('ipfs', null, true);
    try {
      const q = url ? `url=${encodeURIComponent(url)}` : `key=${encodeURIComponent(key)}`;
      const r = await api(`/api/latency?${q}&samples=20`);
      const s = r.shelby;
      if (sMs) animate(sMs, 0, s.medianMs, 900);
      setStat('shelby', s);
      if (r.ipfs) { if (iMs) animate(iMs, 0, r.ipfs.medianMs, 1100); setStat('ipfs', { medianMs: r.ipfs.medianMs }); markIpfsAvailable(true); }
      else { setStat('ipfs', null, true); markIpfsAvailable(false); }
      // bars: scale relative to the slower of the two (or a 2500ms reference if ipfs null)
      const ref = r.ipfs ? Math.max(s.medianMs, r.ipfs.medianMs) : 2500;
      if (sBar) sBar.style.width = Math.min(100, (s.medianMs / ref) * 100) + '%';
      if (iBar) iBar.style.width = r.ipfs ? Math.min(100, (r.ipfs.medianMs / ref) * 100) + '%' : '0%';
    } catch (e) { toast(e.message, 'error'); }
    if (btn) btn.disabled = false;
  }
  function setStat(which, data, unavailable) {
    const put = (id, v) => { const el = $('#' + which + '-' + id); if (el) el.textContent = v; };
    if (unavailable) { put('median', 'n/a'); put('min', 'n/a'); put('p90', 'n/a'); return; }
    if (typeof data === 'string') { put('median', data); return; }
    if (data) { put('median', data.medianMs); put('min', data.minMs ?? '—'); put('p90', data.p90Ms ?? '—'); }
  }
  function markIpfsAvailable(ok) {
    const un = $('#ipfs-unavailable'); if (un) un.classList.toggle('hidden', ok);
    if (iMs) iMs.parentElement && (iMs.parentElement.style.opacity = ok ? '1' : '0.35');
  }
  if (btn) btn.onclick = run;
  run();
}
function animate(el, from, to, dur) {
  el.textContent = to; // definitive value first (robust if rAF is throttled / tab hidden)
  const t0 = performance.now();
  const step = (t) => { const p = Math.min((t - t0) / dur, 1); el.textContent = Math.floor(from + (to - from) * p); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

async function initMetadata() {
  let cfg = {};
  try { cfg = await api('/api/config'); } catch (error) { toast(error.message, 'warn'); }
  const waitForReceiptFinality = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadMetadataCollections() {
    const controller = walletController();
    const state = controller?.getState?.();
    if (state?.status !== 'ready' || !state.session?.storageAddress) return [];
    if (cfg.shelbyWritesEnabled === false) {
      return groupVaultCollections(loadMine(), {
        storageAddress: state.session.storageAddress,
        now: Date.now(),
        verification: 'vault-cache',
      });
    }
    const remote = await controller.listArtifacts();
    const reconciled = controller.reconcileArtifacts(loadMine(), remote);
    replaceMine(reconciled);
    return groupVaultCollections(reconciled, {
      storageAddress: state.session.storageAddress,
      now: Date.now(),
    });
  }

  function findMetadataRecoveryRecord(session, fileHash, blobName) {
    if (!session || !fileHash) return null;
    return recovery.loadForWallet(session).find((record) => (
      record.context?.fileHash === fileHash
      && (!blobName || record.context?.blobName === blobName)
      && !['quoted', 'active'].includes(record.stage)
    )) || null;
  }

  async function resumePendingMetadataReceipt(file, record, {
    session,
    fileHash,
    blobName,
    index,
    total,
    path,
    onUpdate,
  } = {}) {
    let recoveryRecord = record;
    let lastError = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      onUpdate?.({
        phase: 'receiptPending',
        index,
        total,
        path,
        attempt: attempt + 1,
      });
      await waitForReceiptFinality(Math.min(1200 + attempt * 700, 4000));
      try {
        return await walletOwnedUpload.resume(file, recoveryRecord, {
          onStep: (step) => onUpdate?.({ phase: step, index, total, path }),
        });
      } catch (error) {
        if (error?.code !== 'receipt_pending') throw error;
        lastError = error;
        recoveryRecord = findMetadataRecoveryRecord(session, fileHash, blobName) || recoveryRecord;
      }
    }
    throw Object.assign(
      new Error('Settlement receipt is still finalizing. No second settlement will be requested. Wait a moment, then host this TokenURI again to resume.'),
      { code: 'receipt_pending', retriable: true, cause: lastError },
    );
  }

  async function hostMetadataFiles(files, { days, sourcePath, sourcePaths, onUpdate } = {}) {
    const results = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = sourcePaths?.[index] || sourcePath || file.name;
      onUpdate?.({ phase: 'quoting', index, total: files.length, path });
      const fileHash = await sha256FileHex(file);
      const blobName = contentAddressedBlobName(file, fileHash);
      const session = walletController()?.getState?.().session;
      const existing = loadMine().find((item) => (
        item.account === session?.storageAddress
        && item.key === blobName
        && Number(item.expiresAt || 0) > Date.now()
      ));
      if (existing) {
        results.push(Object.freeze({ ...existing, sourcePath: path, reused: true }));
        onUpdate?.({ phase: 'succeeded', index, total: files.length, path, result: existing });
        continue;
      }
      const recoveryRecord = findMetadataRecoveryRecord(session, fileHash, blobName);
      if (recoveryRecord) {
        onUpdate?.({ phase: 'resuming', index, total: files.length, path });
        const resumed = await resumePendingMetadataReceipt(file, recoveryRecord, {
          session,
          fileHash,
          blobName,
          index,
          total: files.length,
          path,
          onUpdate,
        });
        const result = Object.freeze({ ...resumed, sourcePath: path });
        ledger.commitUpload(result);
        results.push(result);
        onUpdate?.({ phase: 'succeeded', index, total: files.length, path, result });
        continue;
      }
      let quoted = await walletOwnedUpload.quote(file, { days });
      const total = formatAccountingMicro(quoted.quote.totalAccountingMicro);
      const approved = await confirmAction({
        opener: $('#single-host-shelby') || $('#batch-host-shelby'),
        kicker: files.length > 1 ? `METADATA ${index + 1} OF ${files.length}` : 'TOKENURI QUOTE',
        title: `Host ${file.name} for ${quoted.quote.days} days?`,
        message: `${total} total, including Shelby network costs, sponsored gas, and the Vessel service fee. Your connected wallet will approve the Vessel settlement receipt.`,
        cancelLabel: 'NOT NOW',
        confirmLabel: 'APPROVE & HOST',
      });
      if (!approved) throw Object.assign(new Error('Metadata hosting cancelled'), { code: 'user_rejected' });
      onUpdate?.({ phase: 'validating', index, total: files.length, path });
      let validated = await walletOwnedUpload.validate(quoted);
      if (validated.requiresConfirmation) {
        const changedTotal = formatAccountingMicro(validated.quote.totalAccountingMicro);
        const reconfirmed = await confirmAction({
          opener: $('#single-host-shelby') || $('#batch-host-shelby'),
          kicker: 'UPDATED TOKENURI QUOTE',
          title: 'The live price changed',
          message: `The refreshed total is ${changedTotal}. Review and approve the updated quote to continue.`,
          cancelLabel: 'CANCEL',
          confirmLabel: 'APPROVE UPDATED PRICE',
        });
        if (!reconfirmed) throw Object.assign(new Error('Updated metadata quote was not approved'), { code: 'user_rejected' });
        quoted = Object.freeze({ ...validated, quote: validated.quote });
        validated = Object.freeze({ ...quoted, requiresConfirmation: false });
      }
      onUpdate?.({ phase: 'uploading', index, total: files.length, path });
      let hosted;
      try {
        hosted = await walletOwnedUpload.upload(validated, {
          onStep: (step) => onUpdate?.({ phase: step, index, total: files.length, path }),
        });
      } catch (error) {
        if (error?.code !== 'receipt_pending') throw error;
        const pendingRecord = findMetadataRecoveryRecord(session, fileHash, blobName);
        if (!pendingRecord) throw error;
        hosted = await resumePendingMetadataReceipt(file, pendingRecord, {
          session,
          fileHash,
          blobName,
          index,
          total: files.length,
          path,
          onUpdate,
        });
      }
      const result = Object.freeze({ ...hosted, sourcePath: path });
      ledger.commitUpload(result);
      results.push(result);
      onUpdate?.({ phase: 'succeeded', index, total: files.length, path, result });
    }
    return Object.freeze(results);
  }
  const metadataPage = initMetadataPage({
    document,
    selectedArtifact: ledger.selected(),
    walletState: walletController()?.getState?.() || {},
    hostingAvailable: cfg.shelbyWritesEnabled === true,
    loadCollections: loadMetadataCollections,
    hostFiles: hostMetadataFiles,
    saveArtifactTokenUri: ({ key, tokenUri, result }) => {
      attachTokenUriToArtifact(key, tokenUri, {
        metadataKey: result?.key,
        metadataUrl: result?.url || tokenUri,
        result,
      });
    },
    saveCollectionManifest: (manifest, { collection } = {}) => {
      const session = walletController()?.getState?.().session;
      if (!session?.storageAddress || !manifest?.rows?.length) return;
      ledger.rememberCollectionManifest({
        id: collection?.id || manifest.collectionName,
        name: collection?.name || manifest.collectionName,
        storageAddress: session.storageAddress,
        rows: manifest.rows,
        tokenUris: manifest.tokenUris,
      });
    },
    notify: toast,
    copyText: copy,
    origin: window.location.origin,
  });
  walletController()?.subscribe?.((next) => metadataPage.refreshWallet(next));
}

/* ------------------------------- boot --------------------------------- */
let walletUi = null;
const deprecatedWalletKeys = ['vessel_addr', 'vessel_sa', 'vessel_verified'];

document.addEventListener('DOMContentLoaded', async () => {
  if (window.VesselWallets) {
    deprecatedWalletKeys.forEach((key) => localStorage.removeItem(key));
    walletUi = mountWalletUi({ controller: window.VesselWallets, document });
    window.addEventListener('vessel:wallet-open', (event) => {
      void walletUi.open(event.detail?.opener);
    });
    await window.VesselWallets.restore();
    activeWalletIdentity = walletIdentityKey(window.VesselWallets.getState());
    window.VesselWallets.subscribe((next) => {
      invalidateWalletWork(next);
      renderWallet();
    });
  }
  renderWallet();
  const p = page();
  ({ index: initLanding, identity: initIdentity, upload: initUpload, gallery: initGallery, collection: initCollection, proof: initProof, latency: initLatency, metadata: initMetadata }[p] || (() => {}))();
});

window.Vessel = { copy, api, walletController };
