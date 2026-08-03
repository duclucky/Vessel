const accessError = (message, code = 'invalid_paid_authorization', status = 401) => Object.assign(
  new Error(message),
  { code, status, retriable: false },
);

export function validatePaidUploadAuthorization({
  quoteManager,
  paidAuthorizations,
  settlementDeployments,
  verifyContractQuoteSignature,
  assertContractQuoteMatchesContext,
  quoteToken,
  uploadContext,
  paidAuthorization,
  contractQuote,
  contractSignature,
}) {
  if (!quoteManager || !paidAuthorizations) {
    throw accessError('Paid uploads are unavailable', 'paid_authorization_unavailable', 503);
  }
  const signedQuote = quoteManager.validate(quoteToken, uploadContext, { allowExpired: true });
  if (!settlementDeployments?.enabled) {
    paidAuthorizations.validate(paidAuthorization, signedQuote);
    return Object.freeze({ signedQuote, contractEvidence: null });
  }

  if (!contractQuote || !contractSignature) {
    throw accessError('Signed contract quote is required', 'invalid_contract_quote', 401);
  }
  const contractEvidence = Object.freeze({
    quoteToken,
    uploadContext: signedQuote.context,
    contractQuote,
    contractSignature,
    quotePublicKey: settlementDeployments.quotePublicKey,
  });
  if (!verifyContractQuoteSignature(contractEvidence)) {
    throw accessError('Invalid Vessel contract quote signature', 'invalid_contract_quote', 401);
  }
  assertContractQuoteMatchesContext(contractQuote, signedQuote, settlementDeployments);
  paidAuthorizations.validate(paidAuthorization, contractEvidence);
  return Object.freeze({ signedQuote, contractEvidence });
}
