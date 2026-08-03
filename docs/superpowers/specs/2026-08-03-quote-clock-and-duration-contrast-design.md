# Quote Clock and Custom Duration Contrast Design

## Objective

Unblock real uploads by making the public quote expose the same retention clock used to calculate its expiration, and restore readable dark-mode styling for the custom day input.

## Root Causes

- The server calculates `expirationMicros` from Shelby's pricing clock but exposes the web server issue time as `serverTimeMs`. The client independently reconstructs the expiration and rejects every quote when the clocks differ.
- Tailwind Forms injects a later `[type="number"]` rule with the same specificity as `.vessel-input`. It changes the input background to white while Vessel's light foreground remains active.

## Approved Design

### Quote clock

Derive the public `serverTimeMs` from the signed quote's `expirationMicros` and retention days. Keep `issuedAtMs` as the web server issue time and keep the existing client-side expiration equality check. This preserves the integrity check without changing the signed payload or settlement contracts.

### Custom duration input

Add an explicit `input.vessel-input` rule so Vessel's dark input surface wins over Tailwind Forms without `!important`. Retain the existing light foreground, cyan focus treatment, semantic label, numeric input type, and 1–365 validation. The resulting normal-size text must meet WCAG AA contrast of at least 4.5:1.

## Verification

- Add or retain a server regression test proving the public quote reports the clock used to calculate expiration.
- Add a stylesheet regression test proving number inputs receive the higher-specificity Vessel rule and no `!important` workaround.
- Run the server test suite and bundle check.
- Deploy Production, then use the user's Chrome session to verify readable custom values at 1 and 365 days and complete the upload flow as far as wallet/protocol state permits.

## Scope

Only the quote serialization, its regression test, Vessel input CSS, and a focused CSS regression test are in scope. Existing unrelated working-tree changes remain untouched.
