import { createHash } from 'node:crypto';
import { Serializer } from '@aptos-labs/ts-sdk';

const DOMAIN = Buffer.from('VESSEL_SETTLEMENT_V1', 'ascii');
const HEX_32 = /^[0-9a-f]{64}$/;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;

const bytes32 = (value, field) => {
  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!HEX_32.test(text)) throw new TypeError(`${field} must be 32 bytes`);
  return Uint8Array.from(Buffer.from(text, 'hex'));
};

const positiveU64 = (value, field) => {
  let result;
  try {
    result = BigInt(value);
  } catch {
    throw new TypeError(`${field} must be a u64`);
  }
  if (result <= 0n || result > MAX_U64) throw new RangeError(`${field} is invalid`);
  return result;
};

export function normalizeQuoteV1(input = {}) {
  const quote = {
    version: Number(input.version),
    chain: Number(input.chain),
    network: Number(input.network),
    quoteId: bytes32(input.quoteId, 'quoteId'),
    payer: bytes32(input.payer, 'payer'),
    storageAddress: bytes32(input.storageAddress, 'storageAddress'),
    asset: bytes32(input.asset, 'asset'),
    amount: positiveU64(input.amount, 'amount'),
    fileHash: bytes32(input.fileHash, 'fileHash'),
    retentionDays: Number(input.retentionDays),
    storageExpirationMicros: positiveU64(input.storageExpirationMicros, 'storageExpirationMicros'),
    quoteExpiresAtSecs: positiveU64(input.quoteExpiresAtSecs, 'quoteExpiresAtSecs'),
    configVersion: positiveU64(input.configVersion, 'configVersion'),
  };

  if (
    quote.version !== 1
    || ![1, 2, 3].includes(quote.chain)
    || !Number.isSafeInteger(quote.network)
    || quote.network < 0
    || quote.network > 0xffff_ffff
    || !Number.isInteger(quote.retentionDays)
    || quote.retentionDays < 1
    || quote.retentionDays > 365
  ) {
    throw new RangeError('QuoteV1 field is invalid');
  }

  return Object.freeze(quote);
}

export function encodeQuoteV1(input) {
  const quote = normalizeQuoteV1(input);
  const serializer = new Serializer();
  serializer.serializeU8(quote.version);
  serializer.serializeU8(quote.chain);
  serializer.serializeU32(quote.network);
  serializer.serializeBytes(quote.quoteId);
  serializer.serializeBytes(quote.payer);
  serializer.serializeBytes(quote.storageAddress);
  serializer.serializeBytes(quote.asset);
  serializer.serializeU64(quote.amount);
  serializer.serializeBytes(quote.fileHash);
  serializer.serializeU16(quote.retentionDays);
  serializer.serializeU64(quote.storageExpirationMicros);
  serializer.serializeU64(quote.quoteExpiresAtSecs);
  serializer.serializeU64(quote.configVersion);
  return Buffer.from(serializer.toUint8Array());
}

export function quoteDigest(input) {
  return createHash('sha256').update(DOMAIN).update(encodeQuoteV1(input)).digest();
}

export function quoteIdHex(input) {
  return Buffer.from(normalizeQuoteV1(input).quoteId).toString('hex');
}
