import { PublicKey } from '@solana/web3.js';
import { normalizeSettlementReceipt } from './receipt.js';

const RECEIPT_DISCRIMINATOR = Buffer.from([26, 164, 173, 120, 100, 37, 178, 163]);
const RECEIPT_LENGTH = 208;

const pendingError = () => Object.assign(new Error('Settlement receipt is not finalized yet'), {
  code: 'receipt_pending',
  status: 409,
  retriable: true,
});

const receiptError = (message) => Object.assign(new Error(message), {
  code: 'invalid_settlement_receipt',
  status: 402,
  retriable: false,
});

function requiredPublicKey(value, field) {
  try {
    return new PublicKey(String(value || ''));
  } catch {
    throw new TypeError(`${field} must be a Solana public key`);
  }
}

function bytes32Hex(bytes, field) {
  const hex = Buffer.from(bytes || []).toString('hex');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw receiptError(`Solana receipt ${field} must be 32 bytes`);
  return hex;
}

function decodeReceipt(data) {
  const bytes = Buffer.from(data || []);
  if (
    bytes.length !== RECEIPT_LENGTH
    || !bytes.subarray(0, 8).equals(RECEIPT_DISCRIMINATOR)
  ) {
    throw receiptError('Solana receipt account has the wrong discriminator or size');
  }
  return Object.freeze({
    quoteId: bytes32Hex(bytes.subarray(8, 40), 'quote ID'),
    payer: new PublicKey(bytes.subarray(40, 72)),
    storageAddress: bytes32Hex(bytes.subarray(72, 104), 'storage address'),
    asset: new PublicKey(bytes.subarray(104, 136)),
    amount: bytes.readBigUInt64LE(136),
    fileHash: bytes32Hex(bytes.subarray(144, 176), 'file hash'),
    storageExpirationMicros: bytes.readBigUInt64LE(176),
    configVersion: bytes.readBigUInt64LE(184),
    settledSlot: bytes.readBigUInt64LE(192),
    settledAtSecs: bytes.readBigInt64LE(200),
  });
}

function keyText(value) {
  const key = value?.pubkey ?? value;
  try {
    return new PublicKey(key).toBase58();
  } catch {
    return '';
  }
}

function transactionKeys(transaction) {
  const message = transaction?.transaction?.message;
  const base = message?.accountKeys || message?.staticAccountKeys || [];
  const loaded = transaction?.meta?.loadedAddresses;
  return [
    ...base,
    ...(loaded?.writable || []),
    ...(loaded?.readonly || []),
  ].map(keyText);
}

function includesProgram(transaction, programId, keys) {
  const instructions = transaction?.transaction?.message?.instructions
    || transaction?.transaction?.message?.compiledInstructions
    || [];
  return instructions.some((instruction) => {
    if (instruction?.programId) return keyText(instruction.programId) === programId;
    return keys[Number(instruction?.programIdIndex)] === programId;
  });
}

function tokenAmount(rows, accountIndex, mint) {
  const matches = (rows || []).filter((row) => (
    Number(row?.accountIndex) === accountIndex && String(row?.mint) === mint
  ));
  if (matches.length !== 1 || !/^\d+$/.test(String(matches[0]?.uiTokenAmount?.amount || ''))) {
    throw receiptError('Solana transaction is missing the canonical vault token balance');
  }
  return BigInt(matches[0].uiTokenAmount.amount);
}

export class SolanaSettlementAdapter {
  constructor({ connection, programId, vaultAta, acceptedMint, network = 1 }) {
    if (
      typeof connection?.getTransaction !== 'function'
      || typeof connection?.getAccountInfo !== 'function'
    ) {
      throw new TypeError('Solana connection is required');
    }
    this.connection = connection;
    this.programId = requiredPublicKey(programId, 'Program ID');
    this.vaultAta = requiredPublicKey(vaultAta, 'Vault ATA');
    this.acceptedMint = requiredPublicKey(acceptedMint, 'Accepted mint');
    this.network = Number(network);
    this.deploymentId = this.programId.toBase58();
  }

  async verify({ quote, transactionId }) {
    const signedQuote = quote?.contractQuote || quote;
    const signature = String(transactionId || '');
    if (!signature || !signedQuote) throw receiptError('Solana transaction and signed quote are required');

    let transaction;
    try {
      transaction = await this.connection.getTransaction(signature, {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      transaction = null;
    }
    if (!transaction) throw pendingError();
    if (transaction.meta?.err || !transaction.meta) {
      throw receiptError('Solana settlement transaction failed');
    }
    if (!transaction.transaction?.signatures?.map(String).includes(signature)) {
      throw receiptError('Solana transaction signature does not match the submitted evidence');
    }

    const keys = transactionKeys(transaction);
    if (!includesProgram(transaction, this.deploymentId, keys)) {
      throw receiptError('Solana transaction did not invoke the Vessel Program');
    }
    const quoteId = Buffer.from(String(signedQuote.quoteId || ''), 'hex');
    if (quoteId.length !== 32) throw receiptError('Solana quote ID must be 32 bytes');
    const [receiptPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('receipt'), quoteId],
      this.programId,
    );
    const receiptIndex = keys.indexOf(receiptPda.toBase58());
    const vaultIndex = keys.indexOf(this.vaultAta.toBase58());
    if (receiptIndex < 0 || vaultIndex < 0) {
      throw receiptError('Solana transaction does not include the canonical receipt and vault');
    }
    const signerCount = Number(transaction.transaction.message?.header?.numRequiredSignatures || 0);
    const expectedPayer = new PublicKey(Buffer.from(String(signedQuote.payer || ''), 'hex')).toBase58();
    if (!keys.slice(0, signerCount).includes(expectedPayer)) {
      throw receiptError('Solana quote payer did not sign the settlement transaction');
    }

    let accountInfo;
    try {
      accountInfo = await this.connection.getAccountInfo(receiptPda, { commitment: 'finalized' });
    } catch {
      accountInfo = null;
    }
    if (!accountInfo) throw pendingError();
    if (keyText(accountInfo.owner) !== this.deploymentId) {
      throw receiptError('Solana receipt PDA is not owned by the Vessel Program');
    }
    const decoded = decodeReceipt(accountInfo.data);

    const mint = this.acceptedMint.toBase58();
    const preAmount = tokenAmount(transaction.meta.preTokenBalances, vaultIndex, mint);
    const postAmount = tokenAmount(transaction.meta.postTokenBalances, vaultIndex, mint);
    if (postAmount < preAmount || postAmount - preAmount !== decoded.amount) {
      throw receiptError('Solana settlement did not deposit the exact amount into the Vessel vault');
    }

    const finalizedAtMs = Number(
      transaction.blockTime == null
        ? decoded.settledAtSecs * 1_000n
        : BigInt(transaction.blockTime) * 1_000n,
    );
    const receipt = normalizeSettlementReceipt({
      chain: 'solana',
      network: this.network,
      deploymentId: this.deploymentId,
      quoteId: decoded.quoteId,
      payer: Buffer.from(decoded.payer.toBytes()).toString('hex'),
      storageAddress: decoded.storageAddress,
      asset: Buffer.from(decoded.asset.toBytes()).toString('hex'),
      amount: decoded.amount.toString(),
      fileHash: decoded.fileHash,
      storageExpirationMicros: decoded.storageExpirationMicros.toString(),
      transactionId: signature,
      blockReference: String(transaction.slot),
      finalizedAtMs,
      configVersion: decoded.configVersion.toString(),
    });
    const expected = [
      ['network', signedQuote.network],
      ['quoteId', signedQuote.quoteId],
      ['payer', signedQuote.payer],
      ['storageAddress', signedQuote.storageAddress],
      ['asset', signedQuote.asset],
      ['amount', signedQuote.amount],
      ['fileHash', signedQuote.fileHash],
      ['storageExpirationMicros', signedQuote.storageExpirationMicros],
      ['configVersion', signedQuote.configVersion],
    ];
    if (Number(signedQuote.chain) !== 2 || Number(signedQuote.network) !== this.network) {
      throw receiptError('Solana receipt domain does not match the signed quote');
    }
    for (const [field, value] of expected) {
      if (String(receipt[field]).toLowerCase() !== String(value).toLowerCase()) {
        throw receiptError(`Solana receipt ${field} does not match the signed quote`);
      }
    }
    return receipt;
  }
}
