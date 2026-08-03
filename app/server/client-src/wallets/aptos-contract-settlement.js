const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;

const settlementError = (message, code = 'invalid_contract_settlement') => Object.assign(
  new Error(message),
  { code, retriable: false },
);

function aptosAddressHex(value) {
  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{1,64}$/.test(text)) {
    throw settlementError('Invalid Aptos payer address', 'settlement_context_mismatch');
  }
  return text.padStart(64, '0');
}

function hexBytes(value, expectedPattern = HEX_32) {
  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!expectedPattern.test(text)) throw settlementError('Invalid signed settlement bytes');
  return Uint8Array.from(text.match(/../g).map((byte) => Number.parseInt(byte, 16)));
}

export async function submitAptosContractSettlement({
  adapter,
  session,
  deployment,
  contractQuote: quote,
  contractSignature,
}) {
  if (session?.chain !== 'aptos' || aptosAddressHex(session?.sourceAddress) !== String(quote?.payer || '')) {
    throw settlementError(
      'The connected Aptos account no longer matches this quote',
      'settlement_context_mismatch',
    );
  }
  const moduleAddress = String(deployment?.moduleAddress || '').toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(moduleAddress) || /^0x0+$/.test(moduleAddress)) {
    throw settlementError('Vessel Aptos settlement contract is not deployed', 'settlement_unavailable');
  }
  if (typeof adapter?.signAndSubmitTransaction !== 'function') {
    throw settlementError('Reconnect the selected Aptos wallet', 'settlement_unavailable');
  }

  const signature = hexBytes(contractSignature, HEX_64);
  const data = {
    function: `${moduleAddress}::vessel_settlement::settle`,
    typeArguments: ['0x1::fungible_asset::Metadata'],
    functionArguments: [
      `0x${quote.asset}`,
      quote.version,
      quote.chain,
      quote.network,
      hexBytes(quote.quoteId),
      hexBytes(quote.payer),
      hexBytes(quote.storageAddress),
      hexBytes(quote.asset),
      String(quote.amount),
      hexBytes(quote.fileHash),
      quote.retentionDays,
      String(quote.storageExpirationMicros),
      String(quote.quoteExpiresAtSecs),
      String(quote.configVersion),
      signature,
    ],
  };
  const submitted = await adapter.signAndSubmitTransaction({ data });
  const transactionId = String(submitted?.hash || '');
  if (!transactionId) {
    throw settlementError('Aptos wallet did not return a transaction hash', 'settlement_submission_failed');
  }
  return Object.freeze({ transactionId });
}
