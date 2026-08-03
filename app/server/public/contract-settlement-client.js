const settlementError = (message, code, cause) => Object.assign(
  new Error(message, cause ? { cause } : undefined),
  { code, retriable: code === 'receipt_pending' },
);

async function defaultRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(result.error || response.statusText), result, {
      status: response.status,
    });
  }
  return result;
}

export async function settleContractQuote({
  quote,
  chainClient,
  request = defaultRequest,
  onSubmitted,
  transactionId,
}) {
  if (!quote?.contractQuote?.quoteId || !quote?.contractSignature) {
    throw settlementError('Signed contract quote is required', 'invalid_contract_quote');
  }

  let id = String(transactionId || '');
  if (!id) {
    if (typeof chainClient?.submit !== 'function') {
      throw settlementError('Reconnect the selected wallet', 'settlement_unavailable');
    }
    let submitted;
    try {
      submitted = await chainClient.submit({
        contractQuote: quote.contractQuote,
        contractSignature: quote.contractSignature,
      });
    } catch (error) {
      if (error?.code) throw error;
      const message = String(error?.message || error);
      if (/reject|denied|cancel/i.test(message)) {
        throw settlementError('Payment approval was rejected', 'user_rejected', error);
      }
      throw settlementError(message, 'settlement_submission_failed', error);
    }
    id = String(submitted?.transactionId || '');
    if (!id) {
      throw settlementError('Wallet did not return a transaction ID', 'settlement_submission_failed');
    }
    await onSubmitted?.({ quoteId: quote.contractQuote.quoteId, transactionId: id });
  }

  return request('/api/settlements/verify', {
    method: 'POST',
    body: {
      quoteToken: quote.quoteToken,
      uploadContext: quote.uploadContext,
      contractQuote: quote.contractQuote,
      contractSignature: quote.contractSignature,
      transactionId: id,
    },
  });
}
