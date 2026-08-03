const CHAINS = new Set(['aptos', 'solana']);
const HEX_32 = /^[0-9a-f]{64}$/;

const receiptError = (message) => Object.assign(new Error(message), {
  code: 'invalid_settlement_receipt',
  status: 400,
  retriable: false,
});

const requiredText = (value, field) => {
  const text = String(value || '').trim();
  if (!text) throw receiptError(`${field} is required`);
  return text;
};

const bytes32Hex = (value, field) => {
  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!HEX_32.test(text)) throw receiptError(`${field} must be 32 bytes`);
  return text;
};

const positiveU64 = (value, field) => {
  let result;
  try {
    result = BigInt(value);
  } catch {
    throw receiptError(`${field} must be a u64`);
  }
  if (result <= 0n || result > 0xffff_ffff_ffff_ffffn) throw receiptError(`${field} is invalid`);
  return result.toString();
};

export function normalizeSettlementReceipt(input = {}) {
  const chain = String(input.chain || '').toLowerCase();
  if (!CHAINS.has(chain)) throw receiptError('Settlement receipt chain is unsupported');
  const network = Number(input.network);
  if (!Number.isSafeInteger(network) || network < 0 || network > 0xffff_ffff) {
    throw receiptError('Settlement receipt network is invalid');
  }
  const finalizedAtMs = Number(input.finalizedAtMs);
  if (!Number.isSafeInteger(finalizedAtMs) || finalizedAtMs <= 0) {
    throw receiptError('Settlement receipt finality time is invalid');
  }

  return Object.freeze({
    chain,
    network,
    deploymentId: requiredText(input.deploymentId, 'deploymentId'),
    quoteId: bytes32Hex(input.quoteId, 'quoteId'),
    payer: bytes32Hex(input.payer, 'payer'),
    storageAddress: bytes32Hex(input.storageAddress, 'storageAddress'),
    asset: bytes32Hex(input.asset, 'asset'),
    amount: positiveU64(input.amount, 'amount'),
    fileHash: bytes32Hex(input.fileHash, 'fileHash'),
    storageExpirationMicros: positiveU64(input.storageExpirationMicros, 'storageExpirationMicros'),
    transactionId: requiredText(input.transactionId, 'transactionId'),
    blockReference: requiredText(input.blockReference, 'blockReference'),
    finalizedAtMs,
    configVersion: positiveU64(input.configVersion, 'configVersion'),
  });
}

export function settlementReceiptError(message, status = 409) {
  return Object.assign(new Error(message), {
    code: 'settlement_receipt_mismatch',
    status,
    retriable: false,
  });
}
