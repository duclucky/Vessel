import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePaidUploadAuthorization } from '../src/lib/paid-upload-access.js';

test('contract paid authorization is validated against the same signed contract evidence', () => {
  const calls = [];
  const signedQuote = { quoteId: 'server-quote', context: { storageAddress: '0xdaa' } };
  const result = validatePaidUploadAuthorization({
    quoteManager: {
      validate(token, context, options) {
        calls.push(['quote', token, context, options]);
        return signedQuote;
      },
    },
    paidAuthorizations: {
      validate(token, evidence) {
        calls.push(['paid', token, evidence]);
      },
    },
    settlementDeployments: { enabled: true, quotePublicKey: 'public-key' },
    verifyContractQuoteSignature: (evidence) => {
      calls.push(['signature', evidence]);
      return true;
    },
    assertContractQuoteMatchesContext: (contractQuote, quote, deployments) => {
      calls.push(['match', contractQuote, quote, deployments]);
    },
    quoteToken: 'vquote.signed',
    uploadContext: { storageAddress: '0xdaa' },
    paidAuthorization: 'vpaid.signed',
    contractQuote: { quoteId: 'contract-quote' },
    contractSignature: 'signature',
  });

  assert.equal(result.signedQuote, signedQuote);
  assert.equal(result.contractEvidence.quotePublicKey, 'public-key');
  assert.equal(calls.find(([type]) => type === 'paid')[2], result.contractEvidence);
  assert.equal(calls.find(([type]) => type === 'quote')[3].allowExpired, true);
});

test('contract paid authorization refuses missing or invalid contract evidence', () => {
  const base = {
    quoteManager: { validate: () => ({ context: { storageAddress: '0xdaa' } }) },
    paidAuthorizations: { validate: () => assert.fail('must not validate an incomplete receipt') },
    settlementDeployments: { enabled: true, quotePublicKey: 'public-key' },
    verifyContractQuoteSignature: () => false,
    assertContractQuoteMatchesContext: () => {},
    quoteToken: 'vquote.signed',
    uploadContext: { storageAddress: '0xdaa' },
    paidAuthorization: 'vpaid.signed',
  };
  assert.throws(
    () => validatePaidUploadAuthorization(base),
    (error) => error.code === 'invalid_contract_quote',
  );
  assert.throws(
    () => validatePaidUploadAuthorization({
      ...base,
      contractQuote: { quoteId: 'contract-quote' },
      contractSignature: 'bad-signature',
    }),
    (error) => error.code === 'invalid_contract_quote',
  );
});
