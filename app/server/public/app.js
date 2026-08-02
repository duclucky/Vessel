// Vessel — shared frontend wiring. Vanilla ES module. Talks only to the backend REST API
// (same origin). The only browser-side credential is the user's wallet signature.

const API = location.origin;
const LS = { addr: 'vessel_addr', sa: 'vessel_sa', verified: 'vessel_verified', sel: 'vessel_selected_key', mine: 'vessel_mine' };

/* --- "my uploads" ledger (localStorage): the visitor owns these blobs on their DAA account --- */
function loadMine() { try { return JSON.parse(localStorage.getItem(LS.mine) || '[]'); } catch { return []; } }
function rememberMine(it) {
  const list = loadMine().filter((x) => x.key !== it.key);
  list.unshift(it);
  localStorage.setItem(LS.mine, JSON.stringify(list.slice(0, 60)));
}
function forgetMine(key) { localStorage.setItem(LS.mine, JSON.stringify(loadMine().filter((x) => x.key !== key))); }

/* ------------------------------- state ------------------------------- */
const state = {
  get address() { return localStorage.getItem(LS.addr) || ''; },
  get storageAccount() { return localStorage.getItem(LS.sa) || ''; },
  get verified() { return localStorage.getItem(LS.verified) === '1'; },
  set(o) {
    if (o.address !== undefined) localStorage.setItem(LS.addr, o.address);
    if (o.storageAccount !== undefined) localStorage.setItem(LS.sa, o.storageAccount || '');
    if (o.verified !== undefined) localStorage.setItem(LS.verified, o.verified ? '1' : '0');
  },
  clear() { [LS.addr, LS.sa, LS.verified].forEach((k) => localStorage.removeItem(k)); },
};

/* ------------------------------- helpers ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const shortMid = (a, n = 6) => (a && a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a || '');

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method };
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
    host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(host);
  }
  const colors = { info: '#22d3ee', error: '#ffb4ab', ok: '#22d3ee', warn: '#ffb95f' };
  const el = document.createElement('div');
  el.style.cssText = `font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.04em;background:rgba(17,24,38,.95);color:${colors[kind] || '#e0e2ea'};border:1px solid ${colors[kind] || '#1E293B'};border-radius:4px;padding:10px 14px;max-width:360px;backdrop-filter:blur(12px);box-shadow:0 0 12px rgba(34,211,238,.15)`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Copied', 'ok')).catch(() => {}); }

/* ------------------------------- wallet ------------------------------- */
async function connectWallet() {
  if (!window.ethereum) { toast('No Ethereum wallet found. Install MetaMask.', 'error'); return null; }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts[0];
    state.set({ address, verified: false, storageAccount: '' });
    // pre-derive the storage account for display (no signature needed)
    try { const r = await api('/api/identity/challenge', { method: 'POST', body: { address } }); void r; } catch {}
    renderWallet();
    toast('Wallet connected', 'ok');
    return address;
  } catch (e) { toast('Connection rejected', 'error'); return null; }
}

async function proveOwnership() {
  const address = state.address;
  if (!address) { await connectWallet(); if (!state.address) return null; }
  const { message } = await api('/api/identity/challenge', { method: 'POST', body: { address: state.address } });
  let signature;
  try {
    signature = await window.ethereum.request({ method: 'personal_sign', params: [message, state.address] });
  } catch { toast('Signature rejected', 'error'); return null; }
  const res = await api('/api/identity/verify', { method: 'POST', body: { address: state.address, signature, message } });
  state.set({ address: res.address, storageAccount: res.storageAccount || '', verified: true });
  renderWallet();
  toast('Ownership proven', 'ok');
  return res;
}

function renderWallet() {
  const label = state.address ? shortAddr(state.address) : 'Connect Wallet';
  $$('.js-connect').forEach((btn) => {
    const span = btn.querySelector('.js-connect-label');
    if (span) span.textContent = label; else if (!btn.querySelector('.material-symbols-outlined') || btn.dataset.labelOnly) btn.textContent = label;
    else {
      // keep icon, replace trailing text node
      const t = [...btn.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (t) t.textContent = ' ' + label; else btn.insertadjacentText?.('beforeend', label);
    }
    btn.onclick = state.address ? null : (e) => { e.preventDefault(); connectWallet(); };
  });
}

/* ------------------------------- pages -------------------------------- */
function page() {
  const p = location.pathname.split('/').pop() || 'index.html';
  return p.replace('.html', '') || 'index';
}

function initLanding() {
  const cta = $('main .js-connect') || $('#cta-connect');
  if (cta) cta.onclick = async (e) => { e.preventDefault(); const a = await connectWallet(); if (a) location.href = '/identity.html'; };
}

async function initIdentity() {
  const originEl = $('#origin-wallet'); const derivedEl = $('#derived-account');
  const SOL = () => window.VesselSolana;
  // The storage identity is the VISITOR's own Phantom-derived DAA account — shown once they connect.
  if (SOL()?.state?.solana) {
    if (originEl) originEl.textContent = shortMid(SOL().state.solana);
    if (derivedEl) derivedEl.textContent = shortMid(SOL().state.storageAccount);
    window.__storageSolana = SOL().state.solana; window.__storageAcct = SOL().state.storageAccount;
  } else {
    if (originEl) originEl.textContent = '—';
    if (derivedEl) derivedEl.textContent = '—';
  }
  const signBtn = $('#sign-btn');
  const lbl = $('#sign-btn-label');
  if (SOL()?.available() && lbl) lbl.textContent = 'CONNECT PHANTOM — OWN YOUR STORAGE';
  if (signBtn) signBtn.onclick = async (e) => {
    e.preventDefault();
    signBtn.disabled = true;
    try {
      if (SOL()?.available()) {
        // Sovereign path: the visitor's own Solana wallet IS the storage identity.
        const r = await SOL().connect();
        if (originEl) originEl.textContent = shortMid(r.solana);
        if (derivedEl) derivedEl.textContent = shortMid(r.storageAccount);
        const status = $('#auth-status'); if (status) status.textContent = 'This is YOUR storage account ✓';
        window.__storageSolana = r.solana; window.__storageAcct = r.storageAccount;
        toast('Connected — your wallet owns this storage identity', 'ok');
      } else {
        if (!state.address) { await connectWallet(); if (!state.address) { signBtn.disabled = false; return; } }
        const res = await proveOwnership();
        if (res) {
          if (derivedEl) derivedEl.textContent = shortMid(res.storageAccount || '');
          if (originEl) originEl.textContent = shortMid(res.address);
          const status = $('#auth-status'); if (status) status.textContent = 'Ownership verified ✓';
        }
      }
    } catch (err) { toast(String(err?.message || err).slice(0, 140), 'error'); }
    signBtn.disabled = false;
  };
  // copy buttons (copy the real storage identity)
  $$('.js-copy-origin').forEach((b) => (b.onclick = () => copy(window.__storageSolana || state.address)));
  $$('.js-copy-derived').forEach((b) => (b.onclick = () => copy(window.__storageAcct || state.storageAccount)));
}

function initUpload() {
  const dz = $('#drop-zone'); const input = $('#file-input');
  const vInit = $('#upload-initial-view'); const vProg = $('#upload-progress-view'); const vDone = $('#upload-success-view');
  const bar = $('#progress-bar'); const pct = $('#progress-percentage'); const fname = $('#upload-filename');
  const show = (el) => { [vInit, vProg, vDone].forEach((v) => v && v.classList.add('hidden')); el && el.classList.remove('hidden'); };

  const SOL = () => window.VesselSolana;

  const stepPct = { signing: 35, paying: 55, sponsoring: 80, uploading: 92 };
  const stepMsg = { signing: 'sign upload…', paying: 'pay USDC…', sponsoring: 'sponsoring…', uploading: 'storing…' };
  function setStep(s) { if (bar) bar.style.width = (stepPct[s] || 20) + '%'; if (pct) pct.textContent = stepMsg[s] || s; }

  async function doUpload(file) {
    if (!file) return;
    const cfg = await api('/api/config').catch(() => ({}));
    const maxB = cfg.maxUploadBytes || 25 * 1024 * 1024;
    if (file.size > maxB) { toast(`File exceeds ${(maxB / 1048576) | 0}MB demo limit`, 'error'); return; }
    if (fname) fname.textContent = `${file.name} (${(file.size / 1048576).toFixed(2)}MB)`;

    // Cách B (sponsored + USDC): Phantom pays a stablecoin fee & signs; the server sponsors the
    // Aptos-side storage. The blob is owned by the visitor's own DAA account. No APT/ShelbyUSD needed.
    if (SOL()?.available() && cfg.sponsored) {
      show(vProg); setStep('signing');
      try {
        if (!SOL().state.solana) { await SOL().connect(); toast('Phantom connected — this upload will be owned by YOUR wallet', 'ok'); }

        // 1) quote (USDC)
        const quote = await api('/api/pay/quote', { method: 'POST', body: { sizeBytes: file.size } });

        // 2) enough USDC? otherwise show the faucet gate
        const bal = await SOL().usdcBalance();
        if (bal < quote.amountUsdc) { show(vInit); showPayGate(quote, bal, SOL().faucets); return; }

        // 3) pay USDC on Solana (Phantom), 4) server verifies -> uploadToken
        setStep('paying');
        toast(`Paying ${quote.amountUsdc} USDC for storage…`, 'info');
        const pay = await SOL().payUSDC({ treasuryAta: quote.treasuryAta, amountMicro: quote.amountMicro, memo: quote.memo, usdcMint: quote.usdcMint });
        const v = await api('/api/pay/verify', { method: 'POST', body: { paymentId: quote.paymentId, signature: pay.signature } });
        if (!v.ok) throw new Error('payment not verified: ' + (v.reason || ''));

        // 5) sponsored upload (Phantom signs; server co-signs via gas station)
        const r = await SOL().uploadSponsored(file, { paymentId: quote.paymentId, uploadToken: v.uploadToken, onStep: setStep });
        if (bar) bar.style.width = '100%'; if (pct) pct.textContent = '100%';
        setTimeout(() => renderSuccess({ ...r, contentType: file.type, paidUsdc: v.receivedUsdc }), 350);
        return;
      } catch (e) {
        show(vInit);
        const m = String(e?.message || e);
        toast(m.includes('reject') ? 'Signature rejected' : m.slice(0, 160), 'error');
        return;
      }
    }

    // Fallback: Phantom missing or sponsor disabled -> server-managed storage.
    show(vProg); if (bar) bar.style.width = '15%'; if (pct) pct.textContent = '…';
    const form = new FormData();
    form.append('file', file);
    if (state.address) form.append('owner', state.address);
    try {
      const r = await api('/api/upload', { method: 'POST', form });
      if (bar) bar.style.width = '100%'; if (pct) pct.textContent = '100%';
      setTimeout(() => renderSuccess(r), 350);
    } catch (e) {
      show(vInit);
      toast(e.status === 409 ? 'That file already exists' : (e.retriable ? 'Shelby warming up — retry' : e.message), 'error');
    }
  }

  function showPayGate(quote, have, faucets) {
    const host = $('#drop-zone')?.parentElement || document.body;
    let g = $('#pay-gate');
    if (!g) { g = document.createElement('div'); g.id = 'pay-gate'; g.className = 'glass-panel ghost-border rounded-lg p-5 mt-4 w-full'; host.appendChild(g); }
    g.innerHTML = `<div class="font-label-caps text-label-caps text-secondary mb-2">NEED TESTNET USDC TO PAY STORAGE</div>
      <p class="font-data-sm text-data-sm text-on-surface-variant mb-3">This upload costs <span class="text-primary">${quote.amountUsdc} USDC</span> (you have ${have.toFixed(4)}). The app sponsors the Aptos gas + ShelbyUSD — you only pay stablecoin. Grab devnet USDC once:</p>
      <div class="flex flex-wrap gap-3">
        <a href="${faucets.usdc}" target="_blank" class="font-label-caps text-label-caps text-primary border border-primary px-3 py-2 rounded hover:bg-primary/10">GET DEVNET USDC →</a>
        <a href="${faucets.sol}" target="_blank" class="font-label-caps text-label-caps text-primary border border-primary px-3 py-2 rounded hover:bg-primary/10">GET DEVNET SOL (gas) →</a>
        <button id="pay-retry" class="font-label-caps text-label-caps text-surface-dim bg-primary px-3 py-2 rounded hover:bg-primary-fixed-dim">I HAVE USDC — RETRY</button>
      </div>`;
    $('#pay-retry')?.addEventListener('click', async () => {
      const b = await SOL().usdcBalance();
      if (b >= quote.amountUsdc) { g.remove(); toast('USDC ready ✓ — drop your file again', 'ok'); } else toast(`Still ${b.toFixed(4)} USDC — give the faucet a moment`, 'warn');
    });
    toast('Get a little devnet USDC to pay for storage (see panel)', 'warn');
  }
  function renderSuccess(r) {
    show(vDone);
    const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
    set('#result-key', r.key);
    const urlEl = $('#result-url'); if (urlEl) urlEl.textContent = r.url;
    set('#result-size', `${(r.size / 1048576).toFixed(2)} MB`);
    const img = $('#result-thumb'); if (img && (r.contentType || '').startsWith('image/')) img.src = r.url;
    localStorage.setItem(LS.sel, r.key);
    localStorage.setItem(LS.sel + '_url', r.url);
    if (r.ownedByYou) rememberMine({ key: r.key, url: r.url, size: r.size, contentType: r.contentType || '', expiresAt: Date.now() + 7 * 24 * 3600 * 1000, account: r.account });
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
    dz.addEventListener('drop', (e) => { e.preventDefault(); doUpload(e.dataTransfer.files[0]); });
  }
  if (input) input.addEventListener('change', (e) => doUpload(e.target.files[0]));
  window.resetUpload = () => { show(vInit); if (input) input.value = ''; };
}

async function initGallery() {
  const grid = $('#gallery-grid');
  if (!grid) return;
  // Gallery = the visitor's OWN uploads (owned by their DAA account), tracked in this browser.
  const items = loadMine();
  if (!items.length) {
    grid.innerHTML = `<div class="col-span-full text-center py-16"><div class="font-headline-lg-mobile text-on-surface-variant mb-2">No media yet</div><a href="/upload.html" class="font-label-caps text-label-caps text-primary hover:underline">UPLOAD YOUR FIRST FILE →</a></div>`;
    return;
  }
  grid.innerHTML = items.map(gcard).join('') + newSlot();
  $$('.js-copy', grid).forEach((b) => (b.onclick = () => copy(b.dataset.url)));
  $$('.js-view', grid).forEach((b) => (b.onclick = () => window.open(b.dataset.url, '_blank')));
  $$('.js-del', grid).forEach((b) => (b.onclick = () => {
    if (!confirm('Remove from your gallery? (the blob stays on Shelby until it expires)')) return;
    forgetMine(b.dataset.key); toast('Removed from gallery', 'ok'); initGallery();
  }));
}
function ttl(expiresAt) {
  const ms = expiresAt - Date.now(); if (ms <= 0) return { t: 'EXPIRED', c: 'text-error' };
  const h = ms / 3600000; if (h < 24) return { t: `${Math.max(1, Math.round(h))}H LEFT`, c: 'text-error' };
  const d = Math.round(h / 24); return { t: `${d}D LEFT`, c: d <= 2 ? 'text-secondary-fixed' : 'text-primary' };
}
function gcard(it) {
  const k = ttl(it.expiresAt); const isImg = (it.contentType || '').startsWith('image/');
  return `<div class="gallery-item rounded-lg overflow-hidden relative group flex flex-col aspect-square ghost-border">
    <div class="absolute top-2 right-2 z-10 bg-surface-elevated/90 backdrop-blur border border-surface-stroke px-2 py-1 rounded font-label-caps text-label-caps ${k.c}">${k.t}</div>
    <div class="flex-grow relative overflow-hidden bg-surface-dim flex items-center justify-center">
      ${isImg ? `<img class="w-full h-full object-cover opacity-80" src="${it.url}"/>` : `<span class="material-symbols-outlined text-outline-variant" style="font-size:48px">description</span>`}
      <div class="hover-overlay absolute inset-0 bg-surface-elevated/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 flex flex-col justify-center items-center gap-3 transition-opacity duration-200">
        <button class="js-copy w-10 h-10 rounded-full bg-surface-stroke hover:bg-primary-container hover:text-surface-dim text-on-dark flex items-center justify-center transition-colors" data-url="${it.url}" title="Copy URL"><span class="material-symbols-outlined" style="font-size:20px">content_copy</span></button>
        <button class="js-view w-10 h-10 rounded-full bg-surface-stroke hover:bg-primary-container hover:text-surface-dim text-on-dark flex items-center justify-center transition-colors" data-url="${it.url}" title="Open"><span class="material-symbols-outlined" style="font-size:20px">visibility</span></button>
        <button class="js-del w-10 h-10 rounded-full bg-surface-stroke hover:bg-error hover:text-surface-dim text-on-dark flex items-center justify-center transition-colors" data-key="${it.key}" title="Delete"><span class="material-symbols-outlined" style="font-size:20px">delete</span></button>
      </div>
    </div>
    <div class="p-3 border-t border-surface-stroke bg-surface-elevated flex flex-col gap-1">
      <div class="font-data-sm text-data-sm text-primary-fixed truncate">${shortMid(it.key, 8)}</div>
      <div class="font-label-caps text-label-caps text-text-muted">${(it.contentType || '').toUpperCase()} • ${(it.size / 1048576).toFixed(1)} MB</div>
    </div></div>`;
}
function newSlot() {
  return `<a class="gallery-item rounded-lg overflow-hidden relative group flex flex-col aspect-square border-dashed border-2 hover:border-solid items-center justify-center cursor-pointer ghost-border" href="/upload.html">
    <div class="flex flex-col items-center gap-3 text-outline-variant group-hover:text-primary transition-colors"><span class="material-symbols-outlined" style="font-size:48px">upload_file</span><span class="font-label-caps text-label-caps">UPLOAD NEW</span></div></a>`;
}

async function initLatency() {
  const sMs = $('#shelby-ms'), iMs = $('#ipfs-ms'), sBar = $('#shelby-bar'), iBar = $('#ipfs-bar');
  const btn = $('#rerun-btn');
  async function run() {
    // Prefer the visitor's own uploaded asset (their DAA account) via its real Shelby URL.
    const url = localStorage.getItem(LS.sel + '_url');
    let key = localStorage.getItem(LS.sel);
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
  const name = $('#nft-name'), desc = $('#nft-desc'), link = $('#nft-link'), preview = $('#json-preview');
  const gen = $('#generate-btn'), result = $('#result-area');
  const key = localStorage.getItem(LS.sel);
  const imageUrl = localStorage.getItem(LS.sel + '_url') || (key ? `${API}/api/media/${key}` : '');
  const imgPrev = $('#meta-image-key'); if (imgPrev) imgPrev.textContent = key ? shortMid(key, 10) : '(pick from gallery)';
  function build() {
    const o = { name: name?.value || '', description: desc?.value || '', image: imageUrl || '(upload an image first)' };
    if (link?.value) o.external_url = link.value;
    if (preview) preview.textContent = JSON.stringify(o, null, 2);
    return o;
  }
  [name, desc, link].forEach((el) => el && el.addEventListener('input', build));
  build();
  if (gen) gen.onclick = async () => {
    if (!key) { toast('Upload an image first (Gallery → pick one)', 'warn'); return; }
    gen.disabled = true; const orig = gen.innerHTML; gen.innerHTML = 'Processing…';
    try {
      const r = await api('/api/metadata', { method: 'POST', body: { name: name?.value, description: desc?.value, imageKey: key, imageUrl, external_url: link?.value } });
      if (result) { result.classList.remove('hidden'); result.classList.add('flex'); }
      const out = $('#result-uri'); if (out) out.value = r.tokenUri;
      $('#copy-uri')?.addEventListener('click', () => copy(r.tokenUri));
      toast('TokenURI hosted on Shelby', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    gen.disabled = false; gen.innerHTML = orig;
  };
}

/* ------------------------------- boot --------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  renderWallet();
  const p = page();
  ({ index: initLanding, identity: initIdentity, upload: initUpload, gallery: initGallery, latency: initLatency, metadata: initMetadata }[p] || (() => {}))();
});

window.Vessel = { connectWallet, proveOwnership, state, copy, api };
