import crypto from 'node:crypto';
import { normalizeRetentionDays } from '../../public/retention.js';

const QUOTE_PREFIX = 'vquote';
const QUOTE_TTL_MS = 5 * 60_000;
const RETENTION_DAY_MS = 86_400_000;
const HEX_64 = /^[0-9a-f]{64}$/;
const CHAINS = new Set(['aptos', 'solana', 'evm']);

const quoteError = (message, code = 'invalid_quote', status = 400) => Object.assign(
  new Error(message),
  { code, status, retriable: false },
);

const requiredText = (value, field) => {
  const result = String(value || '').trim();
  if (!result) throw quoteError(`${field} is required`, 'invalid_quote_context');
  return result;
};

const normalizeAptosLikeAddress = (value, field) => {
  const result = requiredText(value, field).toLowerCase();
  const hex = result.replace(/^@/, '').replace(/^0x/, '');
  if ((result.startsWith('@') || result.startsWith('0x')) && /^[0-9a-f]{1,64}$/.test(hex)) {
    return `0x${hex}`;
  }
  return result;
};

const safePositiveInteger = (value, field) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw quoteError(`${field} must be a positive integer`, 'invalid_quote_context');
  }
  return result;
};

const safeNonNegativeInteger = (value, field) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw quoteError(`${field} must be a non-negative integer`, 'invalid_quote_context');
  }
  return result;
};

export function normalizeUploadQuoteContext(input = {}) {
  const operation = input.operation == null ? 'upload' : String(input.operation);
  if (operation !== 'upload') {
    throw quoteError('Only upload quote context is supported', 'invalid_quote_context');
  }
  const chain = String(input.chain || '').toLowerCase();
  if (!CHAINS.has(chain)) throw quoteError('Unsupported wallet chain', 'invalid_quote_context');
  const fileHash = String(input.fileHash || '').toLowerCase();
  if (!HEX_64.test(fileHash)) {
    throw quoteError('Invalid SHA-256 file hash', 'invalid_quote_context');
  }
  const days = normalizeRetentionDays(input.days);
  const expirationMicros = safePositiveInteger(input.expirationMicros, 'expirationMicros');
  const sourceNetwork = requiredText(
    input.sourceNetwork || (chain === 'aptos'
      ? 'aptos-testnet'
      : chain === 'evm' ? 'sepolia' : 'solana-devnet'),
    'sourceNetwork',
  );

  return Object.freeze({
    operation: 'upload',
    chain,
    sourceNetwork,
    storageNetwork: requiredText(input.storageNetwork || 'shelby-testnet', 'storageNetwork'),
    sourceAddress: chain === 'aptos'
      ? normalizeAptosLikeAddress(input.sourceAddress, 'sourceAddress')
      : requiredText(input.sourceAddress, 'sourceAddress'),
    storageAddress: normalizeAptosLikeAddress(input.storageAddress, 'storageAddress'),
    fileHash,
    blobName: requiredText(input.blobName, 'blobName'),
    sizeBytes: safePositiveInteger(input.sizeBytes, 'sizeBytes'),
    contentType: String(input.contentType || 'application/octet-stream'),
    encoding: safeNonNegativeInteger(input.encoding, 'encoding'),
    days,
    expirationMicros,
  });
}

const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');
const canonicalContext = (context) => JSON.stringify(normalizeUploadQuoteContext(context));
const settlementNetworkName = (context) => {
  if (context.chain === 'solana') return 'Solana Devnet';
  if (context.chain === 'evm') return 'Ethereum Sepolia';
  return String(context.sourceNetwork || '').toLowerCase() === 'shelbynet'
    ? 'ShelbyNet'
    : 'Aptos Testnet';
};

function contextToPayload(context) {
  return {
    op: context.operation,
    ch: context.chain,
    sn: context.sourceNetwork,
    tn: context.storageNetwork,
    sw: context.sourceAddress,
    sa: context.storageAddress,
    fh: context.fileHash,
    bn: context.blobName,
    sz: context.sizeBytes,
    ct: context.contentType,
    en: context.encoding,
    dy: context.days,
    ex: context.expirationMicros,
  };
}

function payloadToContext(payload) {
  return normalizeUploadQuoteContext({
    operation: payload.op,
    chain: payload.ch,
    sourceNetwork: payload.sn,
    storageNetwork: payload.tn,
    sourceAddress: payload.sw,
    storageAddress: payload.sa,
    fileHash: payload.fh,
    blobName: payload.bn,
    sizeBytes: payload.sz,
    contentType: payload.ct,
    encoding: payload.en,
    days: payload.dy,
    expirationMicros: payload.ex,
  });
}

function publicQuote({ token, payload, context }) {
  const breakdown = payload.br;
  const aptos = context.chain === 'aptos';
  const solana = context.chain === 'solana';
  const serviceFeeUnits = (BigInt(breakdown.serviceFeeAccountingMicro) * 100n).toString();
  return Object.freeze({
    quoteId: payload.qid,
    quoteToken: token,
    operation: 'upload',
    chain: context.chain,
    sourceNetwork: context.sourceNetwork,
    storageNetwork: context.storageNetwork,
    sourceAddress: context.sourceAddress,
    storageAddress: context.storageAddress,
    fileHash: context.fileHash,
    blobName: context.blobName,
    sizeBytes: context.sizeBytes,
    contentType: context.contentType,
    encoding: context.encoding,
    days: context.days,
    expirationMicros: context.expirationMicros,
    targetExpirationUtc: new Date(context.expirationMicros / 1_000).toISOString(),
    issuedAtMs: payload.iat,
    expiresAtMs: payload.exp,
    serverTimeMs: Math.trunc(context.expirationMicros / 1_000) - context.days * RETENTION_DAY_MS,
    settlementToken: aptos ? 'APT + ShelbyUSD' : solana ? 'Devnet USDC' : 'Sepolia ETH',
    settlementNetwork: settlementNetworkName(context),
    solanaAmountMicro: solana ? breakdown.totalAccountingMicro : '0',
    evmAmountWei: context.chain === 'evm' ? breakdown.serviceFeeAccountingMicro : '0',
    nativeServiceFeeShelbyUsdUnits: aptos ? serviceFeeUnits : '0',
    notice: 'Test tokens — no real monetary value',
    ...breakdown,
  });
}

export class QuoteManager {
  constructor({
    secret,
    now = Date.now,
    quoteTtlMs = QUOTE_TTL_MS,
    priceUpload,
    contractQuoteManager = null,
    environment = process.env.NODE_ENV || 'development',
  }) {
    const secretText = String(secret || '');
    if (!secretText || (environment === 'production' && Buffer.byteLength(secretText) < 32)) {
      throw new Error('PAY_SECRET must contain at least 32 bytes in production');
    }
    if (typeof priceUpload !== 'function') throw new TypeError('priceUpload callback is required');
    this.secret = Buffer.from(secretText);
    this.now = now;
    this.quoteTtlMs = quoteTtlMs;
    this.priceUpload = priceUpload;
    if (
      contractQuoteManager != null
      && typeof contractQuoteManager.issueUploadFromBreakdown !== 'function'
    ) {
      throw new TypeError('contractQuoteManager must issue precomputed contract quotes');
    }
    this.contractQuoteManager = contractQuoteManager;
  }

  static forTest({ secret = 'vessel-test-secret-at-least-32-bytes', now = Date.now, pricing }) {
    return new QuoteManager({
      secret,
      now,
      priceUpload: pricing,
      environment: 'test',
    });
  }

  signPayload(encodedPayload) {
    return crypto.createHmac('sha256', this.secret)
      .update(`${QUOTE_PREFIX}.${encodedPayload}`)
      .digest('base64url');
  }

  async issueUpload(input) {
    const context = normalizeUploadQuoteContext(input);
    const breakdown = await this.priceUpload(context);
    const issuedAtMs = this.now();
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
      throw new TypeError('Invalid quote clock');
    }
    const contextJson = canonicalContext(context);
    const quoteId = crypto.createHash('sha256')
      .update(`${contextJson}:${issuedAtMs}`)
      .digest('hex')
      .slice(0, 24);
    const payload = {
      v: 1,
      ...contextToPayload(context),
      br: breakdown,
      iat: issuedAtMs,
      exp: issuedAtMs + this.quoteTtlMs,
      qid: quoteId,
    };
    const encodedPayload = encode(JSON.stringify(payload));
    const token = `${QUOTE_PREFIX}.${encodedPayload}.${this.signPayload(encodedPayload)}`;
    const serverQuote = publicQuote({ token, payload, context });
    if (!this.contractQuoteManager) return serverQuote;
    const contractEvidence = await this.contractQuoteManager.issueUploadFromBreakdown(
      context,
      breakdown,
    );
    return Object.freeze({ ...serverQuote, ...contractEvidence });
  }

  validate(token, expectedContext, { allowExpired = false } = {}) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3 || parts[0] !== QUOTE_PREFIX) throw new Error();
      const expectedSignature = Buffer.from(this.signPayload(parts[1]));
      const actualSignature = Buffer.from(parts[2]);
      if (
        expectedSignature.length !== actualSignature.length
        || !crypto.timingSafeEqual(expectedSignature, actualSignature)
      ) {
        throw new Error();
      }
      const payload = JSON.parse(decode(parts[1]));
      if (payload.v !== 1 || payload.op !== 'upload') throw new Error();
      const context = payloadToContext(payload);
      if (expectedContext != null) {
        const normalizedExpected = normalizeUploadQuoteContext(expectedContext);
        if (canonicalContext(context) !== canonicalContext(normalizedExpected)) {
          throw quoteError('Quote context does not match this wallet or file', 'quote_context_mismatch', 409);
        }
      }
      if (!allowExpired && this.now() >= payload.exp) {
        throw quoteError('Quote expired', 'quote_expired', 410);
      }
      if (!payload.br || !payload.qid || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) {
        throw new Error();
      }
      return Object.freeze({
        quoteId: payload.qid,
        quoteToken: token,
        context,
        breakdown: Object.freeze({ ...payload.br }),
        issuedAtMs: payload.iat,
        expiresAtMs: payload.exp,
      });
    } catch (error) {
      if (error?.code) throw error;
      throw quoteError('Invalid quote token', 'invalid_quote', 401);
    }
  }
}
