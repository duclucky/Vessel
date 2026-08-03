import crypto from 'node:crypto';

const PREFIX = 'vpaid';
const TTL_MS = 24 * 60 * 60_000;

const paidError = (message, code = 'invalid_paid_authorization', status = 401) => Object.assign(
  new Error(message),
  { code, status, retriable: false },
);

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const contextDigest = (context) => digest(JSON.stringify(context));

export class PaidAuthorizationManager {
  constructor({
    quoteManager,
    secret,
    now = Date.now,
    ttlMs = TTL_MS,
    environment = process.env.NODE_ENV || 'development',
  }) {
    const secretText = String(secret || '');
    if (!secretText || (environment === 'production' && Buffer.byteLength(secretText) < 32)) {
      throw new Error('PAY_SECRET must contain at least 32 bytes in production');
    }
    if (typeof quoteManager?.validate !== 'function') {
      throw new TypeError('QuoteManager is required');
    }
    this.quoteManager = quoteManager;
    this.secret = Buffer.from(secretText);
    this.now = now;
    this.ttlMs = ttlMs;
  }

  sign(encodedPayload) {
    return crypto.createHmac('sha256', this.secret)
      .update(`${PREFIX}.${encodedPayload}`)
      .digest('base64url');
  }

  issue({ quote, settlementChain, settlementHash }) {
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
    const payload = {
      v: 1,
      qid: signedQuote.quoteId,
      qh: digest(signedQuote.quoteToken),
      cd: contextDigest(signedQuote.context),
      sc: chain,
      sh: hash,
      iat: issuedAtMs,
      exp: issuedAtMs + this.ttlMs,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${PREFIX}.${encoded}.${this.sign(encoded)}`;
  }

  validate(token, expectedQuote, { settlementHash } = {}) {
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
      if (payload.v !== 1 || !Number.isSafeInteger(payload.exp)) throw new Error();
      if (this.now() >= payload.exp) {
        throw paidError('Paid authorization expired', 'paid_authorization_expired', 410);
      }
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
