# Vessel Landing Page and README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the undersized demo landing page and contradictory root README with an accurate, product-first presentation of Vessel's current wallet, storage, metadata, contract-settlement, and beta capabilities.

**Architecture:** Keep the existing static HTML, shared Tailwind runtime, and `vessel.css` design system. Expand only the landing document and focused landing styles, then make the root README the current operational entry point. Lock the public claims with source-reading Node tests so future implementation changes cannot silently reintroduce unsupported marketing.

**Tech Stack:** Semantic HTML5, Tailwind utility classes, shared CSS, Node.js built-in test runner, Express/Vercel deployment, Markdown.

## Global Constraints

- Preserve the approved dark ethereal Stitch visual language, fonts, crystal hero art, shared tokens, and Material Symbols.
- Landing positioning is product-first and proof-backed for NFT users first and technical reviewers second.
- Do not show the temporary Shelby API pause on the landing page.
- Document the Shelby API pause and browser-local Vault degraded mode in the README.
- Do not claim permanent storage, encryption, immutable blobs, mainnet durability, guaranteed availability, production SLAs, or fabricated usage and performance metrics.
- Keep `Powered by Shelby · Live on Aptos Testnet` on every page.
- Keep all interactive targets at least 44px, preserve focus rings and reduced-motion behavior, and prevent horizontal overflow at 375px.
- Do not change wallet, upload, payment, storage, metadata, or settlement behavior.
- Preserve unrelated worktree changes in `.gitignore`, `app/server/.gitignore`, `app/server/src/index.js`, `app/server/src/storage/mock.js`, `app/server/src/storage/shelby.js`, and `stitch_guideline_compliance_design (1)/`.

---

## File Structure

- Modify `app/server/public/index.html`: current product narrative and section structure.
- Modify `app/server/public/vessel.css`: focused landing metrics, workflow, feature, architecture, trust, CTA, and responsive styles.
- Modify `app/server/test/theme-and-landing.test.js`: CTA routing and the approved public-claim contract.
- Create `app/server/test/readme-current.test.js`: executable contract for README status, architecture, commands, links, and unsupported historical claims.
- Replace `README.md`: authoritative current repository and operator guide.

### Task 1: Lock the Landing Content Contract

**Files:**
- Modify: `app/server/test/theme-and-landing.test.js`

**Interfaces:**
- Consumes: `readPage('index.html')`, `getLinks(html)`, and existing shared HTML test helpers.
- Produces: source-level acceptance tests for the new information architecture and claim boundaries.

- [ ] **Step 1: Replace the old two-CTA and three-proof expectations with failing product-scale tests**

Use these assertions:

```js
test('Landing CTAs route users into the app and the workflow explanation', () => {
  const html = readPage('index.html');
  const appEntries = getLinks(html).filter((link) => /data-dapp-entry/.test(link.attrs));
  assert.equal(appEntries.length, 3);
  assert.deepEqual(appEntries.map((link) => link.href), [
    '/identity.html', '/identity.html', '/identity.html',
  ]);
  assert.match(html, /href="#how-it-works"[^>]*>[^<]*(?:<[^>]+>[^<]*)*EXPLORE HOW IT WORKS/i);
  assert.doesNotMatch(html, /data-wallet-summary|connect wallet to start/i);
});

test('Landing presents the implemented platform scale and workflow', () => {
  const html = readPage('index.html');
  assert.match(html, /Wallet-owned hot storage for NFT media/i);
  assert.match(html, />\s*2\s*<[^>]*>[\s\S]*Wallet ecosystems/i);
  assert.match(html, />\s*2\s*<[^>]*>[\s\S]*Settlement contracts/i);
  assert.match(html, />\s*1\s*<[^>]*>[\s\S]*Canonical NFT schema/i);
  assert.match(html, /id="how-it-works"/);
  for (const label of ['Connect', 'Store', 'Publish']) {
    assert.match(html, new RegExp(`>\\s*${label}\\s*<`, 'i'));
  }
});

test('Landing names current storage, metadata, and proof capabilities', () => {
  const html = readPage('index.html');
  for (const claim of [
    'Wallet-native identity',
    'Single and batch upload',
    'Wallet-scoped Vault',
    'NFT metadata',
    'Collection JSON export',
    'Latency proof',
    'Flexible retention',
    'Contract receipts',
  ]) {
    assert.match(html, new RegExp(claim, 'i'));
  }
});

test('Landing explains both chain paths and honest beta safeguards', () => {
  const html = readPage('index.html');
  assert.match(html, /Aptos native/i);
  assert.match(html, /Solana DAA/i);
  assert.match(html, /Ed25519-signed quotes/i);
  assert.match(html, /Aptos Multisig Account/i);
  assert.match(html, /Squads/i);
  assert.match(html, /testnet beta/i);
  assert.doesNotMatch(html, /API is paused|public API is not available/i);
  assert.doesNotMatch(html, /permanent storage|production SLA|guaranteed availability|encrypted|immutable blobs/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
cd app/server
node --test test/theme-and-landing.test.js
```

Expected: FAIL because the landing still has two dApp entry links and lacks platform-scale, workflow, feature, architecture, settlement, and beta sections.

- [ ] **Step 3: Commit only after Task 2 turns these tests green**

Do not commit a red test independently. Task 1 and Task 2 form one TDD delivery and share the Task 2 commit.

### Task 2: Implement the Product-Scale Landing Page

**Files:**
- Modify: `app/server/public/index.html`
- Modify: `app/server/public/vessel.css`
- Modify: `app/server/test/theme-and-landing.test.js`

**Interfaces:**
- Consumes: shared `vessel-page`, `vessel-glass`, `vessel-button`, `vessel-kicker`, font, color, navigation, and accessibility rules.
- Produces: anchors `#how-it-works`, `#capabilities`, `#architecture`, and `#trust`; three `data-dapp-entry` Identity links; one secondary workflow link.

- [ ] **Step 1: Replace the landing meta description and hero copy**

Use:

```html
<meta name="description" content="Wallet-owned hot storage, batch media workflows, and canonical NFT metadata for Aptos and Solana, powered by Shelby.">
<title>VESSEL | Wallet-Owned Hot Storage for NFT Media</title>
```

The hero content must be:

```html
<p class="vessel-kicker text-primary-container">Wallet-native · Cross-chain · Powered by Shelby</p>
<h1 class="mt-6 font-display text-5xl font-bold leading-[1.03] tracking-[-0.045em] text-on-surface sm:text-6xl md:text-8xl">Wallet-owned hot storage for NFT media</h1>
<p class="mx-auto mt-7 max-w-3xl text-base leading-7 text-on-surface-variant sm:text-lg md:text-xl">Connect Aptos or Solana, store individual assets or complete collections, and prepare canonical NFT metadata from one wallet-native workspace.</p>
<div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
  <a class="vessel-button vessel-button-primary px-7 py-4 sm:px-9" data-dapp-entry href="/identity.html"><span class="material-symbols-outlined text-xl" aria-hidden="true">rocket_launch</span>LAUNCH APP</a>
  <a class="vessel-button vessel-button-secondary px-7 py-4 sm:px-9" href="#how-it-works"><span class="material-symbols-outlined text-xl" aria-hidden="true">south</span>EXPLORE HOW IT WORKS</a>
</div>
```

- [ ] **Step 2: Add platform-scale facts and the three-step workflow**

Immediately after the hero, add a metric strip with exact facts:

```html
<section class="vessel-page vessel-landing-metrics relative z-10" aria-label="Platform scale">
  <div><strong>2</strong><span>Wallet ecosystems</span><small>Aptos + Solana</small></div>
  <div><strong>2</strong><span>Settlement contracts</span><small>Move + Solana Program</small></div>
  <div><strong>1</strong><span>Canonical NFT schema</span><small>Single + collection</small></div>
</section>
```

Add `#how-it-works` with three semantic articles and these exact messages:

```html
<h2>One wallet. Three steps. Collection-ready.</h2>
<article><span>01</span><h3>Connect</h3><p>Use an Aptos wallet directly, or let your Solana wallet authorize a deterministic Aptos storage identity through DAA.</p></article>
<article><span>02</span><h3>Store</h3><p>Upload one asset or a complete folder, choose 1 to 365 days of retention, and review the quote before signing.</p></article>
<article><span>03</span><h3>Publish</h3><p>Copy media URLs, generate canonical NFT JSON, or export collection metadata as a ready-to-use ZIP.</p></article>
```

- [ ] **Step 3: Add the capability bento grid**

Create `#capabilities` with eight cards. Each card uses one existing Material Symbol, one exact heading from the test, and a single factual sentence:

```html
<h3>Wallet-native identity</h3>
<h3>Single and batch upload</h3>
<h3>Wallet-scoped Vault</h3>
<h3>NFT metadata</h3>
<h3>Collection JSON export</h3>
<h3>Latency proof</h3>
<h3>Flexible retention</h3>
<h3>Contract receipts</h3>
```

Use `fingerprint`, `drive_folder_upload`, `deployed_code`, `data_object`, `folder_zip`, `speed`, `calendar_month`, and `receipt_long` respectively. Copy must say that collection JSON reuses existing Shelby media URLs and that hosting depends on Shelby write availability.

- [ ] **Step 4: Add cross-chain architecture and trust sections**

Create `#architecture` with two cards:

```html
<article>
  <p>PATH 01</p><h3>Aptos native</h3>
  <p>Your connected Aptos account is the storage identity and settlement sender.</p>
</article>
<article>
  <p>PATH 02</p><h3>Solana DAA</h3>
  <p>Your Solana wallet authorizes a deterministic Aptos storage identity while Vessel service settlement runs through the Solana Program.</p>
</article>
```

Create `#trust` with four proof rows:

```html
<li><strong>Ed25519-signed quotes</strong><span>Wallet, file, retention, price, and expiry are locked before approval.</span></li>
<li><strong>Contract-issued receipts</strong><span>Aptos Move or the Solana Program authorizes the Vessel service flow.</span></li>
<li><strong>Multisig-controlled vaults</strong><span>An Aptos Multisig Account and Squads govern the two service-fee vaults.</span></li>
<li><strong>Separated protocol costs</strong><span>Shelby storage charges and network gas remain distinct from the Vessel service fee.</span></li>
```

- [ ] **Step 5: Add beta transparency, final CTA, and current footer copy**

Use:

```html
<section class="vessel-page vessel-landing-beta vessel-glass rounded-vessel">
  <p class="vessel-kicker text-tertiary-container">TESTNET BETA</p>
  <h2>Built to prove the full wallet-owned storage flow.</h2>
  <p>Vessel currently runs on public test networks. Retention is temporary, testnet assets have no real monetary value, and this beta does not promise permanent storage or production availability.</p>
</section>
<section class="vessel-page vessel-landing-cta text-center">
  <p class="vessel-kicker text-primary-container">FROM WALLET TO TOKEN URI</p>
  <h2>Prepare your next NFT media workflow.</h2>
  <a class="vessel-button vessel-button-primary mt-8 px-8 py-4" data-dapp-entry href="/identity.html">LAUNCH APP</a>
</section>
```

Change the footer technical label to `Wallet-owned storage · Cross-chain settlement · Testnet beta`.

- [ ] **Step 6: Add focused shared CSS**

Append these rules before the media queries and extend the mobile query as shown:

```css
.vessel-landing-section { padding-block: clamp(5rem, 9vw, 8rem); }
.vessel-landing-heading { max-width: 52rem; font: 700 clamp(2.3rem, 5vw, 4.75rem)/1.04 Space Grotesk, sans-serif; letter-spacing: -0.045em; }
.vessel-landing-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: hidden; border: 1px solid rgba(255,255,255,.09); border-radius: 2rem; background: rgba(12,14,19,.72); }
.vessel-landing-metrics div { display: grid; gap: .45rem; min-width: 0; padding: 2rem; }
.vessel-landing-metrics div + div { border-left: 1px solid rgba(255,255,255,.08); }
.vessel-landing-metrics strong { color: #b5fff0; font: 700 clamp(2.75rem,6vw,5rem)/1 Space Grotesk,sans-serif; }
.vessel-landing-metrics span { color: #e2e2e9; font-weight: 650; }
.vessel-landing-metrics small { color: #9eaba8; font: 500 11px/1.5 JetBrains Mono,monospace; text-transform: uppercase; }
.vessel-landing-grid { display: grid; grid-template-columns: repeat(12,minmax(0,1fr)); gap: 1rem; }
.vessel-landing-card { grid-column: span 3; min-height: 15rem; padding: 1.75rem; }
.vessel-landing-card-wide { grid-column: span 6; }
.vessel-landing-step { position: relative; min-height: 19rem; overflow: hidden; }
.vessel-landing-step-number { color: rgba(94,230,255,.2); font: 700 4rem/1 Space Grotesk,sans-serif; }
.vessel-architecture-card { border-top: 1px solid rgba(94,234,212,.2); }
.vessel-trust-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.vessel-trust-list li { display: grid; grid-template-columns: minmax(12rem,.7fr) 1fr; gap: 2rem; padding: 1.4rem 0; border-top: 1px solid rgba(255,255,255,.08); }
.vessel-landing-beta { padding: clamp(2rem,5vw,4rem); }
.vessel-landing-cta { padding-block: clamp(6rem,11vw,10rem); }
```

Inside `@media (max-width: 767px)` add:

```css
.vessel-landing-metrics { grid-template-columns: 1fr; }
.vessel-landing-metrics div + div { border-top: 1px solid rgba(255,255,255,.08); border-left: 0; }
.vessel-landing-card, .vessel-landing-card-wide { grid-column: 1 / -1; min-height: auto; }
.vessel-trust-list li { grid-template-columns: 1fr; gap: .5rem; }
```

At `768px` to `1099px`, make cards span six columns. Avoid new animations and reuse existing focus/reduced-motion rules.

- [ ] **Step 7: Run focused landing and accessibility tests and verify GREEN**

Run:

```powershell
cd app/server
node --test test/theme-and-landing.test.js test/accessibility.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 8: Review the rendered source contract and commit**

Run:

```powershell
git diff --check
git diff -- app/server/public/index.html app/server/public/vessel.css app/server/test/theme-and-landing.test.js
git add app/server/public/index.html app/server/public/vessel.css app/server/test/theme-and-landing.test.js
git commit -m "feat(landing): present the complete Vessel platform"
```

Expected: only the three landing files are committed.

### Task 3: Replace the Historical README with the Current Operator Guide

**Files:**
- Create: `app/server/test/readme-current.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `deployments/vessel-settlement.testnet.json`, `app/server/.env.example`, package scripts, current production URL, and contract READMEs.
- Produces: one authoritative human-readable entry point whose required facts are protected by a Node source test.

- [ ] **Step 1: Write a failing README currency test**

Create:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readme = fs.readFileSync(path.resolve(here, '../../..', 'README.md'), 'utf8');

test('README describes the deployed product and current degraded mode', () => {
  for (const claim of [
    'https://vessel-sage.vercel.app',
    'Shelby public API is temporarily paused',
    'browser-local Vault history',
    'Aptos Move contract',
    'Solana Program',
    'canonical NFT metadata',
    'batch collection',
  ]) assert.match(readme, new RegExp(claim, 'i'));
});

test('README exposes current testnet deployments and verification commands', () => {
  assert.match(readme, /0x9885a9a0e382335d0f801301d43b451facaa6e768d31e5c9903b2a0dd9efef15/i);
  assert.match(readme, /G2dA3Sz1XxvJ4ppkvwb95kfy5w6M9ip2KiZBmt7xbsBx/);
  assert.match(readme, /npm test/);
  assert.match(readme, /npm run build:client/);
  assert.match(readme, /Root Directory.*app\/server/i);
});

test('README no longer presents historical flows as release truth', () => {
  assert.doesNotMatch(readme, /working build.*Cách B|older sponsored-USDC walkthrough/i);
  assert.doesNotMatch(readme, /Ethereum DAA byte-upload is not yet possible upstream/i);
  assert.doesNotMatch(readme, /Gallery currently lists the server account/i);
});
```

- [ ] **Step 2: Run the README test and verify RED**

Run:

```powershell
cd app/server
node --test test/readme-current.test.js
```

Expected: FAIL because the current root README contains the historical sponsored flow and does not describe the API pause or browser-local Vault mode.

- [ ] **Step 3: Replace `README.md` with the authoritative current guide**

Use these exact top-level sections:

```markdown
# Vessel
## Live beta
## What Vessel does
## Current network status
## User journeys
## Architecture
## Settlement contracts
## NFT metadata and batch collections
## Repository map
## Local development
## Environment configuration
## Test and build
## Deploy to Vercel
## Security model
## Beta limitations
## Project documentation
```

Required facts:

- Live app: `https://vessel-sage.vercel.app`.
- Shelby public API is temporarily paused; upload and hosting are gated off, while local metadata generation and ZIP export use unexpired browser-local Vault history.
- Aptos wallets are native storage identities; Solana wallets authorize deterministic Aptos DAA identities.
- Settlement uses the Aptos Move contract and Solana Program, signed quotes, contract receipts, an Aptos Multisig Account, and Squads.
- Aptos module/multisig: `0x9885a9a0e382335d0f801301d43b451facaa6e768d31e5c9903b2a0dd9efef15`.
- Solana Program: `G2dA3Sz1XxvJ4ppkvwb95kfy5w6M9ip2KiZBmt7xbsBx`.
- Solana Squads multisig: `GuoEcd5vAUctrhNbiS8WygVBMFL85kR4GN6yJFuK6zRh`.
- Retention is 1 to 365 days; price quote combines network/protocol cost, sponsored gas, 2% service fee, and a USD 0.01 minimum.
- Single metadata and collection exports use one canonical cross-chain NFT schema.
- Batch collection JSON reuses previously uploaded Shelby URLs; it does not hash or re-upload source images.
- Vercel Root Directory is `app/server`; secrets stay in Vercel environment variables.
- `knowledge/` is historical planning context where it conflicts with current code or the deployment manifest.

The README must never print private keys, API keys, quote signer secrets, gas-station secrets, or wallet seed material.

- [ ] **Step 4: Run the focused README test and verify GREEN**

Run:

```powershell
cd app/server
node --test test/readme-current.test.js
```

Expected: all README tests PASS.

- [ ] **Step 5: Review and commit the README delivery**

Run:

```powershell
git diff --check
git diff -- README.md app/server/test/readme-current.test.js
git add README.md app/server/test/readme-current.test.js
git commit -m "docs: document the current Vessel beta"
```

Expected: only the README and its currency test are committed.

### Task 4: Verify, Publish, and Exercise the Landing in Chrome

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: all landing, README, metadata, wallet, contract, and storage tests plus the existing Vercel Git integration.
- Produces: fresh automated evidence, production deployment evidence, and desktop/mobile browser evidence.

- [ ] **Step 1: Run the complete automated verification**

Run:

```powershell
cd app/server
npm test
npm run build:client
node --check public/app.js
git diff --check
```

Expected: zero failed tests, bundle build exit code 0, syntax exit code 0, and no whitespace errors.

- [ ] **Step 2: Scan only the delivery scope for accidental secrets**

Scan `README.md`, `app/server/public/index.html`, `app/server/public/vessel.css`, and new/modified tests for private-key headers and common token prefixes. Expected: no matches. Do not print environment variable values.

- [ ] **Step 3: Push the current `main` branch**

Run:

```powershell
git push origin main
```

Expected: the new landing, README, paused Vault commit, and their design/plan commits are accepted by `origin/main`.

- [ ] **Step 4: Verify Vercel production readiness**

Run from the repository root:

```powershell
npx vercel inspect https://vessel-sage.vercel.app
```

Expected: target `production`, status `Ready`, and alias `https://vessel-sage.vercel.app`. If Git deployment has not updated yet, wait in intervals shorter than 60 seconds and inspect again. Do not run Vercel from `app/server`, because the project already has `app/server` configured as its Root Directory.

- [ ] **Step 5: Verify production HTTP content**

Request `/` and `/api/config`. Confirm:

- `/` returns HTTP 200.
- The HTML contains `Wallet-owned hot storage for NFT media`, `#how-it-works`, `Aptos native`, `Solana DAA`, and `testnet beta`.
- The HTML does not contain `API is paused`.
- `/api/config` continues to report Shelby writes disabled during the upstream pause.

- [ ] **Step 6: Exercise the production page in the user's Chrome session**

Using fresh DOM snapshots before each interaction:

1. Open or reload `https://vessel-sage.vercel.app/`.
2. Confirm the top attribution, navigation, hero, both hero CTAs, metrics, workflow, capabilities, architecture, trust, beta, final CTA, and footer are visible and readable.
3. Click `EXPLORE HOW IT WORKS`; confirm the workflow section is targeted.
4. Confirm each `LAUNCH APP` route points to `/identity.html`; navigate using one and verify the dApp opens.
5. Return to the landing page and inspect at desktop width.
6. Inspect at a 375px-wide mobile viewport and confirm no horizontal overflow, clipped metrics, or illegible technical values.
7. Review browser console errors. Ignore only known extension noise that can be attributed to a wallet extension; investigate application errors.
8. Keep the production landing tab open as the deliverable and finalize browser activity.

- [ ] **Step 7: Update the tracked plan and report evidence**

Mark all tasks completed only after automated, deployment, HTTP, and Chrome checks pass. Report the exact test count, production deployment state, browser findings, and the known Shelby API limitation.
