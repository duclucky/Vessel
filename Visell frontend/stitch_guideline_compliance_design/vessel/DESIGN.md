---
name: Vessel
colors:
  surface: '#101419'
  surface-dim: '#101419'
  surface-bright: '#36393f'
  surface-container-lowest: '#0a0e13'
  surface-container-low: '#181c21'
  surface-container: '#1c2025'
  surface-container-high: '#262a30'
  surface-container-highest: '#31353b'
  on-surface: '#e0e2ea'
  on-surface-variant: '#bbc9cd'
  inverse-surface: '#e0e2ea'
  inverse-on-surface: '#2d3136'
  outline: '#859397'
  outline-variant: '#3c494c'
  surface-tint: '#2fd9f4'
  primary: '#8aebff'
  on-primary: '#00363e'
  primary-container: '#22d3ee'
  on-primary-container: '#005763'
  inverse-primary: '#006877'
  secondary: '#ffb95f'
  on-secondary: '#472a00'
  secondary-container: '#ee9800'
  on-secondary-container: '#5b3800'
  tertiary: '#ffd2d5'
  on-tertiary: '#67001f'
  tertiary-container: '#ffaab2'
  on-tertiary-container: '#94223a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#a2eeff'
  primary-fixed-dim: '#2fd9f4'
  on-primary-fixed: '#001f25'
  on-primary-fixed-variant: '#004e5a'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#ffdadc'
  tertiary-fixed-dim: '#ffb2b9'
  on-tertiary-fixed: '#400010'
  on-tertiary-fixed-variant: '#891933'
  background: '#101419'
  on-background: '#e0e2ea'
  surface-variant: '#31353b'
  surface-elevated: '#111826'
  surface-stroke: '#1E293B'
  text-muted: '#94A3B8'
  text-on-dark: '#F8FAFC'
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  data-lg:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.04em
  data-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 1200px
  gutter: 24px
  margin-mobile: 16px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style
The design system for this decentralized hot storage demo is built on the core principle of **"Proof over Hype."** It targets a technically sophisticated, crypto-native audience that values transparency, performance metrics, and sovereignty. The brand personality is precise, authoritative, and unapologetically technical, yet refined enough to feel modern and accessible.

The visual style is a hybrid of **Minimalism** and **Technical Brutalism**, utilizing high-contrast typography and data-heavy layouts to convey speed and security. 

### Key Visual Pillars
- **Technical Honesty:** Use monospaced fonts for all cryptographic and performance data to signal accuracy. 
- **Ephemeral Utility:** Since the data is temporary, the UI uses subtle "demo" markers—like a permanent utility banner—to manage user expectations without compromising the premium feel.
- **Speed Visualization:** Performance is not just a number; it is visualized through sharp transitions and active comparison modules.

## Colors
The palette is optimized for a high-performance dark mode environment. The foundation is a "Deep Slate" near-black that provides infinite depth for "Electric Cyan" accents to pop, signifying the "hot" speed of the storage network.

### Functional Mapping
- **Primary (Electric Cyan):** Reserved for Shelby-specific actions, "Hot" status indicators, and primary CTAs. It represents speed and the active protocol.
- **Secondary (Amber):** Used specifically for comparison metrics, IPFS latency markers, and warning states. 
- **Tertiary (Coral):** Utilized for system errors or destructive actions like "Wipe/Delete," providing a clear distinction from the brand amber.
- **Neutrals:** A range of cool grays are used to create hierarchy. Off-white (`#F8FAFC`) is used for primary readability, while muted grays handle secondary metadata.

## Typography
The typographic system relies on three distinct families to separate brand narrative from functional data.

- **Headlines (Space Grotesk):** Geometric and wide, used to establish the "Vessel" identity and section headers.
- **Body (Geist):** A clean, modern sans-serif designed for legibility in technical interfaces. 
- **Data (JetBrains Mono):** This is the workhorse of the design system. It must be used for all wallet addresses, IPFS hashes, file sizes, and millisecond latency readings.

**Usage Note:** All cryptographic addresses should use `data-sm` with a truncated middle (`0x12...34`) unless hovered, where they can expand or offer a copy action.

## Layout & Spacing
The layout follows a strict **Fixed Grid** approach for desktop to ensure data visualizations remain readable and aligned.

- **Desktop (1200px+):** 12-column grid with 24px gutters. Content is centered.
- **Tablet:** 8-column fluid grid with 20px margins.
- **Mobile:** 4-column fluid grid with 16px margins.

**The "Ephemeral Banner":** A 32px height utility bar is fixed at the very top of the viewport. It uses a `named_colors.surface-elevated` background with `label-caps` text to state the testnet status. This bar does not scroll with the content; it remains a constant frame for the demo.

## Elevation & Depth
This design system avoids traditional heavy shadows in favor of **Tonal Layers** and **Glassmorphism**.

- **Base Layer:** The deepest slate (`#0B0F14`).
- **Elevated Surfaces:** Cards and modals use a semi-transparent background (`rgba(17, 24, 38, 0.8)`) with a 12px backdrop blur.
- **Outlines:** Instead of shadows, depth is created using 1px "ghost borders." These borders use `surface-stroke`. 
- **Interactive Depth:** On hover, primary action cards should increase border opacity or add a subtle `primary-color` outer glow (4px blur, 0.2 opacity) to simulate a "powered-on" state.

## Shapes
The shape language is "Soft-Technical." Elements are predominantly rectangular to maximize the "precise" feel, but a small 4px radius (`roundedness: 1`) is applied to soften the industrial edge and ensure the UI feels modern rather than dated.

- **Inputs & Buttons:** 4px radius.
- **Media Thumbnails:** 4px radius.
- **Comparison Bars:** Sharp 2px radius or completely square ends to emphasize mathematical precision.

## Components

### Buttons
- **Primary:** Filled `Electric Cyan` with `Deep Slate` text. No rounded corners beyond 4px.
- **Secondary:** Outlined with `surface-stroke`, text in `Off-white`.
- **Status Buttons:** Use a small "pulsing" dot next to the label for "Sign to prove ownership" states.

### Data Cards (Latency Proof)
- Use a split-pane design. Left side: Shelby (Primary Accent). Right side: IPFS (Secondary Accent).
- Performance bars should animate from 0 to the `medianMs` value upon loading the section.
- If IPFS data is `null`, the right side should display a "Data Unavailable" pattern (diagonal 45-degree stripes in muted gray).

### Gallery Items
- Media is presented in a strict square grid.
- Each item must have a `label-caps` badge in the top-right corner indicating the "Time to Wipe" (e.g., "7D LEFT").

### Inputs (The Signature Prompt)
- High-contrast fields with `JetBrains Mono` text.
- Focus state should change the border from `surface-stroke` to `Electric Cyan` immediately.

### Ephemeral Banner
- A fixed-position component at the top of the page. 
- Text: "DEMO ENVIRONMENT • DATA WIPED WEEKLY • TESTNET ONLY."
- Style: Background `#111826`, border-bottom 1px `#22D3EE` (20% opacity).