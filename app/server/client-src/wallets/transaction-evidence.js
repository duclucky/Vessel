const evidenceError = (message, code) => Object.assign(new Error(message), { code });

const decimalString = (value, field) => {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed.toString();
  } catch {
    throw evidenceError(`Invalid ${field} in Shelby transaction`, 'invalid_transaction_evidence');
  }
};

export function extractShelbyTransactionEvidence(transaction) {
  if (!transaction || transaction.success !== true) {
    throw evidenceError('Shelby registration transaction failed', 'transaction_failed');
  }
  const event = (transaction.events || []).find((candidate) => (
    String(candidate?.type || '').endsWith('::blob_metadata::BlobRegisteredEvent')
    || String(candidate?.type || '').endsWith('::BlobRegisteredEvent')
  ));
  if (!event || event.data?.payment_amount == null) {
    throw evidenceError(
      'Shelby registration event is not available yet',
      'registration_evidence_missing',
    );
  }
  const transactionHash = String(transaction.hash || transaction.transaction_hash || '');
  if (!transactionHash) {
    throw evidenceError('Transaction hash is missing', 'invalid_transaction_evidence');
  }
  return Object.freeze({
    actualStorageUnits: decimalString(event.data.payment_amount, 'storage payment'),
    actualGasUsed: decimalString(transaction.gas_used, 'gas usage'),
    transactionHash,
  });
}
