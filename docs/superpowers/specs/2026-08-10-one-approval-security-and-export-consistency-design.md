# One-Approval Security and Export Consistency Design

## Goal

Keep Vessel's one-approval upload experience while making the approval cryptographically meaningful on Aptos, Solana, and EVM. Also make batch TokenURI manifests and the single spreadsheet export behave consistently for nested collection paths.

## Current Failures

Production testing demonstrated three defects:

- The one-approval server route accepts any non-empty signature string after checking only message markers. It does not verify that the connected wallet signed the authorization.
- Batch metadata hosting succeeds, but collection manifest generation can lose every TokenURI when hosted results use a nested `sourcePath` and generated metadata uses a basename such as `1.json`.
- The collection page says CSV while the application generates a styled XLSX workbook.

## Decision

### Strict wallet authorization

Use a shared canonical session-message builder for the browser and server. The server reconstructs the expected message from the validated signed quote, upload context, and optional batch manifest. It requires exact equality instead of substring checks.

The browser sends two distinct fields:

- `message`: the canonical Vessel session message shown for approval.
- `signedMessage`: the exact bytes or text that the wallet signed.

The server verifies each chain with its native signature rules:

- Aptos: verify the Ed25519 signature over the Aptos wallet-standard full message, verify the full message contains the exact canonical Vessel message and fixed nonce, and bind the public key to the source account authentication key.
- Solana: decode the base64 signature, decode the source wallet's base58 public key, and verify Ed25519 over the UTF-8 canonical message.
- EVM: recover the signer with `verifyMessage` and require it to equal the quoted source address.

Malformed encodings, missing signed-message evidence, unsupported chains, address mismatches, changed messages, changed manifests, expired quotes, and invalid signatures fail closed with `invalid_upload_authorization`. Legacy non-cryptographic approvals are not accepted.

## Module Boundaries

- `public/one-approval-session.js` owns canonical single and batch message construction and Aptos full-message validation rules that are safe to share with browser code.
- `src/one-approval-authorization.js` owns Node-side chain-specific cryptographic verification and account binding.
- Wallet adapters preserve the exact signed payload and normalize signatures without changing their bytes.
- Upload routes await the verifier only after quote, context, file, and manifest integrity checks pass.

No private key, seed phrase, Shelby API key, or gas-station key is sent to the browser or logged.

## Batch TokenURI Mapping

Normalize all manifest and hosted-result paths to forward-slash relative paths. Index hosted results by both normalized full path and basename.

Basename fallback is allowed only when that basename is unique. If two hosted results share the same basename, the fallback is ambiguous and must not silently attach the wrong TokenURI. Exact normalized path always wins.

## Export Format

Use XLSX as the only manifest spreadsheet format because the requested colors, fonts, sizing, and header styling cannot be represented in CSV.

All UI labels use `Export manifest XLSX` or `Export Styled XLSX`. Downloads use the `.xlsx` extension and the OpenXML spreadsheet MIME type. No parallel CSV download is added.

## Error Handling

- Invalid wallet authorization returns HTTP 401 with `invalid_upload_authorization` and does not call Shelby storage.
- File or manifest mutations continue to return HTTP 409 before signature verification.
- TokenURI mapping omissions remain visible in the manifest rather than being replaced with a fabricated URL.
- Export generation fails visibly if the workbook cannot be constructed.

## Testing Strategy

Use test-driven development with separate red-green checkpoints:

1. A forged non-empty authorization must fail for Aptos, Solana, and EVM.
2. Valid signatures for all three chains must pass, while changed message, wallet, quote, or signature inputs fail.
3. Single and batch routes must not invoke storage after authorization rejection.
4. Nested hosted metadata paths must produce complete TokenURI manifests; ambiguous basename collisions must not cross-link.
5. Collection and Gallery export labels, extensions, and MIME type must all identify XLSX.
6. Run focused tests, full `npm run check`, production configuration checks, and authorized testnet smoke checks before deployment.

## Rollout

1. Deploy the strict verifier and client evidence format together so no production request uses a mixed protocol version.
2. Refresh browser bundles as part of the same build.
3. Verify one real approval per supported wallet family on testnet.
4. Confirm forged authorization receives 401 and produces no new Shelby artifact.
5. Verify a nested two-item metadata collection exports two TokenURIs in one styled XLSX workbook.

## Acceptance Criteria

- A fake non-empty signature cannot upload a file or batch.
- Valid Aptos, Solana, and EVM wallet approvals remain one user signature each.
- The canonical message is bound to wallet, chain, quote, file or manifest hash, size, retention, expiration, and maximum accounting amount.
- Nested batch metadata produces one TokenURI per successfully hosted JSON item.
- Export UI and downloaded file consistently use XLSX only.
- Full tests and client build pass with no secret or generated-file drift.
