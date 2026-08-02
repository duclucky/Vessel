# AGENTS.md

This file exists so **any** coding agent (Cursor, Copilot, Windsurf, etc.), not just
Claude Code, finds the entry point.

**Start here:** read **`CLAUDE.md`** in full — it is the operating manual for this
project (what we build, how to think, tool usage, scope guardrails). Then follow the
reading order it specifies (`knowledge/01–05`, then `guides/01–03`).

**Two hard rules before you write any Shelby code:**
1. Run **`guides/00-setup.md`** to install the official Shelby agent skills
   (`github.com/shelby/shelby-skills`), the CLI, and the SDK/kits — exact commands are
   there. Read the live docs at `https://docs.shelby.xyz`. The exact, current API lives in
   the skill + docs — **not** in this repo's markdown. Snippets here marked `⚠️ VERIFY`
   are shape only.
2. Complete `guides/01-verification-first.md` (the Day-1 kill checklist) **before**
   building UI. If a load-bearing assumption fails, stop and report a go/no-go.

**One-line project summary:** a demo that lets an existing Ethereum/Solana wallet
control decentralized *hot* storage on Shelby via Derived Account Abstraction (DAA), with
reads visibly faster than IPFS — built behind a swappable `StorageProvider` interface on
a testnet that is wiped weekly (so: demo, not product; record every working run).
