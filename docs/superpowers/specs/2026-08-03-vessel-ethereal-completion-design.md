# Vessel Ethereal Completion Pass — Design Specification

**Date:** 2026-08-03

**Status:** Approved in conversation; pending written-spec review

**Reference:** `stitch_guideline_compliance_design (1)/stitch_guideline_compliance_design/`

## 1. Objective

Complete the Vessel demo without changing its proven Phantom/USDC/Shelby architecture,
while redesigning all six public pages to match the supplied Vessel Ethereal Stitch
reference. The result must preserve the existing six-URL journey:

`Landing -> Identity -> Upload -> Gallery -> Latency -> Metadata`

The completion pass also fixes the known landing-wallet and Tailwind syntax defects,
proves the localStorage ledger flow through the real upload UI, sets the production
public base URL, deploys the verified build, and records a live demo after verification.

## 2. Scope

### In scope

- Redesign `index.html`, `identity.html`, `upload.html`, `gallery.html`,
  `latency.html`, and `metadata.html` using the supplied Ethereal visual language.
- Preserve every API route, Phantom/DAA signature step, USDC payment step, sponsored
  Shelby upload, and client/server security boundary.
- Keep the six pages separate even though the Stitch identity reference combines
  identity and upload concepts.
- Consolidate duplicated visual configuration into shared theme and stylesheet assets.
- Update dynamic markup emitted by `public/app.js` so Gallery, progress, error, empty,
  latency, metadata, and toast states match the redesigned static pages.
- Add automated regression tests and perform responsive/browser/live verification.
- Set `PUBLIC_BASE=https://vessel-sage.vercel.app`, rebuild, deploy, and smoke-test the
  production URL after local verification.

### Out of scope

- Changes to the proven Shelby SDK integration, sponsorship recipe, payment protocol,
  token verification, or storage ownership model unless a regression test proves a
  visual refactor broke an existing contract.
- Ethereum byte upload, mainnet support, custom NFT minting, encryption, durability
  guarantees, or production billing.
- A framework migration to React, Vite, Next.js, or another component system.
- Invented claims from the visual mockups, including managed encryption, immutability,
  permanent storage, or weekly wipes on the current testnet.

## 3. Chosen approach

Use a **shared Ethereal shell** within the existing vanilla HTML/JavaScript application.

- Add a shared Tailwind theme script for semantic color, type, radius, spacing, and
  elevation tokens derived from `vessel_ethereal/DESIGN.md`.
- Add a shared CSS file for backgrounds, glass surfaces, glow, focus treatment,
  responsive navigation, page transitions, and reduced-motion behavior.
- Keep page HTML independent, but use the same status strip, floating navigation,
  footer, structural classes, and accessibility conventions.
- Preserve all runtime IDs and selectors required by `public/app.js` and
  `public/vessel-solana.js`.

This approach is preferred over copying the Stitch HTML verbatim because a direct copy
would discard runtime IDs and proven application behavior. It is preferred over a
framework migration because the additional build/runtime surface would not improve the
demo and would increase regression risk.

## 4. Visual system

### Color and atmosphere

- Midnight base: near-black navy surfaces from the Vessel Ethereal token set.
- Primary light source: teal/mint.
- Secondary light source: violet.
- Technical/data accent: cyan.
- Layered radial blooms and the supplied crystal hero image create depth.
- Glass surfaces use 3–8% translucent fills, 20–40px backdrop blur, white 5–10%
  borders, and restrained teal/violet bloom.

The source asset
`stitch_guideline_compliance_design (1)/stitch_guideline_compliance_design/a_hero_image_for_an_nft_storage_platform_called_vessel._the_visual_should_be_an/screen.png`
is served locally rather than hotlinked from the Stitch HTML.

### Typography

- Space Grotesk for display and headings.
- Geist for body text and interface copy.
- JetBrains Mono for addresses, hashes, latency values, status labels, and JSON.
- Headings use tight tracking; technical labels use wider tracking and uppercase.

### Shape and spacing

- Inputs and buttons use soft 16–24px radii.
- Cards and major panels use 24–32px radii.
- Pills are reserved for status, chips, and the floating navigation.
- Desktop uses a wide fluid grid; mobile uses 20px page gutters and a 4-column rhythm.

## 5. Shared components

### Status strip

Displays accurate environment copy:

`Shelby Testnet · Sponsored DAA · Data is Ephemeral`

It must not say that current testnet data is wiped weekly.

### Floating navigation

- Desktop: Vessel wordmark, `Identity`, `Upload`, `Gallery`, `Latency`, and wallet CTA.
- Mobile: accessible `<details>` menu with the same destinations and a visible wallet
  action, without a JavaScript dependency.
- Active page is conveyed by more than color alone.
- Fixed navigation is paired with enough top padding to avoid content overlap.

Metadata remains contextual: users enter it from a selected/uploaded asset rather than
from the primary navigation.

### Footer

Uses the minimal Stitch composition and accurate 2026/demo language. Placeholder links
must either resolve to a real destination or be rendered as non-interactive text.

### Feedback primitives

- Toasts, empty states, progress, payment gates, and errors share the Ethereal glass
  treatment.
- Raw stack traces and internal secrets are never rendered.
- Interactive states include visible focus, hover, pressed, disabled, and loading
  treatments.

## 6. Page designs

### Landing

- Closely follows `vessel_landing_connect_ethereal`.
- Crystal hero artwork sits behind a centered headline and concise value proposition.
- The main and navigation CTAs both lead to Identity, where Phantom is available.
- Three proof cards explain DAA, sub-second reads, and ephemeral testnet storage.

### Identity

- Two-column desktop layout adapted from `vessel_identity_upload_ethereal`.
- Left: active node/identity card with Phantom address, derived Aptos storage account,
  ownership relationship, and copy actions.
- Right: signature explanation and ownership action. It does not duplicate the Upload
  page's drop zone.
- Mobile stacks identity before the action so the signing context is visible first.

### Upload

- Uses the large Ethereal drop-zone composition from the identity/upload reference.
- Preserves initial, progress, payment-gate, and success DOM states.
- Makes sponsorship explicit: the user pays testnet USDC while the app sponsors Aptos
  gas and ShelbyUSD; the blob remains owned by the user's DAA account.
- Does not claim managed encryption.

### Gallery

- Closely follows `vessel_immersive_gallery_deep_dark` and is titled “The Vault”.
- The upload-new card appears first, followed by real ledger-backed artifact cards.
- Cards show preview, key, size, expiration/TTL, ownership status, and copy/view/remove
  actions without claiming permanence or immutability.
- Empty state remains actionable and links to Upload.

### Latency

- Reuses the Ethereal glass system for Shelby/IPFS comparison panels.
- Large technical values, semantic teal/violet colors, and bars make the comparison
  legible without relying on color alone.
- Empty/unavailable states remain honest when no comparable IPFS asset exists.

### Metadata

- Left column: selected asset summary and metadata fields.
- Right column: live JSON preview and generated tokenURI result.
- The selected Shelby URL comes from the localStorage ledger and is never replaced by
  a decorative mock URL.

## 7. Behavior and data flow

The redesign does not change the storage flow:

1. Landing directs the visitor to Identity.
2. Phantom connects and derives the customer's DAA storage account.
3. Upload requests a stateless quote, transfers devnet USDC, verifies payment, and
   obtains an upload token.
4. Phantom signs the sponsored register transaction; the server gas station co-signs
   and submits it.
5. The browser uploads bytes to Shelby testnet.
6. Successful UI rendering writes `vessel_mine`, `vessel_selected_key`, and
   `vessel_selected_key_url`.
7. Gallery, Latency, and Metadata consume that ledger.

The client continues to hold only wallet signatures. Server secrets, API keys, payment
HMAC material, and gas-station credentials remain server-side.

## 8. Responsive and accessibility requirements

- Verify at viewport widths 320, 375, 768, 1024, and 1440px.
- No horizontal page scroll at any required viewport.
- Sequential heading hierarchy and semantic `header`, `nav`, `main`, and `footer`
  landmarks.
- A skip link is available on nav-heavy pages.
- All actions are keyboard reachable in visual order.
- Icon-only actions have accessible names and at least a 44x44px interactive target.
- Text and interactive controls meet WCAG AA contrast where applicable.
- Images have meaningful alt text; decorative imagery is hidden from assistive tech.
- Focus rings are visible; disabled and error states do not rely on color alone.
- Motion respects `prefers-reduced-motion`.

## 9. Error handling

- Wallet rejection returns the user to the stable pre-action state with a concise
  message.
- Insufficient devnet USDC renders the existing faucet gate in the new visual system.
- Upstream Shelby failures keep the retry guidance and never report false success.
- A failed upload must not write any selected-key or gallery ledger entries.
- Missing ledger data produces actionable empty states on Gallery, Latency, and
  Metadata.
- Image preview failure falls back to a technical artifact placeholder without
  breaking the card layout.

## 10. Testing strategy

Implementation follows red-green-refactor for each behavior change.

### Automated regression tests

- Parse every HTML Tailwind/theme script and every application JavaScript file.
- Assert required page/runtime DOM IDs remain present.
- Assert landing wallet actions navigate to Identity without requiring MetaMask.
- Exercise the successful upload render path and verify the three localStorage ledger
  values used by downstream pages.
- Exercise failure paths and verify they do not create success ledger state.
- Assert navigation destinations, active states, accurate environment copy, and the
  absence of prohibited claims.
- Assert accessibility contracts that can be checked statically.
- Run the existing Solana client bundle build and verify `clay.wasm` is produced.

### Browser QA

- Compare Landing, Identity, and Gallery against the supplied Stitch screenshots at
  desktop width.
- Inspect all six pages at the required responsive widths.
- Check console output, keyboard navigation, menu behavior, focus, content overflow,
  dynamic card rendering, progress, error, and empty states.

### Live verification

After local tests and visual QA pass:

1. Build the client bundle.
2. Set production `PUBLIC_BASE` to `https://vessel-sage.vercel.app`.
3. Deploy to the existing Vercel production project.
4. Perform one authorized Phantom/devnet-USDC upload through the real UI.
5. Verify the returned Shelby URL and byte response.
6. Verify Gallery, Latency, and Metadata consume the new ledger entry.
7. Record the final run after the production smoke test is stable.

## 11. Acceptance criteria

- All six pages visibly belong to the supplied Vessel Ethereal design system.
- Landing, Identity, and Gallery substantially match their reference compositions.
- Upload, Latency, and Metadata extend the same tokens/components without introducing a
  conflicting visual language.
- Six existing URLs and all proven Phantom/payment/sponsorship behavior remain intact.
- Tailwind/theme and browser console syntax errors are eliminated.
- Landing does not require MetaMask.
- A real UI upload writes the local ledger and is visible in Gallery, usable in
  Latency, and selected in Metadata.
- Required automated tests and the client build pass with fresh output.
- Responsive and accessibility checks pass at the required viewports.
- Production `PUBLIC_BASE` is correct, deployment succeeds, and the live smoke test is
  recorded.
- Final diff contains no secrets, unrelated refactors, stale debug code, or generated
  files outside the expected client bundle/WASM assets.

## 12. Explicit assumptions

- The existing production Vercel project and environment variables remain available.
- The user-authorized Phantom wallet has enough devnet SOL and USDC for one validation
  upload, or the documented faucets are available.
- The supplied crystal hero image may be copied into the public asset directory and
  distributed with the demo.
- Shelby testnet may be transient; network failure is reported as external uncertainty
  and does not justify weakening success checks.
