import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import crypto from 'node:crypto';

// USDC-only payments on Solana (customer pays the app in stablecoin; the app then sponsors the
// Aptos-side storage fees). Stablecoin avoids price volatility for fee quoting.
//
// STATELESS by design (Vercel serverless-friendly): the paymentId is an HMAC-signed token that
// carries the amount plus complete wallet/upload context. Verification checks treasury receipt,
// source-wallet debit, and memo before returning a second HMAC used by sponsor submission.
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');
const paymentError = (message) => Object.assign(new Error(message), {
  code: 'invalid_payment_context',
  status: 400,
});

export function normalizePaymentContext(input = {}) {
  const context = {
    sizeBytes: Number(input.sizeBytes),
    chain: String(input.chain || ''),
    sourceAddress: String(input.sourceAddress || ''),
    storageAddress: String(input.storageAddress || ''),
    expirationMicros: Number(input.expirationMicros),
  };
  if (
    !Number.isSafeInteger(context.sizeBytes)
    || context.sizeBytes <= 0
    || context.chain !== 'solana'
    || !context.sourceAddress
    || !context.storageAddress
    || !Number.isSafeInteger(context.expirationMicros)
    || context.expirationMicros <= 0
  ) {
    throw paymentError('Invalid Solana payment context');
  }
  return context;
}

export class PaymentManager {
  constructor({ rpc, treasurySecretKey, usdcMint = USDC_DEVNET, priceBaseUsdc = 0.01, pricePerMbUsdc = 0.01, secret }) {
    this.conn = new Connection(rpc || 'https://api.devnet.solana.com', 'confirmed');
    this.usdcMint = new PublicKey(usdcMint);
    this.priceBase = priceBaseUsdc;
    this.pricePerMb = pricePerMbUsdc;
    this.secret = secret || 'vessel-dev-secret';
    if (!treasurySecretKey) throw new Error('PaymentManager requires SOLANA_TREASURY_SECRET_KEY');
    this.treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(treasurySecretKey)));
  }

  static forTest({
    secret,
    priceBaseUsdc,
    pricePerMbUsdc,
    treasury,
    treasuryAta,
    mint = USDC_DEVNET,
    tx = null,
  }) {
    const manager = Object.create(PaymentManager.prototype);
    manager.conn = { getParsedTransaction: async () => tx };
    manager.usdcMint = { toString: () => mint };
    manager.priceBase = priceBaseUsdc;
    manager.pricePerMb = pricePerMbUsdc;
    manager.secret = secret;
    manager.treasury = { publicKey: { toString: () => treasury } };
    manager._ata = { toString: () => treasuryAta };
    return manager;
  }

  async treasuryAta() {
    if (!this._ata) this._ata = await getAssociatedTokenAddress(this.usdcMint, this.treasury.publicKey);
    return this._ata;
  }

  priceMicro(sizeBytes) {
    const mb = sizeBytes / 1048576;
    return Math.max(1, Math.round((this.priceBase + this.pricePerMb * mb) * 1_000_000));
  }

  _hmac(s) { return crypto.createHmac('sha256', this.secret).update(s).digest('base64url'); }

  // paymentId = vpay.<payload>.<sig>  (self-verifying, no server state)
  _mintPaymentId(amountMicro, context) {
    const payload = b64u(JSON.stringify({
      a: amountMicro,
      s: context.sizeBytes,
      c: context.chain,
      w: context.sourceAddress,
      d: context.storageAddress,
      x: context.expirationMicros,
      e: Date.now() + 15 * 60 * 1000,
    }));
    return `vpay.${payload}.${this._hmac(payload)}`;
  }
  _parsePaymentId(paymentId) {
    const parts = String(paymentId || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'vpay') return null;
    const expected = Buffer.from(this._hmac(parts[1]));
    const actual = Buffer.from(parts[2]);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    let p; try { p = JSON.parse(unb64u(parts[1]).toString()); } catch { return null; }
    if (!p || Date.now() > p.e || !Number.isSafeInteger(p.a) || p.a <= 0) return null;
    try {
      return {
        amountMicro: p.a,
        ...normalizePaymentContext({
          sizeBytes: p.s,
          chain: p.c,
          sourceAddress: p.w,
          storageAddress: p.d,
          expirationMicros: p.x,
        }),
      };
    } catch {
      return null;
    }
  }

  async createIntent(input) {
    const context = normalizePaymentContext(input);
    const amountMicro = this.priceMicro(context.sizeBytes);
    const paymentId = this._mintPaymentId(amountMicro, context);
    return {
      paymentId,
      amountUsdc: amountMicro / 1_000_000,
      amountMicro,
      token: 'USDC',
      usdcMint: this.usdcMint.toString(),
      treasury: this.treasury.publicKey.toString(),
      treasuryAta: (await this.treasuryAta()).toString(),
      memo: paymentId, // include this as an spl-memo in the transfer (binds payment -> this intent)
      network: 'solana-devnet',
    };
  }

  // uploadToken proves a valid USDC payment for this paymentId (checked again by /api/sponsor/submit).
  uploadToken(paymentId) { return 'vupl.' + this._hmac(paymentId + ':paid'); }
  checkUploadToken(paymentId, token, input) {
    if (!paymentId || !token) return false;
    const expected = Buffer.from(this.uploadToken(paymentId));
    const actual = Buffer.from(String(token));
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;
    const intent = this._parsePaymentId(paymentId);
    let context;
    try { context = normalizePaymentContext(input); } catch { return false; }
    return Boolean(
      intent
      && intent.chain === context.chain
      && intent.sourceAddress === context.sourceAddress
      && intent.storageAddress.toLowerCase() === context.storageAddress.toLowerCase()
      && intent.sizeBytes === context.sizeBytes
      && intent.expirationMicros === context.expirationMicros
    );
  }

  /** Verify a Solana tx: USDC transfer of >= amount to the treasury ATA, memo = paymentId. */
  async verify(paymentId, signature) {
    const intent = this._parsePaymentId(paymentId);
    if (!intent) return { ok: false, reason: 'unknown_or_expired_payment' };
    let tx;
    for (let i = 0; i < 8 && !tx; i++) {
      tx = await this.conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
      if (!tx) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tx) return { ok: false, reason: 'tx_not_found' };
    if (tx.meta?.err) return { ok: false, reason: 'tx_failed' };

    const treasuryPk = this.treasury.publicKey.toString();
    const mint = this.usdcMint.toString();
    const preBalances = tx.meta?.preTokenBalances || [];
    const postBalances = tx.meta?.postTokenBalances || [];
    const rowsFor = (rows, owner) => rows.filter((row) => row.owner === owner && row.mint === mint);
    const total = (rows) => rows.reduce(
      (sum, row) => sum + BigInt(row.uiTokenAmount?.amount || 0),
      0n,
    );
    const treasuryPre = rowsFor(preBalances, treasuryPk);
    const treasuryPost = rowsFor(postBalances, treasuryPk);
    const received = total(treasuryPost) - total(treasuryPre);
    const required = BigInt(intent.amountMicro);
    if (received < required) {
      return {
        ok: false,
        reason: 'insufficient_amount',
        received: Number(received),
        required: intent.amountMicro,
      };
    }

    const sourcePre = rowsFor(preBalances, intent.sourceAddress);
    const sourcePost = rowsFor(postBalances, intent.sourceAddress);
    if (!sourcePre.length || !sourcePost.length) {
      return { ok: false, reason: 'source_mismatch' };
    }
    const sourceDebit = total(sourcePre) - total(sourcePost);
    if (sourceDebit < required) {
      return {
        ok: false,
        reason: 'insufficient_source_debit',
        debited: Number(sourceDebit),
        required: intent.amountMicro,
      };
    }

    // memo check (defense in depth so a payment can't be replayed for a different intent)
    const memoOk = JSON.stringify(tx.transaction?.message?.instructions || []).includes(paymentId);
    if (!memoOk) return { ok: false, reason: 'memo_mismatch' };

    return {
      ok: true,
      paymentId,
      receivedUsdc: Number(received) / 1_000_000,
      uploadToken: this.uploadToken(paymentId),
    };
  }
}
