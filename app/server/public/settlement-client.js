const settlementError = (message, code, cause) => Object.assign(
  new Error(message, cause ? { cause } : undefined),
  { code },
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

const sameAddress = (chain, left, right) => (
  chain === 'aptos'
    ? String(left || '').toLowerCase() === String(right || '').toLowerCase()
    : String(left || '') === String(right || '')
);

export async function settleQuote({
  quote,
  session,
  aptosAdapter,
  solanaClient,
  request = defaultRequest,
}) {
  if (
    !quote?.chain
    || quote.chain !== session?.chain
    || !sameAddress(quote.chain, quote.sourceAddress, session.sourceAddress)
  ) {
    throw settlementError(
      'The connected account no longer matches this quote',
      'settlement_context_mismatch',
    );
  }

  try {
    if (quote.chain === 'solana') {
      if (!solanaClient?.payUSDC) {
        throw settlementError('Reconnect the selected Solana account', 'settlement_unavailable');
      }
      const payment = await solanaClient.payUSDC({
        treasuryAta: quote.treasuryAta,
        amountMicro: quote.solanaAmountMicro,
        memo: quote.quoteId,
        usdcMint: quote.usdcMint,
        expectedSourceAddress: quote.sourceAddress,
      });
      const verified = await request('/api/pay/solana/verify', {
        method: 'POST',
        body: { quoteToken: quote.quoteToken, signature: payment.signature },
      });
      if (!verified?.paidAuthorization) {
        throw settlementError('Solana payment was not verified', 'settlement_verification_failed');
      }
      return Object.freeze({
        paidAuthorization: verified.paidAuthorization,
        settlementHash: verified.settlementHash,
      });
    }

    if (quote.chain === 'aptos') {
      const amount = BigInt(quote.nativeServiceFeeShelbyUsdUnits || 0);
      let transactionHash = '';
      if (amount > 0n) {
        if (!aptosAdapter?.signAndSubmitTransaction) {
          throw settlementError('Reconnect the selected Aptos account', 'settlement_unavailable');
        }
        const submitted = await aptosAdapter.signAndSubmitTransaction({
          data: {
            function: '0x1::primary_fungible_store::transfer',
            functionArguments: [
              quote.shelbyUsdAssetAddress,
              quote.aptosTreasuryAddress,
              amount.toString(),
            ],
          },
        });
        transactionHash = String(submitted?.hash || '');
        if (!transactionHash) {
          throw settlementError('Aptos did not return a transaction hash', 'settlement_submission_failed');
        }
      }
      const verified = await request('/api/pay/aptos/verify', {
        method: 'POST',
        body: { quoteToken: quote.quoteToken, transactionHash },
      });
      if (!verified?.paidAuthorization) {
        throw settlementError('Aptos payment was not verified', 'settlement_verification_failed');
      }
      return Object.freeze({
        paidAuthorization: verified.paidAuthorization,
        settlementHash: verified.settlementHash,
      });
    }

    throw settlementError('Unsupported settlement chain', 'settlement_unavailable');
  } catch (error) {
    if (error?.code) throw error;
    const message = String(error?.message || error);
    if (/reject|denied|cancel/i.test(message)) {
      throw settlementError('Payment approval was rejected', 'user_rejected', error);
    }
    throw settlementError(message, 'settlement_verification_failed', error);
  }
}
