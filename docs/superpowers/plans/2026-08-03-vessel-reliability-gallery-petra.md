# Vessel Reliability: Gallery Confirmation and Petra Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gallery's Chrome-owned confirmation with an accessible Vessel dialog and make Petra connect through the Wallet Standard API shape supported by the pinned dependencies.

**Architecture:** Add one DOM-focused confirmation module imported by the existing `public/app.js`. Keep Petra compatibility isolated in the Aptos adapter: connect first, normalize the session, then inspect/switch network and normalize provider errors.

**Tech Stack:** Vanilla ES modules, Aptos Wallet Standard 0.5.2, Aptos TS SDK 5.2.1, Node.js built-in test runner, existing Tailwind/Vessel CSS.

## Global Constraints

- Keep `@aptos-labs/wallet-standard@0.5.2` and `@aptos-labs/ts-sdk@5.2.1` pinned.
- Gallery removal deletes only the browser-local record; it must not call a Shelby delete endpoint.
- Aptos wallets remain native: `sourceAddress === storageAddress`.
- Aptos sessions are ready only on Aptos Testnet; failed switching retains the connected session as `network_required`.
- No native `confirm`, `alert`, or `prompt` may remain in the Gallery removal path.
- Preserve `app/server/.gitignore` and the untracked Stitch design directory.

---

### Task 1: Accessible Vessel confirmation dialog

**Files:**
- Create: `app/server/public/confirm-dialog.js`
- Modify: `app/server/public/app.js`
- Modify: `app/server/public/gallery.html`
- Modify: `app/server/public/vessel.css`
- Test: `app/server/test/confirm-dialog.test.js`
- Test: `app/server/test/ledger-and-gallery.test.js`

**Interfaces:**
- Consumes: `confirmAction(options, document = globalThis.document)` where `options` contains `opener`, `kicker`, `title`, `message`, `cancelLabel`, and `confirmLabel`.
- Produces: `Promise<boolean>`; `true` only for the destructive button, `false` for Cancel, Escape, or backdrop.

- [ ] **Step 1: Write the failing source-contract and Gallery wiring tests**

```js
// app/server/test/confirm-dialog.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.resolve(import.meta.dirname, '../public');
const read = (name) => fs.readFileSync(path.join(publicDir, name), 'utf8');

test('confirmation dialog exposes the accessible modal contract', () => {
  const source = read('confirm-dialog.js');
  assert.match(source, /export function confirmAction/);
  assert.match(source, /role', 'dialog'/);
  assert.match(source, /aria-modal', 'true'/);
  assert.match(source, /keydown/);
  assert.match(source, /Escape/);
  assert.match(source, /Shift/);
  assert.match(source, /opener\?\.focus/);
});

test('Gallery uses Vessel copy and never opens a browser confirmation', () => {
  const source = read('app.js');
  assert.match(source, /confirmAction\(\{/);
  assert.match(source, /GALLERY ACTION/);
  assert.match(source, /Remove artifact\?/);
  assert.match(source, /REMOVE FROM GALLERY/);
  assert.doesNotMatch(source, /\bconfirm\s*\(/);
});
```

Extend `ledger-and-gallery.test.js` with:

```js
test('Gallery removes local state only after awaited confirmation', () => {
  const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const confirmation = source.indexOf('await confirmAction({');
  const guard = source.indexOf('if (!confirmed) return;', confirmation);
  const removal = source.indexOf('forgetMine(b.dataset.key)', guard);
  assert.equal(confirmation >= 0 && guard > confirmation && removal > guard, true);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd app/server && node --test test/confirm-dialog.test.js test/ledger-and-gallery.test.js`

Expected: FAIL because `confirm-dialog.js` does not exist and Gallery still calls `confirm()`.

- [ ] **Step 3: Implement the dialog module**

Implement `confirmAction` with this exact lifecycle:

```js
export function confirmAction(options, document = globalThis.document) {
  const {
    opener,
    kicker,
    title,
    message,
    cancelLabel = 'CANCEL',
    confirmLabel,
  } = options;
  return new Promise((resolve) => {
    const uid = `vessel-dialog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const host = document.createElement('div');
    host.className = 'vessel-dialog-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'vessel-dialog vessel-glass';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `${uid}-title`);
    dialog.setAttribute('aria-describedby', `${uid}-message`);

    const kickerNode = document.createElement('p');
    kickerNode.className = 'vessel-kicker text-primary';
    kickerNode.textContent = kicker;
    const titleNode = document.createElement('h2');
    titleNode.id = `${uid}-title`;
    titleNode.className = 'font-display text-3xl font-semibold';
    titleNode.textContent = title;
    const messageNode = document.createElement('p');
    messageNode.id = `${uid}-message`;
    messageNode.className = 'text-on-surface-variant';
    messageNode.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'vessel-dialog-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'vessel-button vessel-button-secondary';
    cancelButton.textContent = cancelLabel;
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'vessel-button vessel-button-danger';
    confirmButton.textContent = confirmLabel;
    actions.append(cancelButton, confirmButton);
    dialog.append(kickerNode, titleNode, messageNode, actions);
    host.appendChild(dialog);

    const previousOverflow = document.body.style.overflow;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown);
      host.remove();
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancelButton) {
        event.preventDefault();
        confirmButton.focus();
      } else if (!event.shiftKey && document.activeElement === confirmButton) {
        event.preventDefault();
        cancelButton.focus();
      }
    };
    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
    host.addEventListener('click', (event) => {
      if (event.target === host) close(false);
    });
    document.addEventListener('keydown', onKeydown);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(host);
    cancelButton.focus();
  });
}
```

The implementation must create unique IDs per open dialog, lock `document.body.style.overflow`, clean up the key handler, and restore the previous overflow value. Use `textContent` for all supplied copy.

- [ ] **Step 4: Wire Gallery and add responsive styling**

At the top of `public/app.js`:

```js
import { confirmAction } from './confirm-dialog.js';
```

Replace the delete handler with an async handler:

```js
b.onclick = async () => {
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
};
```

Set `id="gallery-title" tabindex="-1"` on the existing `The Vault` heading. Add `.vessel-dialog-backdrop`, `.vessel-dialog`, `.vessel-dialog-actions`, and `.vessel-button-danger` rules to `vessel.css`. Use a centered max-width surface on desktop and a bottom inset sheet under `640px`; preserve 44px minimum targets and `prefers-reduced-motion` behavior.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd app/server && node --test test/confirm-dialog.test.js test/ledger-and-gallery.test.js test/accessibility.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/public/confirm-dialog.js app/server/public/app.js app/server/public/gallery.html app/server/public/vessel.css app/server/test/confirm-dialog.test.js app/server/test/ledger-and-gallery.test.js
git commit -m "fix(gallery): use in-page removal confirmation"
```

### Task 2: Petra connect compatibility and safe error messages

**Files:**
- Modify: `app/server/client-src/wallets/aptos-adapter.js`
- Modify: `app/server/test/aptos-adapter.test.js`

**Interfaces:**
- Consumes: Wallet Standard `aptos:connect.connect(silent)`, `aptos:network.network()`, and optional `aptos:changeNetwork.changeNetwork(TESTNET)`.
- Produces: `normalizeAptosError(error, walletName): Error` with stable Vessel error codes and safe user messages.

- [ ] **Step 1: Write failing compatibility tests**

Change the wallet fixture to record all connect arguments, then add:

```js
test('Petra connect passes only the silent flag and checks network afterward', async () => {
  const calls = [];
  const provider = wallet({ calls });
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });
  await adapter.connect({ silent: false });
  assert.deepEqual(calls, [['connect', false], ['network']]);
});

test('opaque Petra API failures become actionable without extension internals', async () => {
  const provider = wallet({ connectError: Object.assign(new Error('PetraApiError'), { stack: 'secret extension stack' }) });
  const adapter = createAptosAdapter({ id: 'aptos:petra:1', name: 'Petra', provider });
  await assert.rejects(
    () => adapter.connect(),
    (error) => error.code === 'provider_unavailable'
      && error.message === 'Petra could not connect. Unlock Petra and try again.'
      && !error.message.includes('stack'),
  );
});
```

Add a test that a rejected change-network response throws `wrong_network` with `error.session.sourceAddress === '0xabc'`.

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `cd app/server && node --test test/aptos-adapter.test.js`

Expected: FAIL because connect currently receives a second `TESTNET` argument and opaque errors are not normalized.

- [ ] **Step 3: Implement connection sequencing and normalization**

Add:

```js
export function normalizeAptosError(error, walletName = 'Aptos wallet') {
  if (error?.code) return error;
  const raw = String(error?.message || error || '');
  if (/reject|declin|cancel/i.test(raw)) return walletError('Wallet request was rejected', 'user_rejected');
  if (/PetraApiError/i.test(raw) || (walletName === 'Petra' && !raw.trim())) {
    return walletError('Petra could not connect. Unlock Petra and try again.', 'provider_unavailable');
  }
  return walletError(raw.trim() || `${walletName} could not connect`, 'provider_unavailable');
}
```

Implement `connect` as:

```js
async connect({ silent = false } = {}) {
  try {
    const account = approvedArgs(
      await feature('aptos:connect', 'connect').connect(silent),
    );
    session = buildSession(account);
    try {
      await ensureNetwork();
    } catch (error) {
      error.session = session;
      throw error;
    }
    return session;
  } catch (error) {
    const normalized = normalizeAptosError(error, descriptor.name);
    if (error?.session) normalized.session = error.session;
    throw normalized;
  }
}
```

Do not change the pinned wallet dependencies.

- [ ] **Step 4: Run focused wallet tests and commit**

Run: `cd app/server && node --test test/aptos-adapter.test.js test/wallet-session.test.js test/wallet-modal.test.js`

Expected: all focused tests PASS.

```bash
git add app/server/client-src/wallets/aptos-adapter.js app/server/test/aptos-adapter.test.js
git commit -m "fix(aptos): connect Petra before network enforcement"
```

### Task 3: Build, full regression, and browser acceptance

**Files:**
- Generated: `app/server/public/vessel-wallets.js`
- Generated: `app/server/public/vessel-solana.js` only if the build changes it

**Interfaces:**
- Consumes: source modules from Tasks 1-2.
- Produces: production browser bundles and release evidence.

- [ ] **Step 1: Run the complete automated check**

Run: `cd app/server && npm run check`

Expected: all Node tests PASS and `build:client` exits 0.

- [ ] **Step 2: Inspect generated and source diffs**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors, no secrets, and no changes outside the dialog, Aptos adapter, tests, CSS, `app.js`, and generated wallet bundle.

- [ ] **Step 3: Verify the original production symptoms locally**

Run: `cd app/server && npm start`

In a browser:

1. Connect Petra while it is unlocked and already on Aptos Testnet; the account must become ready.
2. Put Petra on another network; Vessel must request Testnet after connection and retain the account if switching is rejected.
3. Open Gallery, press Remove, then Escape; the card remains and focus returns to Remove.
4. Open again, Tab/Shift+Tab through both actions, confirm removal; only the local card disappears.
5. Confirm Chrome never displays a native confirmation box.

- [ ] **Step 4: Commit generated bundle and acceptance checkpoint**

```bash
git add app/server/public/vessel-wallets.js app/server/public/vessel-solana.js
git commit -m "build: refresh wallet browser bundles"
```

If `vessel-solana.js` is unchanged, do not stage it. Record the local acceptance evidence in the implementation task handoff rather than adding a new document.
