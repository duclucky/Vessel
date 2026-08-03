# Vessel Multi-Wallet Architecture — Design Specification

**Date:** 2026-08-03

**Status:** Approved in conversation; pending written-spec review

**Supersedes:** The Phantom-only wallet UX described in
`2026-08-03-vessel-ethereal-completion-design.md`. The visual system and proven
Solana sponsored-upload recipe from that specification remain in force.

## 1. Objective

Replace Vessel's Phantom-specific wallet UX with a standards-based wallet registry
that supports installed Aptos and Solana browser wallets, while preserving the existing
Ethereal/Stitch visual system and proven Solana DAA upload path.

The change must also:

- make the landing CTAs accurately describe navigation rather than wallet connection;
- open a centered wallet-selection dialog only from wallet actions inside the dApp;
- use a connected Aptos wallet as the native Shelby/Aptos storage identity;
- derive an Aptos DAA storage identity for supported Solana wallets;
- expose switch-wallet and disconnect actions from the connected-address control; and
- discover EVM providers as a disabled Beta surface until Ethereum DAA byte upload
  passes a fresh go/no-go probe.

## 2. Approved product decisions

The following decisions were explicitly approved in conversation:

1. Release one fully supports installed **Aptos and Solana** wallets.
2. EVM providers are discovered and displayed as **Beta**, but cannot initiate upload.
3. A wallet that supports multiple chains appears separately in each chain group.
4. An Aptos wallet on the wrong network receives a request to switch to Aptos Testnet.
5. The implementation uses a framework-agnostic, vanilla-JavaScript **Wallet Registry**;
   it does not add a React island or migrate the application to React.
6. Landing CTAs become `OPEN DAPP` and `LAUNCH STORAGE APP` and navigate to
   `/identity.html` without requesting wallet access.

## 3. Current state and constraints

### Proven path to preserve

The production application currently proves this real path:

`Phantom -> Solana identity -> deterministic Aptos DAA -> USDC devnet payment ->`
`server verification -> gas-station sponsorship -> Shelby upload owned by the DAA`

The current `client-src/vessel-solana.js` implementation and its testnet-specific
challenge workaround are load-bearing. They must be moved behind an adapter boundary,
not rewritten wholesale during wallet discovery work.

### Native Aptos behavior

Shelby's browser SDK supports an Aptos wallet-adapter signer. The connected Aptos
address is both the source wallet address and the Shelby storage account. It must hold:

- APT for Aptos transaction gas; and
- ShelbyUSD for Shelby storage registration fees.

The user signs and pays directly. The app's Solana payment and gas-station sponsor
routes are not used for native Aptos uploads.

### EVM limitation

Shelby's published Ethereum Kit documents DAA support, but this repository's recorded
runtime probes found that the published client stack could register ownership on-chain
and then failed to construct valid derivable authentication for the media byte-upload
challenge. Therefore EVM discovery is allowed, but EVM connect/payment/upload is not a
release-one capability. Enabling it requires a new, recorded end-to-end probe using the
then-current official SDK and Shelby network.

### Supported families, not arbitrary chains

"Scan all extensions" means discover all providers that implement the supported Aptos,
Solana, or EVM discovery standards. It does not mean that a wallet from an arbitrary
blockchain can be converted into an Aptos DAA. Release-one DAA functionality is Solana
only; Aptos is native.

## 4. Chosen architecture

Use a layered wallet system:

```text
Wallet dialog / connected-address menu
                  |
             WalletRegistry
            /      |       \
       Aptos    Solana    EVM Beta
         |         |         |
   native mode   DAA mode   disabled
         |         |
 Aptos direct   USDC + sponsored
    upload          upload
```

The layers are:

1. **Discovery drivers** collect wallet descriptors without connecting accounts.
2. **Chain adapters** normalize provider-specific methods into a common interface.
3. **Session controller** owns connection state and provider events.
4. **Identity strategies** resolve either a native Aptos address or a Solana-derived
   Aptos DAA address.
5. **Upload router** chooses native Aptos or sponsored Solana behavior.
6. **Presentation layer** renders the dialog, account menu, labels, and errors from the
   shared session state.

This preserves the existing HTML/JavaScript stack, avoids two competing state systems,
and allows additional adapters without changing page-level UI.

## 5. Wallet discovery

### Aptos

Use the Aptos wallet-standard/adapter-core registry to enumerate compatible installed
wallets and expose their names, icons, accounts, network information, and signing
capabilities. Legacy injected-provider fallbacks may be used only where the official
adapter supports them; Vessel must not maintain a hard-coded Petra-only provider path.

### Solana

Use the Solana Wallet Standard application registry to enumerate installed compatible
wallets. A detected wallet is enabled only if it exposes the capabilities Vessel needs:

- connect/account access;
- message or sign-in signing required by Solana DAA; and
- transaction signing/submission required for USDC payment.

Phantom becomes one registry result rather than a special global provider.

### EVM Beta

Listen for `eip6963:announceProvider`, dispatch `eip6963:requestProvider`, and deduplicate
providers by the announcement identity. Render the provider's name and icon through
safe DOM properties. Do not insert provider-supplied HTML or inline SVG.

EVM rows remain disabled and display `DAA UPLOAD UNDER VERIFICATION`.

### Normalized descriptor

```text
WalletDescriptor
├── id
├── name
├── icon
├── chain: aptos | solana | evm
├── installed
├── enabled
├── status: ready | incompatible | beta
└── capabilities
```

The registry deduplicates only within a chain. A multi-chain extension deliberately
produces one Aptos descriptor and one Solana descriptor.

## 6. Landing and wallet UX

### Landing

- Navigation CTA: `OPEN DAPP`
- Hero CTA: `LAUNCH STORAGE APP`
- Both navigate to `/identity.html`.
- Neither reads providers, requests accounts, opens the wallet dialog, or requests a
  signature.

### Wallet dialog

Clicking `CONNECT WALLET` inside the dApp opens a centered modal over a dark backdrop.
The dialog contains separate vertical groups for `APTOS`, `SOLANA`, and `EVM · BETA`.

Each row shows the provider icon, provider name, chain, and availability. Aptos and
compatible Solana rows are selectable. EVM rows are visible but disabled. If no
compatible provider is found, the dialog shows `NO COMPATIBLE WALLET DETECTED`, a
`SCAN AGAIN` action, and curated installation links.

Connection rejection keeps the dialog open and renders a concise inline error. Merely
opening the dialog never requests accounts or signatures.

### Connected-address menu

Clicking the connected-address control opens a desktop popover or mobile bottom sheet
containing:

- wallet name and active chain;
- source wallet address with copy action;
- Aptos/Shelby storage address with copy action;
- `SWITCH WALLET`; and
- `DISCONNECT`.

`SWITCH WALLET` reopens the wallet dialog. `DISCONNECT` clears the active session,
pending client payment state, storage identity, and page-level wallet presentation.

## 7. Session model and state machine

```text
WalletSession
├── chain: aptos | solana
├── walletId
├── walletName
├── sourceAddress
├── sourceNetwork
├── storageAddress
└── mode: native | daa
```

The state machine includes:

- `disconnected`
- `scanning`
- `connecting`
- `network_required`
- `connected`
- `ready`
- `insufficient_funds`
- `error`

All header and page CTAs render from this state. No page owns a separate wallet truth.

Only `walletId` and `chain` are persisted as reconnection hints. Reload may restore a
session only when the provider already grants access and no new signature prompt is
required. Signatures, payment tokens, private material, and sponsor credentials are
never persisted. If access was revoked, restoration returns to `disconnected`.

Provider account, disconnect, and network events invalidate stale state. An account
change creates or resolves the new storage identity, clears pending payment state, and
refreshes gallery data for the new namespace.

## 8. Aptos native flow

1. Connect the selected Aptos adapter.
2. Read the active network.
3. If it is not Aptos Testnet, request a network switch.
4. If programmatic switching is unsupported, show manual instructions and a
   `I'VE SWITCHED — TRY AGAIN` action.
5. Set `sourceAddress` and `storageAddress` to the connected Aptos address.
6. Before upload, read APT and ShelbyUSD balances and estimate/quote required fees where
   supported by the Shelby SDK.
7. If insufficient, do not submit the upload; identify the missing asset and provide
   the appropriate faucet route.
8. Build the Shelby upload with the Aptos wallet adapter's
   `signAndSubmitTransaction` function.
9. The wallet signs the register transaction and pays APT gas and ShelbyUSD storage
   fees directly.
10. Upload bytes and record the successful blob under the user's Aptos namespace.

Native Aptos must not call `/api/pay/quote`, `/api/pay/verify`, or
`/api/sponsor/submit`.

## 9. Solana DAA flow

1. Connect the selected compatible Solana adapter.
2. Resolve its public key and verify required signing capabilities.
3. Derive the deterministic storage address from `Solana public key + Vessel domain`.
4. Request an upload quote bound to the active identity and file.
5. The user transfers devnet USDC and pays the Solana transaction's SOL gas.
6. The server verifies the payment and returns an upload token.
7. The Solana wallet signs the Aptos DAA register transaction.
8. The gas station co-signs and sponsors Aptos gas and ShelbyUSD.
9. The browser uploads bytes using the currently proven testnet path.
10. Record the blob under the user's Aptos DAA namespace.

The Phantom implementation is first adapted with no semantic change. Other Solana
wallets are enabled only after the same upload contract passes against their adapter
shape.

## 10. Payment and identity binding

Solana quote and upload tokens must be bound to:

- chain;
- source wallet address;
- derived storage address;
- file size;
- expiration; and
- the existing payment identifier and memo.

The server rejects a verification or sponsorship request whose identity or file facts
do not match the signed token. Switching accounts, wallets, or chains invalidates the
client's unused quote/upload token. Aptos native sessions never receive Solana payment
tokens.

## 11. Module boundaries

Proposed source layout:

```text
app/server/client-src/wallets/
├── registry.js
├── session.js
├── aptos-adapter.js
├── solana-adapter.js
├── evm-discovery.js
└── upload-router.js

app/server/public/
├── wallet-modal.js
├── wallet-ui.js
├── app.js
└── vessel.css
```

The browser build exports one stable `window.VesselWallets` facade. The existing
`window.VesselSolana` interface remains temporarily behind a compatibility wrapper
during migration and is removed only after all callers and regression tests use the
new facade.

`public/app.js` coordinates pages and consumes normalized session/upload APIs; it does
not contain provider-specific branching.

Server changes are limited to public wallet capability configuration and stronger
Solana payment-token binding. No secret moves to the browser.

## 12. Visual and accessibility requirements

The wallet surfaces extend the approved Vessel Ethereal system:

- near-black glass background with restrained cyan/violet accents;
- maximum desktop dialog width of approximately 560px;
- 16px minimum mobile viewport gutters and an internally scrollable `100dvh`-safe
  dialog;
- wallet rows at least 56px high and pointer targets at least 44x44px;
- text contrast of at least 4.5:1 for normal text;
- `role="dialog"`, `aria-modal="true"`, accessible labels, and an `aria-live` error
  region;
- focus trapping, visible keyboard focus, Escape-to-close when no signing request is
  active, and focus restoration to the opener;
- status meaning conveyed by text/icon as well as color; and
- 150–250ms transitions disabled by `prefers-reduced-motion`.

Provider icons are rendered with `<img>` and never interpolated into `innerHTML`.

## 13. Error handling

- **User rejection:** retain a stable pre-connection state and explain that the request
  was cancelled.
- **Wrong Aptos network:** request Testnet; if unsupported, show manual instructions and
  retry.
- **Missing capability:** mark the wallet incompatible before payment or upload.
- **Insufficient funds:** name the missing asset (`APT`, `ShelbyUSD`, `SOL`, or `USDC`)
  and do not show false success.
- **Provider removed/revoked:** reset the session and refresh discovery.
- **Account/network changed:** invalidate identity-sensitive payment state and rebuild
  the active session.
- **Shelby/network failure:** preserve retry context, do not write gallery ledger state,
  and keep the provider family behind a configuration flag if its live acceptance probe
  fails.

## 14. Testing strategy

Implementation follows red-green-refactor for every behavior change.

### Automated tests

- Discover, normalize, group, and deduplicate mock Aptos, Solana, and EVM providers.
- Assert a multi-chain wallet appears once in each applicable chain group.
- Assert EVM providers render Beta and cannot create an upload session.
- Restore a previously authorized session without requesting a signature.
- Handle provider account, network, and disconnect events.
- Synchronize header and page CTA presentation from one session state.
- Request Aptos Testnet and cover programmatic-switch and manual-switch fallbacks.
- Assert native Aptos upload never calls payment or sponsorship routes.
- Preserve deterministic Solana DAA derivation and the current sponsored upload
  contract.
- Bind Solana quote/upload tokens to identity and file facts and reject mismatches.
- Assert landing CTAs only navigate and never access a wallet provider.
- Verify dialog semantics, focus behavior, keyboard actions, accessible names, and
  responsive class contracts.
- Run the complete existing test suite and browser bundle build.

### Live acceptance matrix

1. **Petra/Aptos Testnet:** connect, balance preflight, sign upload, observe APT and
   ShelbyUSD use, read the resulting blob, and verify the namespace equals Petra's
   address.
2. **Phantom/Solana Devnet:** connect, derive DAA, pay USDC, sponsor upload, read the
   blob, and verify the namespace equals the derived address.
3. Reload both session types without an unsolicited signature prompt.
4. Change account and network in the extension and verify immediate UI/session updates.
5. Switch wallet and disconnect from the connected-address menu.
6. Check desktop, mobile, reduced-motion, and keyboard-only behavior.
7. Confirm an installed EVM provider appears as disabled Beta and cannot pay/upload.

## 15. Acceptance criteria

- Landing labels describe navigation and never request wallet access.
- Clicking a wallet action inside the dApp opens the centered selection dialog.
- All detected compatible Aptos and Solana extensions appear in their respective
  groups without provider collisions.
- Multi-chain extensions appear separately by chain.
- Native Aptos identity, Testnet enforcement, direct signing, and direct APT/ShelbyUSD
  charging pass the live acceptance flow.
- Solana DAA and the existing USDC/sponsor ownership flow remain live-green.
- Clicking the connected address exposes copy, switch-wallet, and disconnect actions.
- Reload, account change, network change, and logout synchronize every wallet CTA.
- EVM providers are visible as Beta but cannot enter payment or upload.
- Automated tests and the client build pass with fresh output.
- The wallet dialog and account menu meet the approved responsive and accessibility
  contracts.
- No private key, signature, API key, gas-station credential, or payment secret is
  exposed or persisted client-side.

## 16. Out of scope

- Enabling Ethereum DAA before a fresh end-to-end byte-upload probe passes.
- Supporting chains other than Aptos, Solana, and EVM discovery.
- WalletConnect, mobile deep links, social login, embedded/custodial wallets, hardware
  wallet-specific UX, or arbitrary remote wallets in release one.
- Mainnet billing, production durability claims, or removal of the existing testnet
  warnings.
- A React, Next.js, or other framework migration.

## 17. Sources of truth

- Shelby native browser upload:
  https://docs.shelby.xyz/sdks/typescript/browser/guides/upload
- Shelby Ethereum Kit:
  https://docs.shelby.xyz/sdks/ethereum-kit
- Shelby Solana account funding:
  https://docs.shelby.xyz/sdks/solana-kit/guides/fund-account
- Aptos wallet adapter:
  https://github.com/aptos-labs/aptos-wallet-adapter
- Solana wallet adapters and wallet support:
  https://github.com/anza-xyz/wallet-adapter
- EIP-6963 multi-provider discovery:
  https://eips.ethereum.org/EIPS/eip-6963
- Repository runtime evidence:
  `HANDOFF.md` and `NOTES.md`
