# Vessel Landing Page and README Refresh

**Date:** 2026-08-04
**Status:** Approved design, pending implementation plan

## Objective

Present Vessel at its current scale as a coherent wallet-native NFT media platform, not as the smaller upload demo described by the existing landing page and README. The page must be immediately understandable to NFT users while preserving enough technical proof for Shelby and Aptos reviewers.

The refresh covers only content structure and the supporting landing-page presentation. It does not add new product behavior, change the existing dApp journeys, or imply that unavailable Shelby operations are working.

## Audience and Positioning

The landing page serves two audiences in this order:

1. NFT creators and application developers who need to understand the benefit and primary workflow quickly.
2. Technical reviewers who need evidence that Vessel uses DAA, chain-specific settlement contracts, signed quotes, multisig-controlled vaults, and Shelby hot storage.

The main positioning is **wallet-owned hot storage for NFT media**. Cross-chain settlement, metadata generation, Vault history, and batch-oriented collection workflows support that promise.

The landing page does not display the temporary Shelby API pause. Runtime availability belongs in the dApp where it can be shown in context. The README must document the pause and explain the degraded behavior honestly.

## Landing Page Information Architecture

### 1. Hero

- Kicker: wallet-native, cross-chain, powered by Shelby.
- Headline: communicate wallet-owned hot storage for NFT media without requiring protocol knowledge.
- Supporting copy: Aptos and Solana users can control storage, upload assets, and prepare NFT metadata from one application.
- Primary CTA: `LAUNCH APP`, routed to Identity.
- Secondary CTA: `EXPLORE HOW IT WORKS`, linked to the workflow section.

### 2. Platform Scale

Show three concise, defensible facts:

- `2` wallet ecosystems: Aptos and Solana.
- `2` settlement contracts: Aptos Move and Solana Program.
- `1` canonical NFT metadata schema shared by single and collection workflows.

These are architecture facts, not usage metrics. The design must not present fabricated users, uploads, capacity, revenue, or performance numbers.

### 3. Three-Step Workflow

1. **Connect:** use an Aptos wallet directly or authorize a derived Aptos storage identity from Solana.
2. **Store:** upload an individual asset or a collection folder when Shelby writes are available, with retention selected from 1 to 365 days.
3. **Publish:** copy stable media URLs, generate canonical NFT JSON, or export a collection metadata ZIP.

### 4. Product Capabilities

Use a responsive feature grid for:

- Wallet-native identity.
- Single and batch media upload.
- Wallet-scoped Vault and gallery history.
- Canonical single NFT metadata.
- Collection metadata JSON and ZIP export.
- Shelby versus IPFS latency evidence.
- Flexible 1 to 365 day retention and size-duration pricing.
- Contract-settled Vessel service receipts.

Claims must match implemented behavior. Batch metadata uses collections already recorded in the connected browser's Vault when the Shelby API is paused. Batch metadata hosting remains unavailable while writes are disabled.

### 5. Cross-Chain Architecture

Explain the two paths without overwhelming the user:

- **Aptos native:** the connected Aptos account is the storage identity and settlement sender.
- **Solana DAA:** the connected Solana wallet authorizes a deterministic Aptos storage identity, while Vessel service settlement occurs through the Solana Program.

Both paths converge on Shelby-hosted media and the same NFT metadata schema.

### 6. Trust and Settlement

Show the safeguards already implemented:

- Dedicated Ed25519 quote signatures shared across supported chains.
- Immutable quote parameters for wallet, file, retention, price, and expiry.
- Aptos Move and Solana Program receipts authorize the Vessel service flow.
- Contract vaults are controlled by an Aptos Multisig Account and Squads on Solana.
- Testnet assets have no real monetary value.

Do not claim that Shelby protocol fees or validator gas are held by Vessel. Those costs remain separate from the Vessel service vault.

### 7. Beta Transparency

State that Vessel is a testnet beta and that retention is temporary. Do not promise mainnet durability, permanent NFT storage, encryption, immutable blobs, guaranteed availability, or production service levels.

The current runtime API pause is deliberately omitted from the marketing page per the approved content strategy. Contextual dApp states remain the source of truth for live operation availability.

### 8. Final CTA and Footer

- Repeat the primary `LAUNCH APP` CTA.
- Link to the repository.
- Retain `Powered by Shelby · Live on Aptos Testnet` attribution.
- Describe Vessel as a testnet beta rather than the older capability-demo framing.

## Visual Direction

Preserve the approved Stitch-inspired visual language:

- Dark ethereal surface, crystal hero art, teal-to-violet accents, large Space Grotesk headings, and JetBrains Mono technical labels.
- Reuse existing tokens and components from `vessel.css`.
- Add only focused landing-specific styles for section rhythm, proof metrics, workflow connectors, and responsive architecture cards.
- Maintain minimum 44px interactive targets, visible focus states, reduced-motion support, semantic headings, and mobile layouts without horizontal scrolling.
- Use Material Symbols already loaded by the application. Do not introduce emoji or a second icon system.

## README Structure

Replace the contradictory historical README with a current repository guide:

1. Product summary and live deployment.
2. Current status, including the Shelby public API pause and local Vault degraded mode.
3. Implemented user journeys.
4. Aptos and Solana architecture.
5. Contract settlement and deployed testnet addresses.
6. Canonical NFT metadata and batch collection behavior.
7. Repository map.
8. Local prerequisites and quickstart.
9. Environment configuration grouped by purpose, without secret values.
10. Test, build, and verification commands.
11. Vercel deployment instructions using `app/server` as the configured Root Directory.
12. Security model and secret handling.
13. Honest beta limitations and unavailable behavior.
14. Links to the operating manual, project knowledge, guides, live app, Shelby documentation, and contract-specific READMEs.

The README must identify older knowledge documents as historical planning material where they conflict with the deployed implementation. The deployment manifest and current code are authoritative for deployed addresses and runtime behavior.

## Testing and Acceptance Criteria

### Automated

- Landing tests assert both CTAs, the platform-scale facts, the three workflow steps, the implemented feature names, the two chain paths, settlement safeguards, beta language, and absence of unsupported claims.
- Accessibility tests continue to validate semantic structure, focus behavior, touch sizing, shared theme assets, and attribution.
- The full Node test suite passes.
- The browser bundles build successfully.
- HTML and JavaScript syntax checks pass.

### Manual browser verification

- Desktop and mobile layouts contain no horizontal overflow.
- Primary and secondary CTAs navigate to the intended destinations.
- All major sections are readable in the approved dark theme.
- Technical values have adequate contrast.
- The landing page contains no live API-pause banner.
- The deployed production page matches the committed content.

## Out of Scope

- Changing upload, payment, wallet, metadata, or storage behavior.
- Adding mainnet support or durability guarantees.
- Adding analytics, fabricated social proof, partner logos, pricing tables, or testimonials.
- Redesigning dApp pages.
- Publishing a separate documentation site.
