# Quote Clock and Custom Duration Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore valid retention quotes and readable custom-duration values so the Production upload journey can continue.

**Architecture:** Keep the existing signed quote schema and client integrity check. Reconstruct the Shelby retention clock when serializing a public quote, and use a type-qualified Vessel input selector to outrank Tailwind Forms without `!important`.

**Tech Stack:** Node.js ESM, Node test runner, static HTML/CSS, Tailwind CDN Forms plugin, Vercel, Chrome wallet extensions.

## Global Constraints

- Preserve all unrelated dirty working-tree changes.
- Keep the client expiration equality check and signed settlement payload unchanged.
- Custom input text must meet WCAG AA contrast of at least 4.5:1.
- Do not use `!important`.

---

### Task 1: Quote retention clock regression

**Files:**
- Modify: `app/server/src/lib/quotes.js`
- Test: `app/server/test/quotes.test.js`

**Interfaces:**
- Consumes: `context.expirationMicros: number`, `context.days: number`
- Produces: `publicQuote(...).serverTimeMs: number`

- [ ] **Step 1: Run the focused regression test**

Run: `node --test --test-name-pattern="retention clock" test/quotes.test.js` from `app/server`.

Expected: PASS for the existing regression proving `issuedAtMs === 99_999` and `serverTimeMs === 1_000`.

- [ ] **Step 2: Verify the minimal implementation**

The public quote must calculate:

```js
const RETENTION_DAY_MS = 86_400_000;
serverTimeMs: Math.trunc(context.expirationMicros / 1_000) - context.days * RETENTION_DAY_MS,
```

- [ ] **Step 3: Run all quote tests**

Run: `node --test test/quotes.test.js` from `app/server`.

Expected: all quote tests PASS.

### Task 2: Dark custom-duration input regression

**Files:**
- Modify: `app/server/test/accessibility.test.js`
- Modify: `app/server/public/vessel.css`

**Interfaces:**
- Consumes: `<input class="vessel-input" type="number">` and Tailwind Forms `[type="number"]`
- Produces: a higher-specificity `input.vessel-input` dark-surface foreground/background rule

- [ ] **Step 1: Write the failing CSS regression test**

Add to the shared CSS accessibility test:

```js
assert.match(css, /input\.vessel-input[^\{]*\{[^}]*background:\s*rgba\(12,\s*14,\s*19,\s*0\.7\)[^}]*color:\s*#e2e2e9/s);
assert.doesNotMatch(css, /\.vessel-input[^}]*!important/s);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="shared CSS" test/accessibility.test.js` from `app/server`.

Expected: FAIL because the stylesheet only has `.vessel-input` specificity.

- [ ] **Step 3: Add the minimal higher-specificity style**

Add after the base `.vessel-input` rule:

```css
input.vessel-input, textarea.vessel-input { background: rgba(12, 14, 19, 0.7); color: #e2e2e9; }
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test --test-name-pattern="shared CSS" test/accessibility.test.js` from `app/server`.

Expected: PASS.

### Task 3: Release and Production Chrome verification

**Files:**
- Verify only: `app/server/package.json`
- Deploy only the four implementation/test files plus the approved spec and this plan.

**Interfaces:**
- Consumes: Vercel Production alias `https://vessel-sage.vercel.app`
- Produces: a valid signed quote and readable 1–365 day custom-duration input in Production

- [ ] **Step 1: Run the complete server check**

Run: `npm run check` from `app/server`.

Expected: every Node test passes and client bundles build successfully.

- [ ] **Step 2: Review and stage only scoped files**

Run: `git diff --check` and inspect `git diff` for the quote, test, CSS, spec, and plan files. Do not stage unrelated dirty files.

- [ ] **Step 3: Commit, push, and deploy Production**

Commit the scoped files, push `main`, and deploy with the repository's established Vercel Production workflow.

- [ ] **Step 4: Verify in the user's Chrome session**

Reload Production, select the existing non-sensitive test artifact, verify Custom `1` and `365` remain legible on the dark surface, obtain valid 7/30/90/custom quotes, and continue through wallet approval, settlement receipt, upload, Gallery, delete dialog, and latency where external wallet/protocol state permits.
