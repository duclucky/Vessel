# Vessel Solana fee receipt program

Anchor program for quote-verified Devnet USDC Vessel fee receipts into a
PDA-controlled vault. A receipt PDA at `['receipt', quote_id]` makes every quote
single-use.

The program does not store Shelby bytes and does not implement Shelby DAA. The
browser uses the official Shelby Solana bridge for the storage identity, then
this program records the source-chain Vessel charge.

## Governance and deployment

Production-like beta deployment is intentionally fail-closed:

- Squads v4 must be autonomous (`configAuthority = null`).
- Exactly three distinct members have initiate, vote, and execute permissions.
- Threshold is 2. Devnet beta uses a zero native Squads timelock so the demo can
  be initialized immediately; sensitive program configuration changes retain
  the program's own 24-hour schedule/execute delay.
- `Config.authority` and the Program upgrade authority must both resolve to the
  verified Squads vault PDA before the webapp is enabled.
- No member private key is read by repository scripts.

Generate and inspect public payloads from `app/server`:

```text
node scripts/solana-squads-setup.mjs derive
node scripts/solana-squads-setup.mjs create-payload
node scripts/solana-squads-setup.mjs program-authority-payload
node scripts/solana-squads-setup.mjs verify
```

Required public environment values are `SOLANA_SQUADS_MEMBERS` (three
comma-separated keys), `SOLANA_SQUADS_CREATE_KEY`, `SOLANA_SQUADS_CREATOR`,
and `SOLANA_PROGRAM_ID`. `SOLANA_SQUADS_TREASURY` must match the treasury in
the Squads v4 on-chain ProgramConfig; the setup script fails closed on any
operator-supplied recipient.
Authority transfer additionally requires the current authority's public key in
`SOLANA_CURRENT_UPGRADE_AUTHORITY`.

Do not write deployment addresses to
`deployments/vessel-settlement.testnet.json` until both the Squads account and
Program authority pass `verify` at finalized commitment.
