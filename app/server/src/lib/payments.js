import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import crypto from 'node:crypto';

// USDC-only payments on Solana (customer pays the app in stablecoin; the app then sponsors the
// Aptos-side storage fees). Stablecoin avoids price volatility for fee quoting.
//
// STATELESS by design (Vercel serverless-friendly): the paymentId is an HMAC-signed token that
// carries {amountMicro, sizeBytes, exp}. verify() re-derives the price from the token (no server
// memory), checks the on-chain USDC transfer (amount + treasury + memo=paymentId), and returns an
// uploadToken = HMAC(paymentId + ':paid'). /api/sponsor/submit re-checks that HMAC. No shared state.
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

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
  _mintPaymentId(amountMicro, sizeBytes) {
    const payload = b64u(JSON.stringify({ a: amountMicro, s: sizeBytes, e: Date.now() + 15 * 60 * 1000 }));
    return `vpay.${payload}.${this._hmac(payload)}`;
  }
  _parsePaymentId(paymentId) {
    const parts = String(paymentId || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'vpay') return null;
    if (this._hmac(parts[1]) !== parts[2]) return null; // tampered
    let p; try { p = JSON.parse(unb64u(parts[1]).toString()); } catch { return null; }
    if (!p || Date.now() > p.e) return null; // expired
    return { amountMicro: p.a, sizeBytes: p.s };
  }

  async createIntent(sizeBytes) {
    const amountMicro = this.priceMicro(sizeBytes);
    const paymentId = this._mintPaymentId(amountMicro, sizeBytes);
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
  checkUploadToken(paymentId, token) { return !!paymentId && token === this.uploadToken(paymentId); }

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
    const pre = (tx.meta?.preTokenBalances || []).find((b) => b.owner === treasuryPk && b.mint === mint);
    const post = (tx.meta?.postTokenBalances || []).find((b) => b.owner === treasuryPk && b.mint === mint);
    const preAmt = Number(pre?.uiTokenAmount?.amount || 0);
    const postAmt = Number(post?.uiTokenAmount?.amount || 0);
    const received = postAmt - preAmt;
    if (received < intent.amountMicro) return { ok: false, reason: 'insufficient_amount', received, required: intent.amountMicro };

    // memo check (defense in depth so a payment can't be replayed for a different intent)
    const memoOk = JSON.stringify(tx.transaction?.message?.instructions || []).includes(paymentId);
    if (!memoOk) return { ok: false, reason: 'memo_mismatch' };

    return { ok: true, paymentId, receivedUsdc: received / 1_000_000, uploadToken: this.uploadToken(paymentId) };
  }
}
