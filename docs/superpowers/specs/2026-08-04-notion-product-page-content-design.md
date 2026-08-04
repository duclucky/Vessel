# Vessel Notion Product Page Content Design

**Date:** 2026-08-04
**Status:** Approved design

## Objective

Rewrite the existing public Notion page as the definitive product overview for Vessel. The page must help NFT creators understand the workflow quickly and give technical reviewers enough evidence to evaluate the architecture, contracts, metadata model, and security posture.

The deliverable is English page copy plus one master prompt that instructs Notion AI to replace and format the existing page.

## Audience and Positioning

The page serves NFT creators and application developers first, then Shelby and Aptos reviewers. The main positioning is **wallet-owned hot storage for NFT media**.

Use a product-story structure backed by technical proof. Explain the user outcome before introducing DAA, quote signing, contract receipts, and multisig governance.

## Information Architecture

1. Hero with product name, headline, concise value proposition, and CTA links.
2. Executive summary.
3. The NFT media problem.
4. Connect, Store, Publish workflow.
5. Current product capabilities.
6. Aptos native and Solana DAA architecture.
7. Contract settlement, quote signing, receipts, and multisig governance.
8. Canonical NFT metadata schema and JSON example.
9. Batch collection workflow sourced from wallet-scoped Vault history.
10. Public testnet deployment addresses.
11. Security model.
12. Honest beta scope and limitations.
13. Roadmap.
14. Resource links and final CTA.

## Required Product Facts

- Live application: `https://vessel-sage.vercel.app`.
- Repository: `https://github.com/duclucky/Vessel`.
- Example metadata URL: `https://vessel-sage.vercel.app/api/media/33bf09e7e9cd8e2e72f55db22bd1f10c7ff3f92ccb3057b6507fa99d4e7324aa.json`.
- Supported wallet paths are Aptos native and Solana DAA.
- User journeys include wallet identity, single upload, batch upload, Vault and Gallery, canonical single NFT metadata, collection JSON and ZIP export, flexible retention, latency evidence, and contract settlement.
- Retention accepts 1 to 365 days.
- Quote calculation includes network and protocol cost, sponsored gas, a 2% Vessel service fee, and a USD 0.01 minimum.
- Each supported chain has a separate settlement contract or program and service-fee vault.
- One Ed25519 key signs the canonical quote model for both chains.
- Aptos governance uses a 2-of-3 Aptos Multisig Account.
- Solana governance uses a 2-of-3 Squads multisig.
- Batch metadata selects a collection already recorded in the connected wallet's Vault. It does not ask the user to select the source folder again.
- Collection JSON reuses existing Shelby media URLs and exports deterministic metadata files as a ZIP.
- Vessel prepares media and metadata URLs. It does not mint NFTs.

## Deployment Evidence

Include these public identifiers:

- Aptos Move contract and multisig: `0x9885a9a0e382335d0f801301d43b451facaa6e768d31e5c9903b2a0dd9efef15`.
- Aptos service-fee vault: `0x2025257c90ced758ea49e1492d60a903dbc8c4d5915657611f968b7a27cf3f8a`.
- Solana Program: `G2dA3Sz1XxvJ4ppkvwb95kfy5w6M9ip2KiZBmt7xbsBx`.
- Solana vault ATA: `Ac7fiHCWCnWFkPUE6xgsginTqQmfUE6uwFkPUN7Pv8y7`.
- Solana Squads multisig: `GuoEcd5vAUctrhNbiS8WygVBMFL85kR4GN6yJFuK6zRh`.

## Notion Presentation Rules

- Rewrite the entire existing page. Do not append a second version below the old content.
- Use a dark Web3 product narrative with concise paragraphs and high scanability.
- Use callouts, two-column sections, numbered steps, compact tables, toggles, dividers, and one JSON code block where they materially improve comprehension.
- Keep headings action-oriented and avoid generic labels where a meaningful headline works.
- Use short labels and bold lead-ins, but do not bold complete paragraphs.
- Keep contract addresses in code formatting.
- Do not use em dashes. Use commas, parentheses, colons, or full stops instead.
- Do not mention the temporary Shelby public API pause.
- Do not describe network-dependent operations as guaranteed or continuously available.

## Claim Boundaries

Do not claim or imply:

- Permanent storage or mainnet durability.
- Managed encryption.
- A production SLA or guaranteed availability.
- Mainnet launch status.
- NFT minting or marketplace listing.
- Fabricated users, upload counts, storage capacity, partners, testimonials, or performance measurements.
- That network or protocol fees are deposited into Vessel contract vaults.

The page may describe implemented beta workflows and public testnet deployments. It must label the product as a testnet beta and state that testnet assets have no real monetary value.

## Master Prompt Behavior

The master prompt must:

1. Tell Notion AI to replace the current page in place.
2. Supply the full approved copy, not ask Notion to invent factual content.
3. Specify block types and layout intent for every section.
4. Preserve exact URLs and public addresses.
5. Prohibit em dashes and unsupported claims.
6. Instruct Notion to keep the page public-facing, polished, and submission-ready.
7. End with a factual verification checklist Notion should apply before finishing.

## Acceptance Criteria

- The final page copy covers all fourteen sections in the approved order.
- Every required public URL and deployment address is present exactly once in the main body or resources section.
- The metadata JSON example uses a standard NFT shape and the supplied Shelby-hosted example URL.
- Batch collection copy clearly sources collections from Vault history.
- The API pause is absent.
- Unsupported storage, security, availability, and adoption claims are absent.
- No em dash character appears in the page copy or master prompt.
