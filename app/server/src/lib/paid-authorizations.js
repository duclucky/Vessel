import crypto from 'node:crypto';
import { quoteDigest } from './settlement/quote-v1.js';
import { normalizeSettlementReceipt } from './settlement/receipt.js';

const PREFIX = 'vpaid';
const TTL_MS = 24 * 60 * 60_000;
const CHAIN_NUMBER = Object.freeze({ aptos: 1, solana: 2 });

const paidError = (message, code = 'invalid_paid_authorization', status = 401) => Object.assign(
  new Error(message),
  { code, status, retriable: false },
);

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const contextDigest = (context) => digest(JSON.stringify(context));
const normalizedReceiptDigest = (receipt) => digest(JSON.stringify(normalizeSettlementReceipt(receipt)));

function contractQuoteFrom(value) {
  const result = value?.contractQuote;
  if (!result) throw paidError('Signed contract quote is required', 'invalid_settlement', 400);
  return result;
}

function assertReceiptMatchesQuote(receiptInput, quoteInput) {
  const receipt = normalizeSettlementReceipt(receiptInput);
  const quote = contractQuoteFrom(quoteInput);
  const expectedChain = CHAIN_NUMBER[receipt.chain];
  const comparisons = [
    ['network', quote.network],
    ['quoteId', quote.quoteId],
    ['payer', quote.payer],
    ['storageAddress', quote.storageAddress],
    ['asset', quote.asset],
    ['amount', quote.amount],
    ['fileHash', quote.fileHash],
    ['storageExpirationMicros', quote.storageExpirationMicros],
    ['configVersion', quote.configVersion],
  ];
  if (quote.chain !== expectedChain) {
    throw paidError('Settlement receipt chain does not match quote', 'paid_receipt_mismatch', 409);
  }
  for (const [field, expected] of comparisons) {
    if (String(receipt[field]).toLowerCase() !== String(expected).toLowerCase()) {
      throw paidError(`Settlement receipt ${field} does not match quote`, 'paid_receipt_mismatch', 409);
    }
  }
  return receipt;
}

export class PaidAuthorizationManager {
  constructor({
    quoteManager,
    secret,
    now = Date.now,
    ttlMs = TTL_MS,
    environment = process.env.NODE_ENV || 'development',
    settlementContractsEnabled = false,
  }) {
    const secretText = String(secret || '');
    if (!secretText || (environment === 'production' && Buffer.byteLength(secretText) < 32)) {
      throw new Error('PAY_SECRET must contain at least 32 bytes in production');
    }
    if (!settlementContractsEnabled && typeof quoteManager?.validate !== 'function') {
      throw new TypeError('QuoteManager is required');
    }
    this.quoteManager = quoteManager;
    this.secret = Buffer.from(secretText);
    this.now = now;
    this.ttlMs = ttlMs;
    this.settlementContractsEnabled = settlementContractsEnabled;
  }

  sign(encodedPayload) {
    return crypto.createHmac('sha256', this.secret)
      .update(`${PREFIX}.${encodedPayload}`)
      .digest('base64url');
  }

  encodeAndSign(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${PREFIX}.${encoded}.${this.sign(encoded)}`;
  }

  issue({ quote, receipt, settlementChain, settlementHash }) {
    if (this.settlementContractsEnabled) {
      const normalizedReceipt = assertReceiptMatchesQuote(receipt, quote);
      const signedQuote = contractQuoteFrom(quote);
      const issuedAtMs = this.now();
      return this.encodeAndSign({
        v: 2,
        qid: signedQuote.quoteId,
        qd: quoteDigest(signedQuote).toString('hex'),
        rd: normalizedReceiptDigest(normalizedReceipt),
        sc: normalizedReceipt.chain,
        tx: normalizedReceipt.transactionId,
        iat: issuedAtMs,
        exp: issuedAtMs + this.ttlMs,
      });
    }

    const signedQuote = this.quoteManager.validate(
      quote?.quoteToken,
      quote?.context,
      { allowExpired: true },
    );
    const chain = String(settlementChain || '');
    const hash = String(settlementHash || '');
    if (!['solana', 'aptos'].includes(chain) || !hash) {
      throw paidError('Settlement chain and hash are required', 'invalid_settlement', 400);
    }
    const issuedAtMs = this.now();
    return this.encodeAndSign({
      v: 1,
      qid: signedQuote.quoteId,
      qh: digest(signedQuote.quoteToken),
      cd: contextDigest(signedQuote.context),
      sc: chain,
      sh: hash,
      iat: issuedAtMs,
      exp: issuedAtMs + this.ttlMs,
    });
  }

  validate(token, expectedQuote, { transactionId, settlementHash } = {}) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error();
      const expectedSignature = Buffer.from(this.sign(parts[1]));
      const actualSignature = Buffer.from(parts[2]);
      if (
        expectedSignature.length !== actualSignature.length
        || !crypto.timingSafeEqual(expectedSignature, actualSignature)
      ) throw new Error();

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!Number.isSafeInteger(payload.exp)) throw new Error();
      if (this.now() >= payload.exp) {
        throw paidError('Paid authorization expired', 'paid_authorization_expired', 410);
      }

      if (this.settlementContractsEnabled) {
        if (payload.v !== 2) throw new Error();
        const quote = contractQuoteFrom(expectedQuote);
        if (
          payload.qid !== quote.quoteId
          || payload.qd !== quoteDigest(quote).toString('hex')
        ) {
          throw paidError('Paid authorization quote context does not match', 'paid_context_mismatch', 409);
        }
        if (transactionId != null && payload.tx !== String(transactionId)) {
          throw paidError('Paid authorization settlement transaction does not match', 'paid_settlement_mismatch', 409);
        }
        return Object.freeze({
          quoteId: payload.qid,
          settlementChain: payload.sc,
          transactionId: payload.tx,
          receiptDigest: payload.rd,
          issuedAtMs: payload.iat,
          expiresAtMs: payload.exp,
        });
      }

      if (payload.v !== 1) throw new Error();
      const quote = this.quoteManager.validate(
        expectedQuote?.quoteToken,
        expectedQuote?.context,
        { allowExpired: true },
      );
      if (
        payload.qid !== quote.quoteId
        || payload.qh !== digest(quote.quoteToken)
        || payload.cd !== contextDigest(quote.context)
      ) {
        throw paidError('Paid authorization quote context does not match', 'paid_context_mismatch', 409);
      }
      if (settlementHash != null && payload.sh !== String(settlementHash)) {
        throw paidError('Paid authorization settlement does not match', 'paid_settlement_mismatch', 409);
      }
      return Object.freeze({
        quoteId: payload.qid,
        settlementChain: payload.sc,
        settlementHash: payload.sh,
        contextDigest: payload.cd,
        issuedAtMs: payload.iat,
        expiresAtMs: payload.exp,
      });
    } catch (error) {
      if (error?.code) throw error;
      throw paidError('Invalid paid authorization');
    }
  }
}
