import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const paymentError = (message) => Object.assign(new Error(message), {
  code: 'invalid_payment_context',
  status: 400,
});

const quoteValue = (quote, field) => quote?.[field]
  ?? quote?.context?.[field]
  ?? quote?.breakdown?.[field];

function normalizeQuotePayment(quote = {}) {
  const quoteId = String(quoteValue(quote, 'quoteId') || '');
  const sourceAddress = String(quoteValue(quote, 'sourceAddress') || '');
  let amountMicro;
  try {
    amountMicro = BigInt(
      quoteValue(quote, 'solanaAmountMicro')
      ?? quoteValue(quote, 'totalAccountingMicro'),
    );
  } catch {
    throw paymentError('Invalid Solana quote payment');
  }
  if (!quoteId || !sourceAddress || amountMicro <= 0n) {
    throw paymentError('Invalid Solana quote payment');
  }
  return { quoteId, sourceAddress, amountMicro };
}

export class PaymentManager {
  constructor({ rpc, treasurySecretKey, usdcMint = USDC_DEVNET }) {
    this.conn = new Connection(rpc || 'https://api.devnet.solana.com', 'confirmed');
    this.usdcMint = new PublicKey(usdcMint);
    if (!treasurySecretKey) throw new Error('PaymentManager requires SOLANA_TREASURY_SECRET_KEY');
    this.treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(treasurySecretKey)));
  }

  static forTest({ treasury, treasuryAta, mint = USDC_DEVNET, tx = null }) {
    const manager = Object.create(PaymentManager.prototype);
    manager.conn = { getParsedTransaction: async () => tx };
    manager.usdcMint = { toString: () => mint };
    manager.treasury = { publicKey: { toString: () => treasury } };
    manager._ata = { toString: () => treasuryAta };
    return manager;
  }

  async treasuryAta() {
    if (!this._ata) {
      this._ata = await getAssociatedTokenAddress(this.usdcMint, this.treasury.publicKey);
    }
    return this._ata;
  }

  async verifyQuotePayment({ quote, signature }) {
    const context = normalizeQuotePayment(quote);
    const transactionSignature = String(signature || '');
    if (!transactionSignature) throw paymentError('Solana signature is required');

    let tx;
    for (let attempt = 0; attempt < 8 && !tx; attempt += 1) {
      tx = await this.conn.getParsedTransaction(transactionSignature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      }).catch(() => null);
      if (!tx && attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    if (!tx) return { ok: false, reason: 'tx_not_found' };
    if (tx.meta?.err) return { ok: false, reason: 'tx_failed' };

    const treasury = this.treasury.publicKey.toString();
    const mint = this.usdcMint.toString();
    const preBalances = tx.meta?.preTokenBalances || [];
    const postBalances = tx.meta?.postTokenBalances || [];
    const rowsFor = (rows, owner) => rows.filter((row) => row.owner === owner && row.mint === mint);
    const total = (rows) => rows.reduce(
      (sum, row) => sum + BigInt(row.uiTokenAmount?.amount || 0),
      0n,
    );
    const received = total(rowsFor(postBalances, treasury))
      - total(rowsFor(preBalances, treasury));
    if (received < context.amountMicro) {
      return {
        ok: false,
        reason: 'insufficient_amount',
        received: received.toString(),
        required: context.amountMicro.toString(),
      };
    }

    const sourcePre = rowsFor(preBalances, context.sourceAddress);
    const sourcePost = rowsFor(postBalances, context.sourceAddress);
    if (!sourcePre.length || !sourcePost.length) {
      return { ok: false, reason: 'source_mismatch' };
    }
    const sourceDebit = total(sourcePre) - total(sourcePost);
    if (sourceDebit < context.amountMicro) {
      return {
        ok: false,
        reason: 'insufficient_source_debit',
        debited: sourceDebit.toString(),
        required: context.amountMicro.toString(),
      };
    }

    const instructions = tx.transaction?.message?.instructions || [];
    const memoOk = instructions.some((instruction) => (
      instruction?.program === 'spl-memo'
      && (instruction?.parsed === context.quoteId || instruction?.memo === context.quoteId)
    ));
    if (!memoOk) return { ok: false, reason: 'memo_mismatch' };

    return {
      ok: true,
      signature: transactionSignature,
      receivedMicro: received.toString(),
    };
  }
}
