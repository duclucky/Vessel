# Guide 00 · Setup (install the official Shelby tooling)

**Run this before everything else.** It gathers every official-Shelby download —
the agent **skills** (plugin), the **CLI**, and the **SDK/kits** — into one sequential
checklist, plus environment/faucet/API-key setup. Do this, then go to
`guides/01-verification-first.md`.

Tags: **[VERIFIED]** (confirmed from Shelby docs/repo at authoring, ~Q3 2026),
**⚠️ VERIFY** (confirm the exact string against the source before relying), **[ANALYSIS]**.

> **Golden rule (repeat):** these instruction files teach *how to think*. The **exact,
> current** commands and API live in the official skill + `https://docs.shelby.xyz`.
> Where a name below is marked `⚠️ VERIFY`, read the source and use what you find there.

---

## Step 1 — Install the official Shelby agent skills (the canonical API source)

**[VERIFIED]** The official repo is **`github.com/shelby/shelby-skills`** (org = `shelby`).
It is a **Claude Code plugin** with a `SKILL.md` per package + `references/`, covering:
`shelby-sdk`, `shelby-ethereum-kit`, `shelby-solana-kit`, `shelby-cli`, `shelby-media`.

> **⚠️ Two-repo caveat:** there is also a community repo `codehakase/shelby-skills`
> (plugin name `shelby-blockchain`, adds WebDAV/balance skills). **For canonical API
> signatures, use the official `shelby/shelby-skills`.** You may add the community one
> too, but don't confuse the two.

### 1a. As a Claude Code plugin (recommended if you're on Claude Code)

**[VERIFIED]** Claude Code plugins install via the marketplace pattern:

```text
# Inside Claude Code (interactive slash commands):
/plugin marketplace add shelby/shelby-skills
/plugin install <plugin-name>@<marketplace-name>
```

```bash
# Or the non-interactive CLI form:
claude plugin marketplace add shelby/shelby-skills
claude plugin install <plugin-name>@<marketplace-name>
```

**⚠️ VERIFY `<plugin-name>` and `<marketplace-name>`:** read them from the repo's
`.claude-plugin/marketplace.json` (marketplace `name` + `plugins[].name`) and the
per-plugin `.claude-plugin/plugin.json`, or the repo README. Do **not** guess these
strings. After install, run `/plugin` → **Installed** tab and confirm the Shelby plugin
is listed and its skills are available in-session (no restart needed).

**[ANALYSIS]** Installation scope matters: install at **project scope** (`.claude/skills/`
in this repo) if you want it committed with Vessel, or user scope for reuse across
projects. The plugin marketplace has no auto-update yet — **reinstall to pull the latest**
(the API moves; do this periodically).

### 1b. As raw SKILL.md files (for Cursor / Copilot / any agent, or manual reading)

**[ANALYSIS]** If you're not on Claude Code, or you just want to read the reference docs,
clone and point your agent at the `SKILL.md` files:

```bash
git clone https://github.com/shelby/shelby-skills
# Read, at minimum, before writing integration code:
#   shelby-skills/skills/shelby-ethereum-kit/SKILL.md      (+ references/ethereum-kit.md)
#   shelby-skills/skills/shelby-sdk/SKILL.md                (+ references/{api-reference,react,advanced}.md)
#   shelby-skills/skills/shelby-cli/SKILL.md                (+ references/commands.md)
#   shelby-skills/skills/shelby-media/SKILL.md              (if video is in scope)
```

**Checkpoint 1:** the Shelby skill is installed/readable, and you have opened
`shelby-ethereum-kit` and `shelby-sdk`. These are your source of truth for signatures.

---

## Step 2 — Install the official Shelby CLI

**[VERIFIED]** Scope is `@shelby-protocol/*`. Install the CLI globally (pick one PM):

```bash
npm add -g  @shelby-protocol/cli
# pnpm add -g @shelby-protocol/cli
# yarn add -g @shelby-protocol/cli
# bun  add -g @shelby-protocol/cli

shelby --version        # confirm install
```

**[VERIFIED]** You'll also want the **Aptos CLI** available — the Shelby CLI's account
setup prints an `aptos init …` profile command and uses `aptos account fund-with-faucet`
for gas. Confirm the exact flow in `shelby-cli` / `https://docs.shelby.xyz/tools/cli`.

**Checkpoint 2:** `shelby --version` prints a version. (Full CLI round-trip is Probe 0 in
`guides/01`.)

---

## Step 3 — Install the SDK + chain kits (app dependencies)

**[VERIFIED]** In the app repo, add the core SDK and the kits you need. Vessel's primary
is **ethereum-kit**; add solana-kit only for the stretch goal; media packages only if
video is in scope.

```bash
# Core SDK (Node + browser entry points):
npm add @shelby-protocol/sdk

# React hooks layer:
npm add @shelby-protocol/react

# Ethereum wallet via DAA  ← PRIMARY:
npm add @shelby-protocol/ethereum-kit

# Solana wallet via DAA    ← stretch only:
npm add @shelby-protocol/solana-kit

# Media (only if video is in scope):
npm add @shelby-protocol/player @shelby-protocol/media-prepare
```

**[VERIFIED] Peer / companion deps** (seen in Shelby's own docs examples):

```bash
# Aptos types (Network enum etc.) + React Query (the React hooks build on it):
npm add @aptos-labs/ts-sdk @tanstack/react-query

# Ethereum wallet stack (our primary — confirm which the ethereum-kit expects):
npm add wagmi viem            # ⚠️ VERIFY: ethereum-kit signer type (ethers vs viem/wagmi)

# Solana wallet stack (stretch):
npm add @solana/web3.js @solana/wallet-adapter-react   # ⚠️ VERIFY exact adapter pkgs

# S3 gateway I/O (server-side reads/serving, if used):
npm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**⚠️ VERIFY entry points** against the skill/docs before importing — Shelby uses
sub-path entries like `@shelby-protocol/sdk/browser`, `@shelby-protocol/ethereum-kit/node`,
`@shelby-protocol/ethereum-kit/react` (pattern confirmed for solana-kit; confirm the
ethereum-kit paths).

**Checkpoint 3:** `npm ls @shelby-protocol/ethereum-kit @shelby-protocol/sdk` resolves.
Record the exact installed **versions** in `NOTES.md` — docs may lag the package.

---

## Step 4 — Credentials, network, faucet

**[VERIFIED] API key.** Get a Shelby API key (format `AG-…`) to avoid rate limits; the
CLI will offer to store one, and the SDK/kits accept `apiKey`. See
`https://docs.shelby.xyz/sdks/typescript/acquire-api-keys`.

**[VERIFIED] Endpoints** (re-check `https://docs.shelby.xyz/protocol/architecture/networks`):

| | `testnet` | `shelbynet` (wiped ~weekly) |
|---|---|---|
| Shelby RPC | `https://api.testnet.shelby.xyz/shelby` | `https://api.shelbynet.shelby.xyz/shelby` |
| Aptos node | `https://api.testnet.aptoslabs.com/v1` | `https://api.shelbynet.shelby.xyz/v1` |
| Faucet | (see docs) | `https://faucet.shelbynet.shelby.xyz` |

**[VERIFIED] Fund a test account** from the faucet (the CLI prints the exact
`aptos account fund-with-faucet …` command after `shelby init`). The DAA-derived Aptos
account still needs gas — confirm the funding UX for a brand-new derived account
(**⚠️ VERIFY — this is a Day-1 blocker if unclear**, see `guides/01` Probe 2).

**Create `.env.local`** (never commit; see `guides/03-conventions.md` §2):

```
STORAGE_BACKEND=mock                 # mock | shelby-daa | shelby-gateway
SHELBY_API_KEY=AG-xxxxxxxx           # server only
SHELBY_NETWORK=testnet               # or shelbynet
SHELBY_RPC_URL=https://api.testnet.shelby.xyz/shelby
# Gateway (server only; if reads go through the gateway):
SHELBY_S3_ENDPOINT=
SHELBY_S3_KEY=
SHELBY_S3_SECRET=
SHELBY_S3_BUCKET=
NEXT_PUBLIC_IPFS_GATEWAY=https://ipfs.io/ipfs/
```

**Checkpoint 4:** API key stored server-side, a funded test account exists, endpoints
pinned in `.env.local`.

---

## Setup done — definition of ready

- [ ] Official `shelby/shelby-skills` installed/readable; `ethereum-kit` + `sdk` opened.
- [ ] `shelby --version` works; Aptos CLI available.
- [ ] `@shelby-protocol/{sdk,react,ethereum-kit}` installed; versions logged in `NOTES.md`.
- [ ] API key + funded test account + endpoints in `.env.local`.
- [ ] Every `⚠️ VERIFY` above either confirmed or explicitly noted as an open Day-1 item.

➡️ Now run **`guides/01-verification-first.md`** (the Day-1 kill checklist). Do not build
UI until its gates pass.
