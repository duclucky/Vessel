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
import { createWalletOwnedUploadService } from './wallet-owned-upload.js';

const API = location.origin;
const ledger = createLedger(localStorage);
const recovery = createRecoveryLedger(localStorage);
const { loadMine, replaceMine, forgetMine } = ledger;

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
        ? 'Switch your wallet to Aptos Testnet'
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
    if (!outcome?.ok) throw outcome?.error || new Error('Upload did not complete');
    const result = Object.freeze({ ...outcome.result, sourcePath: item.relativePath });
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
        const quote = Object.freeze({
          ...record.context,
          quoteId: record.quoteId,
          quoteToken: record.quoteToken,
          tierId: record.paymentTier,
          totalAccountingMicro: record.quotedAccountingMicro,
          solanaAmountMicro: record.quotedAccountingMicro,
          contractQuote: record.contractQuote,
          contractSignature: record.contractSignature,
          quotePublicKey: record.quotePublicKey,
        });
        const recoveredContext = Object.freeze({
          file,
          intent: Object.freeze({ ...record.context }),
          quote,
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
          recovery.complete(record.id);
          toast('Recovered upload is active on Shelby', 'ok');
        } else {
          recovery.advance(record.id, 'recovery_required', { errorCode: 'acknowledgement_timeout' });
          toast('Bytes were resent; Shelby acknowledgement is still pending', 'warn');
        }
      } catch (error) {
        recovery.advance(record.id, 'recovery_required', { errorCode: error.code || 'resume_failed' });
        toast(String(error?.message || error).slice(0, 160), 'error');
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
    detail.textContent = `Fund ${shortMid(session.sourceAddress)} on Aptos Testnet, then retry.`;

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
    toast('Fund your Aptos Testnet wallet, then retry', 'warn');
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

async function initGallery() {
  const grid = $('#gallery-grid');
  if (!grid) return;
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
  if (!items.length) {
    grid.innerHTML = newSlot() + `<div class="vessel-glass flex min-h-80 flex-col items-center justify-center rounded-vessel p-8 text-center sm:col-span-1 lg:col-span-2"><span class="material-symbols-outlined text-5xl text-outline" aria-hidden="true">deployed_code</span><h2 class="mt-5 font-display text-2xl font-semibold">The vault is waiting</h2><p class="mt-3 max-w-md text-sm leading-6 text-on-surface-variant">Complete one wallet-owned upload to populate your personal artifact collection.</p></div>`;
    return;
  }
  grid.innerHTML = newSlot() + items.map(gcard).join('');
  $$('.js-artifact-image', grid).forEach((img) => img.addEventListener('error', () => {
    img.classList.add('hidden');
    img.parentElement?.querySelector('.js-artifact-fallback')?.classList.remove('hidden');
  }, { once: true }));
  $$('.js-copy', grid).forEach((b) => (b.onclick = () => copy(b.dataset.url)));
  $$('.js-view', grid).forEach((b) => (b.onclick = () => window.open(b.dataset.url, '_blank')));
  $$('.js-meta', grid).forEach((b) => (b.onclick = () => {
    ledger.selectArtifact({ key: b.dataset.key, url: b.dataset.url });
    location.href = '/metadata.html';
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
}
function ttl(expiresAt) {
  const ms = expiresAt - Date.now(); if (ms <= 0) return { t: 'EXPIRED', c: 'text-error' };
  const h = ms / 3600000; if (h < 24) return { t: `${Math.max(1, Math.round(h))}H LEFT`, c: 'text-error' };
  const d = Math.round(h / 24); return { t: `${d}D LEFT`, c: d <= 2 ? 'text-secondary' : 'text-primary' };
}
function gcard(it) {
  const k = ttl(it.expiresAt);
  const isImg = (it.contentType || '').startsWith('image/');
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const url = safe(it.url); const key = safe(it.key); const type = safe((it.contentType || 'artifact').toUpperCase());
  return `<article class="vessel-artifact group flex min-h-[30rem] flex-col">
    <div class="relative aspect-square overflow-hidden bg-surface-lowest">
      <span class="vessel-technical absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-surface-lowest/80 px-3 py-2 text-[10px] ${k.c}">${k.t}</span>
      ${isImg ? `<img class="js-artifact-image h-full w-full object-cover transition duration-700 group-hover:scale-105" src="${url}" alt="Wallet-owned uploaded artifact"><div class="js-artifact-fallback hidden flex h-full w-full items-center justify-center"><span class="material-symbols-outlined text-6xl text-outline" aria-hidden="true">deployed_code</span></div>` : `<div class="flex h-full w-full items-center justify-center"><span class="material-symbols-outlined text-6xl text-outline" aria-hidden="true">deployed_code</span></div>`}
    </div>
    <div class="flex flex-1 flex-col p-5"><p class="vessel-kicker text-primary-container">Wallet-owned artifact</p><h2 class="vessel-technical mt-3 truncate text-base text-on-surface">${shortMid(key, 10)}</h2><div class="mt-5 border-t border-white/5 pt-4"><div class="flex items-center justify-between gap-4 text-xs"><span class="vessel-technical text-outline">${type}</span><span class="vessel-technical text-on-surface-variant">${(Number(it.size || 0) / 1048576).toFixed(2)} MB</span></div></div>
      <div class="mt-auto flex gap-2 pt-5"><button class="js-copy flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-url="${url}" aria-label="Copy artifact URL"><span class="material-symbols-outlined" aria-hidden="true">content_copy</span></button><button class="js-view flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-url="${url}" aria-label="Open artifact"><span class="material-symbols-outlined" aria-hidden="true">visibility</span></button><button class="js-meta flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-white/10 text-on-surface-variant hover:border-primary-container/30 hover:text-primary" data-key="${key}" data-url="${url}" aria-label="Build artifact metadata"><span class="material-symbols-outlined" aria-hidden="true">data_object</span></button><button class="js-del flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-full border border-error/15 text-error/80 hover:bg-error/10" data-key="${key}" aria-label="Remove artifact from gallery"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></div>
    </div></article>`;
}
function newSlot() {
  return `<a class="flex min-h-[30rem] flex-col items-center justify-center rounded-vessel border border-dashed border-primary-container/25 bg-primary-container/[0.025] p-8 text-center transition hover:border-primary-container/60 hover:bg-primary-container/[0.05]" href="/upload.html"><span class="flex h-20 w-20 items-center justify-center rounded-full border border-primary-container/20 text-primary"><span class="material-symbols-outlined text-4xl" aria-hidden="true">add</span></span><h2 class="mt-6 font-display text-2xl font-semibold">Upload New</h2><p class="vessel-technical mt-3 text-xs text-outline">Initialize artifact</p></a>`;
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
      const recoveryRecord = session && recovery.loadForWallet(session).find((record) => (
        record.context?.fileHash === fileHash && !['quoted', 'active'].includes(record.stage)
      ));
      if (recoveryRecord) {
        onUpdate?.({ phase: 'resuming', index, total: files.length, path });
        const resumed = await walletOwnedUpload.resume(file, recoveryRecord, {
          onStep: (step) => onUpdate?.({ phase: step, index, total: files.length, path }),
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
      const hosted = await walletOwnedUpload.upload(validated, {
        onStep: (step) => onUpdate?.({ phase: step, index, total: files.length, path }),
      });
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
    hostFiles: hostMetadataFiles,
    notify: toast,
    copyText: copy,
    origin: window.location.origin,
    scope: window,
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
  ({ index: initLanding, identity: initIdentity, upload: initUpload, gallery: initGallery, latency: initLatency, metadata: initMetadata }[p] || (() => {}))();
});

window.Vessel = { copy, api, walletController };
