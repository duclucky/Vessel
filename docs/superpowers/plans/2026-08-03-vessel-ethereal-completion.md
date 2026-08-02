# Vessel Ethereal Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign all six Vessel pages to match the supplied Vessel Ethereal Stitch reference while preserving and live-verifying the proven Phantom, USDC, sponsored DAA, Shelby upload, ledger, latency, and metadata flow.

**Architecture:** Keep the existing vanilla HTML/ES-module/Express application. Introduce one shared Tailwind theme script, one shared visual stylesheet, and a small pure localStorage ledger module; preserve all API and wallet integration boundaries. Page HTML retains the runtime IDs consumed by `public/app.js`, while dynamic cards and feedback states are updated to use the shared visual components.

**Tech Stack:** HTML5, Tailwind CDN, CSS, vanilla ES modules, Node.js built-in test runner, Express 4, esbuild, Shelby SDK 0.3.1, Solana kit 0.2.8, Phantom, Vercel.

## Global Constraints

- Preserve the six URLs: `/`, `/identity.html`, `/upload.html`, `/gallery.html`, `/latency.html`, `/metadata.html`.
- Do not change the proven Phantom/DAA signing, USDC payment, gas-station sponsorship, or Shelby byte-upload recipe.
- Never expose `SHELBY_API_KEY`, gas-station keys, payment HMAC material, Solana secret keys, or `.env` content.
- Use only accurate copy: Shelby testnet is ephemeral; do not claim managed encryption, immutability, permanence, or weekly wipes.
- Serve the supplied crystal hero artwork locally; do not hotlink Stitch image URLs.
- Keep metadata contextual rather than adding it to the primary navigation.
- Support 320, 375, 768, 1024, and 1440px widths with no page-level horizontal overflow.
- Respect `prefers-reduced-motion`, retain visible focus, and keep icon-only targets named and at least 44x44px.
- Preserve the user's existing `app/server/.gitignore` modification and do not commit the untracked Stitch reference folder.
- Run tests/build and inspect the diff before every completion claim.

## File map

- Create `app/server/public/theme.js`: the single Tailwind semantic token configuration.
- Create `app/server/public/vessel.css`: shared Ethereal backgrounds, glass surfaces, navigation, buttons, states, and responsive/accessibility rules.
- Create `app/server/public/assets/hero-crystals.png`: local copy of the supplied artwork-only PNG.
- Create `app/server/public/ledger.js`: pure localStorage ledger API used by the app and unit tests.
- Modify `app/server/public/app.js`: consume the ledger API; render redesigned dynamic feedback/gallery states; route landing CTAs to Identity.
- Modify all six `app/server/public/*.html`: shared head/shell plus page-specific Ethereal markup while retaining runtime IDs.
- Modify `app/server/package.json`: add `test`, `test:ui`, and `check` scripts.
- Create `app/server/test/html-test-utils.js`: read HTML, extract attributes, and assert runtime contracts without adding a DOM dependency.
- Create focused files under `app/server/test/*.test.js`: theme/landing, identity, upload, ledger/gallery, latency/metadata, and accessibility contracts.
- Do not modify `app/server/client-src/vessel-solana.js`, `src/lib/payments.js`, or `src/lib/sponsor.js` unless verification proves the visual refactor caused an integration regression.

---

### Task 1: Test foundation, shared Ethereal theme, and Landing

**Files:**
- Create: `app/server/test/html-test-utils.js`
- Create: `app/server/test/theme-and-landing.test.js`
- Create: `app/server/public/theme.js`
- Create: `app/server/public/vessel.css`
- Create: `app/server/public/assets/hero-crystals.png`
- Modify: `app/server/public/index.html`
- Modify: `app/server/public/app.js:94-117`
- Modify: `app/server/package.json`

**Interfaces:**
- Produces: `readPage(name): string`, `getIds(html): Set<string>`, `getLinks(html): Array<{href,text}>`, shared `.vessel-*` visual classes, and landing anchors marked `data-wallet-entry`.
- Consumes: the supplied Ethereal design tokens and hero PNG.

- [ ] **Step 1: Add the failing Landing/theme contract test**

Create `test/html-test-utils.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.resolve(here, '..', 'public');
export const readPage = (name) => fs.readFileSync(path.join(publicDir, name), 'utf8');
export const getIds = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
export const getLinks = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: m[1].match(/\bhref="([^"]+)"/)?.[1] || '',
  text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  attrs: m[1],
}));
export const assertNoInlineTailwindConfig = (html) => !/<script\s+id="tailwind-config"/.test(html);
```

Create `test/theme-and-landing.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicDir, readPage, getLinks, assertNoInlineTailwindConfig } from './html-test-utils.js';

test('shared theme scripts parse and Landing uses them', () => {
  const theme = fs.readFileSync(path.join(publicDir, 'theme.js'), 'utf8');
  new Function(theme);
  const html = readPage('index.html');
  assert.match(html, /<script src="\/theme\.js"><\/script>/);
  assert.match(html, /<link[^>]+href="\/vessel\.css"/);
  assert.equal(assertNoInlineTailwindConfig(html), true);
});

test('every Landing wallet entry routes to Identity without MetaMask', () => {
  const entries = getLinks(readPage('index.html')).filter((link) => /data-wallet-entry/.test(link.attrs));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((link) => link.href), ['/identity.html', '/identity.html']);
});

test('Landing serves the crystal artwork locally and states three honest proofs', () => {
  const html = readPage('index.html');
  assert.match(html, /\/assets\/hero-crystals\.png/);
  assert.match(html, />DAA</);
  assert.match(html, />Sub-second</);
  assert.match(html, />Ephemeral</);
  assert.doesNotMatch(html, /encrypted|immutable|wiped weekly/i);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
cd D:\Visell\app\server
node --test test/theme-and-landing.test.js
```

Expected: FAIL because `theme.js`, `vessel.css`, local hero asset, and `data-wallet-entry` links do not exist.

- [ ] **Step 3: Add test scripts**

Add to `package.json`:

```json
"scripts": {
  "start": "node src/index.js",
  "dev": "node --watch src/index.js",
  "build:client": "node build-client.mjs",
  "test": "node --test test/*.test.js",
  "test:ui": "node --test test/theme-and-landing.test.js test/identity.test.js test/upload.test.js test/ledger-and-gallery.test.js test/latency-and-metadata.test.js test/accessibility.test.js",
  "check": "npm test && npm run build:client"
}
```

- [ ] **Step 4: Implement the shared Tailwind theme**

Create `public/theme.js` with `globalThis.tailwind.config` containing the exact Ethereal semantic tokens:

```js
globalThis.tailwind = globalThis.tailwind || {};
globalThis.tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#111319', background: '#111319', 'surface-lowest': '#0c0e13',
        'surface-low': '#191b21', 'surface-container': '#1e1f25',
        'surface-high': '#282a30', 'surface-highest': '#33353a',
        'on-surface': '#e2e2e9', 'on-surface-variant': '#bbcac5',
        outline: '#859490', 'outline-variant': '#3c4946',
        primary: '#b5fff0', 'primary-container': '#5eead4',
        secondary: '#cebdff', 'secondary-container': '#4f319c',
        tertiary: '#d5f7ff', 'tertiary-container': '#5ee6ff',
        error: '#ffb4ab', 'error-container': '#93000a'
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body: ['Geist', 'sans-serif'],
        technical: ['JetBrains Mono', 'monospace']
      },
      borderRadius: { vessel: '2rem', control: '1.5rem' },
      boxShadow: {
        bloom: '0 0 40px rgba(94,234,212,.14)',
        violet: '0 0 44px rgba(79,49,156,.18)'
      }
    }
  }
};
```

- [ ] **Step 5: Implement the shared CSS primitives**

Create `public/vessel.css` with these required primitives and keep page-specific layout in HTML utility classes:

```css
:root { color-scheme: dark; --mint:#5eead4; --violet:#8066d8; --cyan:#5ee6ff; }
* { box-sizing: border-box; }
html { background:#0c0e13; scroll-behavior:smooth; }
body { margin:0; min-height:100vh; overflow-x:hidden; background:#111319; color:#e2e2e9; font-family:Geist,sans-serif; }
body::before { content:""; position:fixed; inset:0; z-index:-2; pointer-events:none; background:radial-gradient(circle at 12% 12%,rgba(94,234,212,.12),transparent 34%),radial-gradient(circle at 82% 78%,rgba(79,49,156,.18),transparent 38%),#0c0e13; }
.skip-link { position:fixed; left:1rem; top:-5rem; z-index:100; padding:.75rem 1rem; border-radius:1rem; background:#b5fff0; color:#003730; }
.skip-link:focus { top:1rem; }
.vessel-glass { background:rgba(25,27,33,.58); border:1px solid rgba(255,255,255,.09); box-shadow:inset 0 1px rgba(255,255,255,.06),0 24px 80px rgba(0,0,0,.28); backdrop-filter:blur(24px); }
.vessel-nav { background:rgba(12,14,19,.72); border:1px solid rgba(181,255,240,.13); backdrop-filter:blur(28px); }
.vessel-button { min-height:44px; border-radius:9999px; display:inline-flex; align-items:center; justify-content:center; gap:.65rem; font:700 12px/1 JetBrains Mono,monospace; letter-spacing:.12em; transition:transform .2s,box-shadow .2s,filter .2s; }
.vessel-button-primary { color:#003730; background:linear-gradient(110deg,#5eead4,#5ee6ff 48%,#8066d8); box-shadow:0 0 30px rgba(94,234,212,.18); }
.vessel-button:hover { transform:translateY(-1px); filter:brightness(1.08); }
.vessel-button:active { transform:translateY(0) scale(.985); }
:where(a,button,input,textarea,summary):focus-visible { outline:2px solid #5ee6ff; outline-offset:4px; }
.vessel-kicker { font:700 11px/1 JetBrains Mono,monospace; letter-spacing:.18em; text-transform:uppercase; }
.vessel-technical { font-family:JetBrains Mono,monospace; letter-spacing:.03em; }
.vessel-bloom { position:absolute; border-radius:9999px; filter:blur(70px); pointer-events:none; }
.vessel-artifact { overflow:hidden; border-radius:2rem; background:rgba(12,14,19,.78); border:1px solid rgba(255,255,255,.08); }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto!important; animation-duration:.01ms!important; animation-iteration-count:1!important; transition-duration:.01ms!important; } }
```

- [ ] **Step 6: Copy the approved hero asset into the public tree**

Copy exactly:

```powershell
New-Item -ItemType Directory -Force -Path 'D:\Visell\app\server\public\assets'
Copy-Item -LiteralPath 'D:\Visell\stitch_guideline_compliance_design (1)\stitch_guideline_compliance_design\a_hero_image_for_an_nft_storage_platform_called_vessel._the_visual_should_be_an\screen.png' -Destination 'D:\Visell\app\server\public\assets\hero-crystals.png'
```

Then verify its SHA-256 against the source:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\Visell\stitch_guideline_compliance_design (1)\stitch_guideline_compliance_design\a_hero_image_for_an_nft_storage_platform_called_vessel._the_visual_should_be_an\screen.png','D:\Visell\app\server\public\assets\hero-crystals.png'
```

Expected: both hashes are identical.

- [ ] **Step 7: Replace Landing with the shared shell and reference composition**

Use the shared head in this exact order so the Tailwind runtime exists before configuration:

```html
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/vessel.css">
```

The body must include an accurate status strip, floating desktop/mobile navigation, `<main id="main-content">`, hero background `/assets/hero-crystals.png`, two anchors with `data-wallet-entry href="/identity.html"`, and the DAA/Sub-second/Ephemeral proof cards. Remove the inline `tailwind-config` script and all `.js-connect` classes from Landing.

- [ ] **Step 8: Remove the Landing MetaMask override**

Replace `initLanding` in `public/app.js` with a no-op because navigation is now native anchors:

```js
function initLanding() {}
```

Keep `connectWallet()` for the Ethereum fallback on non-Landing pages.

Update `toast(msg, kind)` to assign `role="status"`, `aria-live="polite"`, and the shared `vessel-glass vessel-technical` classes while preserving the existing kind-based accent and four-second removal behavior.

- [ ] **Step 9: Run GREEN checks**

Run:

```powershell
npm run test:ui -- --test-name-pattern="theme|Landing"
```

Expected: 3 passing tests, 0 failures.

- [ ] **Step 10: Commit Task 1**

```powershell
git add -- app/server/package.json app/server/public/theme.js app/server/public/vessel.css app/server/public/assets/hero-crystals.png app/server/public/index.html app/server/public/app.js app/server/test/html-test-utils.js app/server/test/theme-and-landing.test.js
git commit -m "feat(ui): establish Vessel Ethereal shell"
```

---

### Task 2: Ethereal Identity page

**Files:**
- Create: `app/server/test/identity.test.js`
- Modify: `app/server/public/identity.html`
- Modify: `app/server/public/app.js:119-161`

**Interfaces:**
- Consumes: shared head/shell and existing IDs `origin-wallet`, `derived-account`, `sign-btn`, `sign-btn-label`, `auth-status`.
- Produces: an accessible two-column identity/signature composition with unchanged Phantom derivation behavior.

- [ ] **Step 1: Write the failing Identity contract**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage, getIds, assertNoInlineTailwindConfig } from './html-test-utils.js';

test('Identity keeps runtime hooks inside the Ethereal shell', () => {
  const html = readPage('identity.html');
  const ids = getIds(html);
  for (const id of ['main-content','origin-wallet','derived-account','sign-btn','sign-btn-label','auth-status']) assert.equal(ids.has(id), true, id);
  assert.match(html, /<script src="\/theme\.js"><\/script>/);
  assert.equal(assertNoInlineTailwindConfig(html), true);
  assert.match(html, /Controlling wallet/i);
  assert.match(html, /Derived Aptos storage account/i);
  assert.doesNotMatch(html, /Ethereum Wallet|encrypted|weekly/i);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/identity.test.js`.

Expected: FAIL because the page lacks the shared shell/main ID and still contains the malformed inline Tailwind config.

- [ ] **Step 3: Implement Identity markup**

Replace the page with the shared shell. The `<main id="main-content">` must contain:

```html
<header class="mx-auto max-w-3xl text-center">
  <p class="vessel-kicker text-primary-container">Derived Account Abstraction</p>
  <h1 class="mt-4 font-display text-4xl font-bold tracking-tight md:text-7xl">Ethereal Identity</h1>
  <p class="mt-5 text-on-surface-variant md:text-lg">Your Phantom wallet controls a Shelby storage account without a new seed phrase.</p>
</header>
<section class="grid gap-6 lg:grid-cols-[.85fr_1.15fr]" aria-label="Wallet-owned storage identity">
  <article class="vessel-glass rounded-vessel p-6 md:p-8">
    <p class="vessel-kicker text-primary">Active identity node</p>
    <div class="mt-6 rounded-control bg-surface-lowest/70 p-5">
      <p class="vessel-kicker text-on-surface-variant">Controlling wallet</p>
      <div class="mt-2 flex items-center justify-between gap-3">
        <span id="origin-wallet" class="vessel-technical min-w-0 truncate">—</span>
        <button class="js-copy-origin min-h-11 min-w-11" aria-label="Copy controlling wallet address">copy</button>
      </div>
    </div>
    <div class="mt-4 rounded-control bg-surface-lowest/70 p-5">
      <p class="vessel-kicker text-secondary">Derived Aptos storage account</p>
      <div class="mt-2 flex items-center justify-between gap-3">
        <span id="derived-account" class="vessel-technical min-w-0 truncate">(connect wallet)</span>
        <button class="js-copy-derived min-h-11 min-w-11" aria-label="Copy derived storage account">copy</button>
      </div>
    </div>
  </article>
  <article class="vessel-glass rounded-vessel p-6 md:p-10">
    <p class="vessel-kicker text-tertiary-container">Wallet-owned storage</p>
    <h2 class="mt-4 font-display text-3xl font-semibold">Prove control with Phantom</h2>
    <p class="mt-4 text-on-surface-variant">One wallet signature derives and authorizes your Aptos-side Shelby identity. No new wallet or seed phrase is created.</p>
    <p id="auth-status" class="vessel-technical mt-8" role="status">Ready for Phantom</p>
    <button id="sign-btn" class="vessel-button vessel-button-primary mt-6 w-full px-6 py-4">
      <span id="sign-btn-label">CONNECT PHANTOM</span>
    </button>
  </article>
</section>
```

Preserve `/vessel-solana.js` before `/app.js`, copy buttons with `.js-copy-origin` and `.js-copy-derived`, and the existing visual relationship between controlling wallet and derived account. Give icon-only copy buttons `aria-label` and `min-h-11 min-w-11`.

- [ ] **Step 4: Keep Identity state copy accurate**

In `initIdentity`, use these state labels without changing the signing calls:

```js
if (status) status.textContent = 'Wallet connected · storage identity derived';
// and after action:
if (status) status.textContent = 'Ownership verified · ready to upload';
```

- [ ] **Step 5: Verify GREEN and commit**

Run `node --test test/identity.test.js` and `node --check public/app.js`.

Expected: all pass, exit 0.

```powershell
git add -- app/server/public/identity.html app/server/public/app.js app/server/test/identity.test.js
git commit -m "feat(ui): redesign wallet identity journey"
```

---

### Task 3: Ethereal Upload states

**Files:**
- Create: `app/server/test/upload.test.js`
- Modify: `app/server/public/upload.html`
- Modify: `app/server/public/app.js:163-273`

**Interfaces:**
- Consumes: all existing Upload IDs and `window.VesselSolana` methods unchanged.
- Produces: initial, progress, payment-gate, success, and retry states styled by shared classes.

- [ ] **Step 1: Write the failing Upload contract**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage, getIds } from './html-test-utils.js';

test('Upload preserves every runtime state and honest sponsorship copy', () => {
  const html = readPage('upload.html');
  const ids = getIds(html);
  for (const id of ['main-content','upload-initial-view','drop-zone','file-input','upload-progress-view','progress-percentage','progress-bar','upload-filename','upload-success-view','result-thumb','result-key','result-url','copy-url','result-size','to-metadata']) assert.equal(ids.has(id), true, id);
  assert.match(html, /Sponsored DAA upload/i);
  assert.match(html, /testnet USDC/i);
  assert.doesNotMatch(html, /AES|encrypted|immutable|weekly/i);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/upload.test.js`.

Expected: FAIL because the existing copy/design does not satisfy the Ethereal shell and honest-copy contract.

- [ ] **Step 3: Implement Upload page**

Use a centered header plus `lg:grid-cols-[.7fr_1.3fr]`. The left glass panel explains `Phantom signs`, `USDC devnet payment`, and `App sponsors Aptos gas + ShelbyUSD`. The right panel contains the existing three state containers. The drop zone keeps `id="drop-zone"`, a real `<label for="file-input">Select file</label>`, accepted media copy, and a focus-visible input path. Keep `/vessel-solana.js` before `/app.js`.

- [ ] **Step 4: Restyle dynamic payment/error/success state without changing calls**

Change `showPayGate` classes to `vessel-glass rounded-vessel p-6 mt-6 w-full`, set `role="alert"`, and keep the exact faucet URLs from `SOL().faucets`. Update progress labels only:

```js
const stepMsg = {
  signing: 'SIGNING OWNERSHIP', paying: 'VERIFYING USDC',
  sponsoring: 'SPONSORING APTOS', uploading: 'WRITING TO SHELBY'
};
```

Do not change the quote, payment, verification, or `uploadSponsored` call arguments.

- [ ] **Step 5: Verify GREEN and commit**

Run `node --test test/upload.test.js` and `node --check public/app.js`.

```powershell
git add -- app/server/public/upload.html app/server/public/app.js app/server/test/upload.test.js
git commit -m "feat(ui): redesign sponsored upload states"
```

---

### Task 4: Testable ledger and The Vault Gallery

**Files:**
- Create: `app/server/public/ledger.js`
- Create: `app/server/test/ledger-and-gallery.test.js`
- Modify: `app/server/public/app.js:4-26,249-317`
- Modify: `app/server/public/gallery.html`

**Interfaces:**
- Produces: `createLedger(storage, now?)` with `loadMine()`, `rememberMine(item)`, `forgetMine(key)`, `commitUpload(result)`, and `selected()`.
- Consumes: storage implementing `getItem`, `setItem`, and `removeItem`.

- [ ] **Step 1: Write the failing pure ledger tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../public/ledger.js';
import { readPage, getIds } from './html-test-utils.js';

const memoryStorage = () => {
  const map = new Map();
  return { getItem:k=>map.get(k)??null, setItem:(k,v)=>map.set(k,String(v)), removeItem:k=>map.delete(k), dump:()=>map };
};

test('successful owned upload records selection and wallet-owned gallery item', () => {
  const storage = memoryStorage();
  const ledger = createLedger(storage, () => 1_000);
  ledger.commitUpload({ key:'media/a.png', url:'https://shelby/a.png', size:42, contentType:'image/png', ownedByYou:true, account:'0xabc' });
  assert.deepEqual(ledger.selected(), { key:'media/a.png', url:'https://shelby/a.png' });
  assert.equal(ledger.loadMine()[0].expiresAt, 604_801_000);
  assert.equal(ledger.loadMine()[0].account, '0xabc');
});

test('server-managed result is selected but not represented as wallet-owned', () => {
  const storage = memoryStorage();
  const ledger = createLedger(storage, () => 1_000);
  ledger.commitUpload({ key:'media/fallback.png', url:'https://shelby/fallback.png', size:7, ownedByYou:false });
  assert.equal(ledger.selected().key, 'media/fallback.png');
  assert.deepEqual(ledger.loadMine(), []);
});

test('Gallery retains its grid hook and Vault composition', () => {
  const html = readPage('gallery.html');
  assert.equal(getIds(html).has('gallery-grid'), true);
  assert.match(html, />The Vault</);
  assert.match(html, /Your wallet-owned artifacts/i);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/ledger-and-gallery.test.js`.

Expected: FAIL with module-not-found for `public/ledger.js`.

- [ ] **Step 3: Implement the pure ledger module**

```js
export const LS = { addr:'vessel_addr', sa:'vessel_sa', verified:'vessel_verified', sel:'vessel_selected_key', mine:'vessel_mine' };

export function createLedger(storage = globalThis.localStorage, now = Date.now) {
  const loadMine = () => { try { const value = JSON.parse(storage.getItem(LS.mine) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  const rememberMine = (item) => {
    const list = loadMine().filter((entry) => entry.key !== item.key);
    list.unshift(item);
    storage.setItem(LS.mine, JSON.stringify(list.slice(0, 60)));
  };
  const forgetMine = (key) => storage.setItem(LS.mine, JSON.stringify(loadMine().filter((entry) => entry.key !== key)));
  const selected = () => ({ key:storage.getItem(LS.sel) || '', url:storage.getItem(`${LS.sel}_url`) || '' });
  const commitUpload = (result) => {
    storage.setItem(LS.sel, result.key);
    storage.setItem(`${LS.sel}_url`, result.url);
    if (result.ownedByYou) rememberMine({ key:result.key, url:result.url, size:result.size, contentType:result.contentType || '', expiresAt:now() + 7*24*3600*1000, account:result.account });
  };
  return { loadMine, rememberMine, forgetMine, selected, commitUpload };
}
```

- [ ] **Step 4: Use the ledger in `app.js`**

At the top:

```js
import { createLedger, LS } from './ledger.js';
const ledger = createLedger(localStorage);
const { loadMine, forgetMine } = ledger;
```

In `renderSuccess`, replace direct localStorage writes and `rememberMine` with:

```js
ledger.commitUpload(r);
```

In Latency/Metadata, use `ledger.selected()` in place of duplicate selected-key reads.

- [ ] **Step 5: Redesign Gallery and dynamic cards**

Use the shared shell, “The Vault” header, `<span id="artifact-count">`, and `<section id="gallery-grid">`. Update `gcard(it)` to emit one `.vessel-artifact` article with image/placeholder, TTL chip, technical key/size/account, and named copy/view/remove buttons. Images use `.js-artifact-image`; each card includes a hidden `.js-artifact-fallback` technical placeholder. Update `newSlot()` to emit the first upload-new card. Preserve `.js-copy`, `.js-view`, `.js-del` and their data attributes. In `initGallery`, set the count after `const items = loadMine()`. Attach image fallback listeners immediately after assigning `grid.innerHTML`:

```js
const count = $('#artifact-count');
if (count) count.textContent = `${items.length} ${items.length === 1 ? 'artifact' : 'artifacts'}`;
$$('.js-artifact-image', grid).forEach((img) => img.addEventListener('error', () => {
  img.classList.add('hidden');
  img.parentElement?.querySelector('.js-artifact-fallback')?.classList.remove('hidden');
}, { once:true }));
```

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
node --test test/ledger-and-gallery.test.js
node --check public/ledger.js
node --check public/app.js
```

```powershell
git add -- app/server/public/ledger.js app/server/public/app.js app/server/public/gallery.html app/server/test/ledger-and-gallery.test.js
git commit -m "feat(ui): add tested upload ledger and Vault gallery"
```

---

### Task 5: Ethereal Latency and Metadata

**Files:**
- Create: `app/server/test/latency-and-metadata.test.js`
- Modify: `app/server/public/latency.html`
- Modify: `app/server/public/metadata.html`
- Modify: `app/server/public/app.js:319-391`

**Interfaces:**
- Consumes: `ledger.selected()` and all existing Latency/Metadata IDs.
- Produces: responsive comparison and metadata workbench without changing API request shapes.

- [ ] **Step 1: Write the failing contracts**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage, getIds } from './html-test-utils.js';

test('Latency retains all measurement hooks in the Ethereal shell', () => {
  const ids = getIds(readPage('latency.html'));
  for (const id of ['shelby-ms','shelby-bar','ipfs-ms','ipfs-unavailable','ipfs-bar','shelby-median','shelby-min','shelby-p90','ipfs-median','ipfs-min','ipfs-p90','rerun-btn']) assert.equal(ids.has(id), true, id);
  assert.match(readPage('latency.html'), /Same selected artifact/i);
});

test('Metadata retains selected asset, form, JSON, and tokenURI hooks', () => {
  const ids = getIds(readPage('metadata.html'));
  for (const id of ['meta-image-key','nft-name','nft-desc','nft-link','json-preview','generate-btn','result-area','result-uri','copy-uri']) assert.equal(ids.has(id), true, id);
  assert.match(readPage('metadata.html'), /TokenURI workbench/i);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/latency-and-metadata.test.js`.

Expected: FAIL on the new Ethereal headings/copy.

- [ ] **Step 3: Implement Latency composition**

Retain every ID. Use a two-column comparison panel with textual labels in addition to teal/violet bars. Keep `ipfs-unavailable` visible when the server returns no comparable IPFS URL. The rerun control remains a `<button>` with loading-disabled treatment.

- [ ] **Step 4: Implement Metadata composition**

Retain every ID. Use a selected-artifact summary and form in the left column, JSON preview/result in the right column. Keep `json-preview` as `<pre aria-live="polite">`, `result-area` initially hidden, and `copy-uri` named.

- [ ] **Step 5: Preserve API shapes while using ledger selection**

Initialize both pages with:

```js
const { key, url } = ledger.selected();
```

Keep `/api/latency` body `{ key, url }` and `/api/metadata` body `{ name, description, imageKey:key, imageUrl:url, external_url }` unchanged.

- [ ] **Step 6: Verify GREEN and commit**

Run `node --test test/latency-and-metadata.test.js` and `node --check public/app.js`.

```powershell
git add -- app/server/public/latency.html app/server/public/metadata.html app/server/public/app.js app/server/test/latency-and-metadata.test.js
git commit -m "feat(ui): redesign latency and metadata proof screens"
```

---

### Task 6: Cross-page accessibility, responsive, and copy contracts

**Files:**
- Create: `app/server/test/accessibility.test.js`
- Modify: all six `app/server/public/*.html`
- Modify: `app/server/public/vessel.css`

**Interfaces:**
- Consumes: shared shell/page layouts.
- Produces: static accessibility/copy guarantees and responsive CSS gates.

- [ ] **Step 1: Write the failing cross-page contract**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage } from './html-test-utils.js';

const pages = ['index.html','identity.html','upload.html','gallery.html','latency.html','metadata.html'];

for (const page of pages) test(`${page} has the accessible shared shell`, () => {
  const html = readPage(page);
  assert.match(html, /<meta[^>]+name="viewport"/);
  assert.match(html, /class="[^"]*skip-link[^"]*"[^>]+href="#main-content"/);
  assert.match(html, /<main[^>]+id="main-content"/);
  assert.match(html, /<h1\b/);
  assert.match(html, /<footer\b/);
  assert.match(html, /Shelby Testnet/);
  assert.match(html, /Data is Ephemeral/);
  assert.doesNotMatch(html, /href="#"/);
  assert.doesNotMatch(html, /encrypted|immutable|permanent storage|wiped weekly/i);
});

test('shared CSS contains reduced-motion and focus-visible safeguards', () => {
  const css = readPage('vessel.css');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});

test('browser JavaScript parses and dynamic copy stays honest', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  for (const file of ['theme.js','ledger.js','app.js']) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../public/${file}`, import.meta.url))], { stdio:'pipe' });
  const app = readPage('app.js');
  assert.doesNotMatch(app, /managed encryption|immutable|permanent storage|wiped weekly/i);
  assert.match(app, /ledger\.commitUpload\(r\)/);
});
```

Adjust `readPage` to read any public filename, including CSS.

- [ ] **Step 2: Verify RED**

Run `node --test test/accessibility.test.js`.

Expected: FAIL for any page missing the shared shell, skip link, accurate status copy, or real footer destinations.

- [ ] **Step 3: Normalize all shells and interactions**

Ensure all six pages have one `h1`, a skip link, desktop and `<details>` mobile navigation, correct active state (`aria-current="page"`), and fixed-nav spacing. Replace placeholder footer anchors with plain text or the real GitHub URL `https://github.com/duclucky/Vessel`.

- [ ] **Step 4: Add responsive safeguards**

Add to `vessel.css`:

```css
img,video,canvas,svg { max-width:100%; }
pre { max-width:100%; overflow:auto; }
.vessel-page { width:min(100% - 2.5rem, 92rem); margin-inline:auto; }
@media (min-width:768px) { .vessel-page { width:min(100% - 5rem, 92rem); } }
@media (max-width:374px) { .vessel-page { width:min(100% - 2rem, 92rem); } .vessel-button { letter-spacing:.08em; } }
```

- [ ] **Step 5: Run the full static suite and commit**

Run `npm test`.

Expected: all test files pass, 0 failures.

```powershell
git add -- app/server/public/index.html app/server/public/identity.html app/server/public/upload.html app/server/public/gallery.html app/server/public/latency.html app/server/public/metadata.html app/server/public/vessel.css app/server/test/accessibility.test.js app/server/test/html-test-utils.js
git commit -m "test(ui): enforce accessible responsive Ethereal shell"
```

---

### Task 7: Browser visual QA and integration checkpoint

**Files:**
- Modify only files whose inspected visual/runtime behavior fails this checkpoint.
- Do not commit screenshots, browser profiles, cookies, localStorage dumps, or wallet data.

**Interfaces:**
- Consumes: locally running Express app and the supplied three Stitch screenshots.
- Produces: inspected desktop/mobile layouts and console-clean dynamic states.

- [ ] **Step 1: Run fresh automated verification**

```powershell
cd D:\Visell\app\server
npm run check
```

Expected: all tests pass; `build:client` exits 0 and copies `clay.wasm`.

- [ ] **Step 2: Start the local app without exposing secrets**

Run `npm start` in a bounded terminal session. Verify `GET http://localhost:8787/api/health` returns 200. Do not print `.env` or `/api/config` bodies containing account identifiers into the transcript.

- [ ] **Step 3: Inspect all pages in the browser**

At 1440x1200, compare Landing, Identity, and Gallery against:

- `vessel_landing_connect_ethereal/screen.png`
- `vessel_identity_upload_ethereal/screen.png`
- `vessel_immersive_gallery_deep_dark/screen.png`

Inspect all six pages at 320, 375, 768, 1024, and 1440px. At each width assert `document.documentElement.scrollWidth <= window.innerWidth`, fixed nav does not cover `h1`, keyboard focus is visible, mobile menu works, and console contains no app/theme syntax errors.

- [ ] **Step 4: Seed non-sensitive local ledger data for visual states**

Use page-evaluated JavaScript to write one fictional localStorage ledger entry with URL `https://example.invalid/media/demo.png`, reload Gallery/Latency/Metadata, and inspect populated layouts. Clear exactly `vessel_mine`, `vessel_selected_key`, and `vessel_selected_key_url` afterward.

- [ ] **Step 5: Fix one visual defect per RED/GREEN loop**

For each defect, add or tighten the relevant automated contract first, verify it fails, make the smallest HTML/CSS/JS change, rerun the focused test, then re-inspect the affected viewport. Do not batch unrelated visual fixes.

- [ ] **Step 6: Stop the local server and commit the QA corrections**

Run `npm run check` again, verify the server process is stopped, then commit only files changed by this checkpoint:

```powershell
git add -- app/server/public app/server/test app/server/package.json app/server/package-lock.json
git commit -m "fix(ui): close responsive visual QA gaps"
```

If there are no corrections, do not create an empty commit.

---

### Task 8: Production configuration, deploy, live upload, and recording

**Files:**
- No source changes expected unless production verification identifies a reproducible regression.
- Create local, untracked evidence under `artifacts/demo/` only if the capture tool requires a path; do not stage wallet-sensitive recordings without explicit review.

**Interfaces:**
- Consumes: verified local build, existing Vercel project, authorized Phantom wallet, devnet SOL/USDC.
- Produces: production deployment, live UI-owned blob, downstream ledger proof, and demo recording.

- [ ] **Step 1: Review deployment state read-only**

Run:

```powershell
cd D:\Visell\app\server
vercel whoami
vercel env ls production
vercel project inspect
```

Expected: authenticated as the existing account; project resolves to `duckys-projects-bc83c6a0/vessel`. Do not print secret values.

- [ ] **Step 2: Set the public production base**

Create or update only `PUBLIC_BASE` in production with the Vercel CLI 58 non-interactive command:

```powershell
vercel env add PUBLIC_BASE production --value "https://vessel-sage.vercel.app" --no-sensitive --force --yes
```

Expected: `Added Environment Variable PUBLIC_BASE to Project vessel` (or the equivalent overwrite confirmation). Do not pull or print any environment file.

- [ ] **Step 3: Run the final pre-deploy gate**

```powershell
npm run check
git diff --check
git status --short
```

Expected: checks pass; only intentional source changes and the user's pre-existing `.gitignore`/reference-folder state remain.

- [ ] **Step 4: Deploy the verified production build**

```powershell
vercel deploy --prod --yes
```

Expected: READY deployment assigned to `https://vessel-sage.vercel.app`.

- [ ] **Step 5: Run read-only production smoke checks**

Verify `/`, all five `.html` pages, `/theme.js`, `/vessel.css`, `/assets/hero-crystals.png`, `/clay.wasm`, and `/api/health` return 200. Inspect production console at desktop and mobile widths before opening Phantom.

- [ ] **Step 6: Run one authorized live UI upload**

Using the connected Phantom session:

1. Enter through Landing -> Identity.
2. Connect Phantom and confirm the displayed Solana/DAA identities.
3. Select a small, non-sensitive PNG through the visible Upload control.
4. Approve the displayed devnet USDC amount and sponsored registration prompts.
5. Wait for the success panel; record only transaction/blob identifiers safe for the public demo.
6. Fetch the returned Shelby URL and verify HTTP 200 plus byte length/content type.

Stop immediately if Phantom displays an unexpected network, treasury, amount, or signing payload.

- [ ] **Step 7: Verify the three ledger consumers**

- Gallery: the uploaded artifact appears with the returned key and owner status.
- Latency: rerun uses the selected Shelby URL; IPFS remains explicitly unavailable if no same-asset CID is configured.
- Metadata: JSON preview uses the selected Shelby URL and `/api/metadata` returns a tokenURI-ready URL.

- [ ] **Step 8: Record the final demo**

Capture a 60–90 second run showing Landing, Phantom-owned Identity, upload payment/sponsorship, Shelby success URL, The Vault, Latency, and Metadata. Exclude wallet balances beyond the requested payment, extension settings, browser profile data, environment values, and server logs containing identifiers not intended for publication.

- [ ] **Step 9: Final verification and handoff**

Run fresh:

```powershell
npm run check
git diff --check
git status --short
git log -8 --oneline
```

Review the diff for secrets, unplanned Shelby integration changes, debug logs, stale mock copy, and accidental reference assets. Report exact test counts, build result, production URLs/status codes, live upload evidence, recording path/status, the preserved user `.gitignore` change, and any external network uncertainty.
