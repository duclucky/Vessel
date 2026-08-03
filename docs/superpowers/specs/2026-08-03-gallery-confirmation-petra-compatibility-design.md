# Gallery Confirmation and Petra Compatibility Design

**Date:** 2026-08-03

**Status:** Approved design, awaiting written-spec review

**Delivery phase:** 1 of 3 (reliability)

**Scope:** Replace the Gallery's native browser confirmation and restore Petra connection compatibility without upgrading the Shelby-facing Aptos SDK stack.

## Context

Production end-to-end testing found two user-facing defects:

1. Removing an artifact from the Gallery calls `window.confirm()`. Chrome therefore renders a browser-owned dialog that does not match Vessel's interface and blocks browser automation.
2. Selecting Petra produces `PetraApiError` before a wallet session is created. Vessel currently calls the optional network argument of `aptos:connect`; the current official Aptos wallet adapter connects without that argument and handles network validation after connection.

The existing behavior that must remain unchanged is:

- Gallery removal deletes only the browser-local Gallery record. The Shelby blob remains available until testnet expiry.
- Aptos wallets use their own Aptos account as the Shelby storage address.
- Aptos sessions must run on Aptos Testnet. A wallet on another network must be asked to switch.
- The existing Shelby SDK dependency set remains pinned unless a separate migration is approved.

## Goals

- Render artifact-removal confirmation inside the Vessel page.
- Make the confirmation keyboard accessible and resistant to accidental deletion.
- Connect Petra through the Wallet Standard path used by the current official Aptos adapter.
- Preserve explicit Testnet validation and network-switch behavior.
- Replace opaque Petra failures with useful, safe user-facing errors.
- Add regression coverage for both changes.

## Non-goals

- Deleting the underlying Shelby blob.
- Redesigning artifact cards or the wallet picker.
- Upgrading `@aptos-labs/ts-sdk`, Shelby SDK packages, or the entire wallet stack.
- Adding a Petra-specific injected-provider integration outside Wallet Standard.
- Changing Solana DAA connection or upload behavior.

## Design 1: In-page Gallery confirmation

### Component boundary

Add a small reusable confirmation-dialog module responsible only for:

- mounting one dialog host into the document;
- presenting title, message, cancel label, and destructive-action label;
- resolving a promise with `true` only after explicit confirmation;
- closing on Cancel, Escape, or backdrop click;
- restoring focus to the control that opened it.

Gallery remains responsible for deciding what removal means. It will await the dialog result, call `forgetMine(key)` only when confirmed, show the existing success toast, and re-render the Gallery.

### Visual treatment

The dialog will use the existing Vessel glass surface, border, bloom, typography, and backdrop language. It appears centered on desktop and as a comfortable inset sheet on small screens.

Content:

- Kicker: `GALLERY ACTION`
- Title: `Remove artifact?`
- Body: `This removes the artifact from this browser's Gallery. The blob stays on Shelby until it expires.`
- Secondary action: `CANCEL`
- Destructive action: `REMOVE FROM GALLERY`

Cancel receives initial focus. The destructive action uses the existing error color treatment and is never the default focused control.

### Accessibility and interaction

- Use `role="dialog"`, `aria-modal="true"`, and labelled title/body relationships.
- Lock background scrolling while open.
- Trap Tab and Shift+Tab within the dialog.
- Escape and backdrop click cancel without modifying data.
- Restore focus to the originating Remove button on cancellation.
- After confirmation and card removal, move focus to the Gallery collection heading or upload slot so focus is not left on a removed node.
- Ensure all targets meet the existing minimum touch-size rules.

No native `confirm`, `alert`, or `prompt` call remains in the Gallery removal path.

## Design 2: Petra Wallet Standard compatibility

### Connection flow

The Aptos adapter will call the Wallet Standard connection feature with only the optional silent flag:

1. `aptos:connect.connect(silent)` requests or restores the wallet account.
2. Vessel normalizes the approved account into its native Aptos session.
3. `aptos:network.network()` reads the actual connected network.
4. If the wallet is already on Aptos Testnet, the session becomes ready.
5. Otherwise Vessel calls `aptos:changeNetwork.changeNetwork(TESTNET)` when available.
6. If switching is unsupported or rejected, Vessel retains the connected account in a `network_required` state and instructs the user to switch to Aptos Testnet.

This keeps network enforcement separate from account authorization and follows the current official adapter's connection shape while remaining valid for the installed Wallet Standard version.

### Error normalization

Introduce a narrow Aptos connection-error normalizer. It will:

- preserve Vessel error codes already created by the adapter;
- map explicit user rejection to `Wallet request was rejected`;
- map `PetraApiError` and equivalent provider-only labels to `Petra could not connect. Unlock Petra and try again.`;
- preserve a meaningful provider message when one exists;
- never expose stack traces, extension internals, or sensitive data.

The wallet picker remains open on failure so the user can retry Petra, scan again, or choose another wallet.

### Dependency strategy

Keep `@aptos-labs/wallet-standard@0.5.2` and `@aptos-labs/ts-sdk@5.2.1` for this fix. Wallet Standard 1.x and 2.x require Aptos SDK 6.x and 7.x respectively; upgrading them in this patch would expand risk into Shelby SDK compatibility and transaction serialization. A dependency migration should be handled separately with dedicated transaction tests.

## Data flow

### Gallery removal

`Remove button` → `confirmRemoval()` → Cancel returns `false` with no change, or Confirm returns `true` → `ledger.forgetMine(key)` → Gallery re-render → success toast.

### Petra connection

`Petra row` → controller `connecting` → adapter `connect(silent)` → approved account → session normalization → network read → ready on Testnet, switch request on another network, or normalized error returned to the wallet modal.

Neither flow calls a Vessel backend API before the user action is locally resolved.

## Testing strategy

Implementation follows test-driven development.

### Confirmation-dialog tests

- Gallery source no longer calls `window.confirm()`.
- The dialog exposes the required accessible contract and Vessel labels.
- Cancel leaves the ledger untouched.
- Escape and backdrop cancel.
- Confirm removes exactly the requested local record.
- Focus starts on Cancel and is restored or moved safely after closing.

### Aptos adapter tests

- Connect passes only the silent flag and does not pass `TESTNET` into `aptos:connect`.
- A Testnet account becomes a native session whose wallet and storage addresses match.
- A non-Testnet account requests `aptos:changeNetwork(TESTNET)` after connection.
- Unsupported or rejected switching produces `network_required` with the connected session retained.
- `PetraApiError` becomes the actionable Petra message.
- User rejection remains distinguishable from provider/API failure.
- Existing account/network event tests continue to pass.

### Verification

- Run the focused dialog and Aptos adapter tests first.
- Run the complete server test suite and rebuild the browser bundles.
- Locally verify keyboard behavior and responsive layout.
- Deploy through the existing Vercel Git integration.
- On production, verify Petra connection, wallet state restoration, Gallery Cancel, Gallery Confirm, and absence of native browser dialogs.

## Rollback

The changes are isolated to the Gallery confirmation module, Gallery event wiring, Aptos adapter connection/error handling, tests, and rebuilt browser assets. They can be reverted without changing stored data formats, backend routes, payment verification, or Shelby blob ownership.

## Relationship to the beta product work

This reliability phase ships before retention and pricing work. The follow-on design is documented in `2026-08-03-hot-storage-beta-retention-pricing-renewal-design.md`. Phase 1 must not introduce a new data format that prevents the later Gallery cache from storing authoritative on-chain expiration and transaction data.
