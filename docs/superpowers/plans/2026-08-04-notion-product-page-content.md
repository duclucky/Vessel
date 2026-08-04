# Vessel Notion Product Page Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce complete English copy and a copy-paste master prompt that makes Notion AI replace the current Vessel page with a polished, submission-ready product overview.

**Architecture:** Store the canonical page copy and the Notion AI instruction as separate Markdown artifacts under `docs/notion/`. Protect exact URLs, deployment addresses, required claims, prohibited claims, and punctuation rules with one Node source test. The master prompt contains the approved copy and formatting instructions so Notion does not invent product facts.

**Tech Stack:** Markdown, Notion page blocks, Node.js built-in test runner.

## Global Constraints

- Write the page and master prompt in English.
- Use a product-story structure backed by technical proof.
- Address NFT creators and application developers first, then technical reviewers.
- Rewrite the current Notion page in place instead of appending a second version.
- Do not use an em dash character.
- Do not mention temporary upstream API availability.
- Do not claim permanent storage, managed encryption, mainnet durability, a production SLA, guaranteed availability, NFT minting, marketplace listing, fabricated adoption, fabricated capacity, fabricated partners, or fabricated performance.
- Label Vessel as a public testnet beta and state that testnet assets have no real monetary value.
- Preserve exact production URLs and public deployment addresses from the approved spec.
- Preserve unrelated user worktree changes.

---

## File Structure

- Create `docs/notion/vessel-product-page.md`: canonical page copy with all fourteen approved sections.
- Create `docs/notion/vessel-notion-master-prompt.md`: complete instructions and embedded copy for Notion AI.
- Create `app/server/test/notion-product-page.test.js`: factual, structural, punctuation, and claim-boundary checks.

### Task 1: Lock the Notion Content Contract

**Files:**
- Create: `app/server/test/notion-product-page.test.js`

**Interfaces:**
- Consumes: the two Markdown artifacts under `docs/notion/`.
- Produces: executable acceptance criteria for the final copy and master prompt.

- [ ] **Step 1: Write the failing source test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const page = read('docs/notion/vessel-product-page.md');
const prompt = read('docs/notion/vessel-notion-master-prompt.md');
const combined = `${page}\n${prompt}`;

test('Notion page follows the approved product-story structure', () => {
  for (const heading of [
    'Wallet-Owned Hot Storage for NFT Media',
    'The NFT Media Problem',
    'Connect. Store. Publish.',
    'What Vessel Includes Today',
    'Two Wallet Paths. One Storage Layer.',
    'Settlement Belongs in Contracts',
    'Canonical NFT Metadata',
    'Collection Workflows Without Repetitive File Picking',
    'Public Testnet Deployments',
    'Security by Boundary',
    'Built as an Honest Testnet Beta',
    'Roadmap',
    'Explore Vessel',
  ]) assert.match(page, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('Notion artifacts preserve required evidence', () => {
  for (const fact of [
    'https://vessel-sage.vercel.app',
    'https://github.com/duclucky/Vessel',
    'https://vessel-sage.vercel.app/api/media/33bf09e7e9cd8e2e72f55db22bd1f10c7ff3f92ccb3057b6507fa99d4e7324aa.json',
    '0x9885a9a0e382335d0f801301d43b451facaa6e768d31e5c9903b2a0dd9efef15',
    '0x2025257c90ced758ea49e1492d60a903dbc8c4d5915657611f968b7a27cf3f8a',
    'G2dA3Sz1XxvJ4ppkvwb95kfy5w6M9ip2KiZBmt7xbsBx',
    'Ac7fiHCWCnWFkPUE6uwFkPUN7Pv8y7',
    'GuoEcd5vAUctrhNbiS8WygVBMFL85kR4GN6yJFuK6zRh',
  ]) assert.match(combined, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Notion copy includes current workflows and constraints', () => {
  for (const claim of [
    'Aptos native', 'Solana DAA', 'single upload', 'batch upload',
    'wallet-scoped Vault', 'collection metadata ZIP', '1 to 365 days',
    '2% Vessel service fee', 'USD 0.01 minimum', 'Ed25519',
    'Aptos Multisig Account', 'Squads', 'does not mint NFTs',
  ]) assert.match(page, new RegExp(claim, 'i'));
});

test('Notion artifacts avoid prohibited claims and punctuation', () => {
  assert.equal(combined.includes(String.fromCharCode(0x2014)), false);
  assert.doesNotMatch(page, /API is paused|public API is not available/i);
  assert.doesNotMatch(page, /permanent storage|managed encryption|production SLA|guaranteed availability/i);
  assert.doesNotMatch(page, /thousands of users|millions of files|industry-leading/i);
});

test('Master prompt replaces the page and controls Notion formatting', () => {
  assert.match(prompt, /replace the entire current page/i);
  assert.match(prompt, /do not append/i);
  assert.match(prompt, /callout/i);
  assert.match(prompt, /two-column/i);
  assert.match(prompt, /code block/i);
  assert.match(prompt, /verification checklist/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
Set-Location app/server
node --test test/notion-product-page.test.js
```

Expected: FAIL with `ENOENT` because the two Notion Markdown artifacts do not exist.

### Task 2: Write the Canonical Notion Page Copy

**Files:**
- Create: `docs/notion/vessel-product-page.md`
- Test: `app/server/test/notion-product-page.test.js`

**Interfaces:**
- Consumes: approved product facts and public deployment identifiers.
- Produces: complete copy that the master prompt embeds verbatim.

- [ ] **Step 1: Create the hero and summary**

Use this exact opening:

```markdown
# VESSEL

## Wallet-Owned Hot Storage for NFT Media

**Connect Aptos or Solana, store individual assets or complete collections, and prepare canonical NFT metadata from one wallet-native workspace powered by Shelby.**

[Launch Vessel](https://vessel-sage.vercel.app) | [View Source](https://github.com/duclucky/Vessel) | [Open Metadata Example](https://vessel-sage.vercel.app/api/media/33bf09e7e9cd8e2e72f55db22bd1f10c7ff3f92ccb3057b6507fa99d4e7324aa.json)

> Vessel is a public testnet beta that connects wallet identity, hot media storage, NFT metadata, cross-chain settlement, and verifiable contract receipts. Testnet assets have no real monetary value.

### In one sentence

Vessel lets an Aptos or Solana wallet control a Shelby storage identity, prepare media and collection workflows, generate NFT-ready JSON, and prove Vessel service settlement through a chain-specific contract.
```

- [ ] **Step 2: Add the problem and three-step workflow**

Use these headings and facts:

```markdown
## The NFT Media Problem

NFT media needs to be fast enough for real applications, decentralized enough to avoid a single hosting operator, and controlled by the wallet a user already owns. Existing workflows often force creators to trade away one of those properties or manage another account, bridge, or seed phrase.

Vessel combines Shelby hot storage with wallet-native identity and one canonical metadata workflow. The user keeps the familiar wallet while the application coordinates storage, metadata, and service settlement.

## Connect. Store. Publish.

### 01. Connect
Use an Aptos wallet directly, or let a Solana wallet authorize a deterministic Aptos storage identity through Derived Account Abstraction.

### 02. Store
Prepare one file or a collection folder, choose retention from 1 to 365 days, review the quote, and approve the chain-specific transaction.

### 03. Publish
Copy Shelby media URLs, generate canonical NFT JSON, or export collection metadata as a deterministic ZIP for downstream minting tools and marketplaces.
```

- [ ] **Step 3: Add capabilities and architecture**

The capabilities table must contain these rows:

```markdown
| Capability | What the user gets |
|---|---|
| Wallet-native identity | Aptos native ownership or a deterministic Aptos storage identity controlled through Solana DAA |
| Single upload | File validation, retention selection, itemized quote, wallet approval, and a wallet-owned media URL |
| Batch upload | One folder selection, preserved relative paths, per-file progress, and collection-aware Vault records |
| Wallet-scoped Vault | Active artifact history for the connected storage address, with copy, preview, and removal actions |
| Canonical NFT metadata | One cross-chain schema for names, descriptions, media, traits, collection fields, and file properties |
| Collection JSON export | Existing Shelby media URLs converted into deterministic item JSON and a collection metadata ZIP |
| Latency proof | Real Shelby and optional IPFS measurements, with unavailable results shown honestly |
| Flexible retention | Presets plus any custom duration from 1 to 365 days |
| Contract receipts | Single-use settlement evidence from Aptos Move or the Solana Program |
```

Architecture copy must explain Aptos native and Solana DAA as two parallel paths that converge on Shelby storage and the same metadata model.

- [ ] **Step 4: Add settlement, metadata, and batch workflow sections**

Required settlement facts:

- A shared Ed25519 public-key model signs `QuoteV1` for both chains.
- Wallet, file, retention, price, expiry, and chain are locked before approval.
- Aptos Move and the Solana Program issue the service receipt.
- An Aptos Multisig Account and Squads govern separate service-fee vaults.
- Shelby protocol charges and validator gas remain separate from Vessel service fees.
- Quotes combine network and protocol cost, sponsored gas, a 2% Vessel service fee, and a USD 0.01 minimum.

The metadata code block must be:

```json
{
  "name": "Vessel Artifact #1",
  "description": "Wallet-owned NFT media prepared with Vessel.",
  "image": "https://vessel-sage.vercel.app/api/shelby/blobs/0x.../media/artifact.png",
  "external_url": "https://vessel-sage.vercel.app",
  "attributes": [
    { "trait_type": "Storage", "value": "Shelby" },
    { "trait_type": "Identity", "value": "Wallet-owned" }
  ],
  "properties": {
    "files": [
      { "uri": "https://vessel-sage.vercel.app/api/shelby/blobs/0x.../media/artifact.png", "type": "image/png" }
    ]
  }
}
```

The batch section must state that users select a collection already recorded in the wallet-scoped Vault. They do not select the same local source folder again. Vessel preserves source paths, reuses existing Shelby URLs, optionally applies CSV overrides, validates every item, and exports a deterministic ZIP. Batch metadata is not a minting engine.

- [ ] **Step 5: Add deployments, security, beta scope, roadmap, and resources**

Use a compact deployment table with all five addresses from the spec. Security must separate browser wallet authority, server-only credentials, public contract receipts, and multisig governance.

Roadmap items must be limited to:

1. Restore fully remote Vault reconciliation when upstream public services are available.
2. Add batch metadata hosting as one reviewed transaction plan.
3. Expand collection validation and CSV mapping ergonomics.
4. Prepare mainnet governance hardening and permanent upgrade lock procedures.
5. Increase beta batch capacity beyond the current 1 GB target after reliability testing.

End with links to the live app, GitHub repository, metadata example, and Shelby documentation. State: `Vessel prepares NFT media and metadata URLs. It does not mint NFTs.`

### Task 3: Write the Notion AI Master Prompt

**Files:**
- Create: `docs/notion/vessel-notion-master-prompt.md`
- Test: `app/server/test/notion-product-page.test.js`

**Interfaces:**
- Consumes: the complete canonical copy from Task 2.
- Produces: one paste-ready instruction that rewrites and formats the existing Notion page.

- [ ] **Step 1: Write the instruction header**

Start with:

```markdown
You are editing the existing public Notion product page for Vessel. Replace the entire current page with the approved content below. Do not append a second version and do not preserve stale product copy.

Your goal is to create a polished, public-facing product page for NFT creators, application developers, and technical reviewers. Lead with the user outcome, then provide technical proof.
```

- [ ] **Step 2: Specify the layout system**

Require:

- Full-width page layout.
- Product icon or cover only if an existing Vessel asset is already available.
- A hero heading, bold value proposition, three CTA links, and a teal callout.
- Numbered three-step workflow in three columns when the viewport supports it.
- Capabilities as a compact table.
- Aptos native and Solana DAA as a two-column comparison.
- Settlement and security facts as callouts and compact bullet lists.
- Contract identifiers in a table with code formatting.
- Canonical metadata in a JSON code block.
- Detailed technical material inside toggles only when it is secondary to the main narrative.
- Dividers between major sections.
- No decorative emoji inside technical tables or headings.

- [ ] **Step 3: Embed the complete canonical copy**

Paste the entire contents of `docs/notion/vessel-product-page.md` under the marker:

```markdown
BEGIN APPROVED PAGE COPY

The implementation must reproduce every line from `docs/notion/vessel-product-page.md` here, beginning with `# VESSEL` and ending with the final sentence in `## Explore Vessel`.

END APPROVED PAGE COPY
```

The sentence describing the reproduction operation is an implementation instruction and must not appear in the final master prompt. The final master prompt contains the actual page copy between the markers.

- [ ] **Step 4: Add factual and stylistic guardrails**

Require Notion AI to preserve all URLs and addresses exactly, avoid em dashes, avoid fabricated metrics, avoid unsupported durability or security claims, avoid describing Vessel as an NFT minting product, and label the product as a public testnet beta.

Instruct Notion AI not to add a live service-status section or invent current provider availability details.

- [ ] **Step 5: Add the verification checklist**

End the master prompt with:

```markdown
Before finishing, verify all of the following:

1. The old page content has been replaced rather than duplicated.
2. All three CTA links work and retain their exact URLs.
3. Aptos native and Solana DAA are both explained.
4. Single upload, batch upload, Vault, canonical NFT metadata, collection ZIP export, retention, latency proof, and contract receipts are present.
5. All public contract, vault, and multisig addresses are exact.
6. The page states that Vessel does not mint NFTs.
7. No fabricated adoption, capacity, partnership, or performance claim was added.
8. No permanent storage, managed encryption, mainnet durability, or production availability promise was added.
9. No em dash character appears anywhere.
10. The final page is easy to scan on desktop and mobile.
```

### Task 4: Verify and Deliver the Two Artifacts

**Files:**
- Verify: `docs/notion/vessel-product-page.md`
- Verify: `docs/notion/vessel-notion-master-prompt.md`
- Verify: `app/server/test/notion-product-page.test.js`

**Interfaces:**
- Consumes: both completed content artifacts.
- Produces: verified copy that the user can paste into Notion AI.

- [ ] **Step 1: Run the focused test and verify GREEN**

```powershell
Set-Location app/server
node --test test/notion-product-page.test.js
```

Expected: all five tests PASS.

- [ ] **Step 2: Run punctuation and placeholder scans**

```powershell
Set-Location ../..
$files = @('docs/notion/vessel-product-page.md', 'docs/notion/vessel-notion-master-prompt.md')
$text = ($files | ForEach-Object { Get-Content -Raw $_ }) -join "`n"
$unfinished = @('T' + 'BD', 'T' + 'ODO', 'The implementation must reproduce every line')
if ($text.Contains([char]0x2014) -or ($unfinished | Where-Object { $text.Contains($_) })) { exit 1 }
```

Expected: no matches.

- [ ] **Step 3: Run the full repository test suite**

```powershell
Set-Location app/server
npm test
```

Expected: zero failures.

- [ ] **Step 4: Commit only the Notion deliverables**

```powershell
Set-Location ../..
git add docs/notion/vessel-product-page.md docs/notion/vessel-notion-master-prompt.md app/server/test/notion-product-page.test.js
git commit -m "docs(notion): add submission-ready product page copy"
```

- [ ] **Step 5: Deliver copyable outputs**

Return both local file links. Include the master prompt in one fenced text block so the user can copy it without Markdown interpretation. Do not modify the live Notion page unless the user explicitly asks for browser editing after reviewing the prompt.
