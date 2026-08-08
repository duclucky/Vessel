import {
  normalizeSettlementReceipt,
  settlementReceiptError,
} from './receipt.js';

const CHAIN_NUMBER = Object.freeze({ aptos: 1, solana: 2, evm: 3 });

const expectedQuote = (quote) => quote?.contractQuote || quote;

export class SettlementAdapterRegistry {
  constructor(adapters = {}) {
    this.adapters = Object.freeze({
      aptos: adapters.aptos,
      solana: adapters.solana,
      evm: adapters.evm,
    });
  }

  async verify({ chain, quote, transactionId }) {
    const selectedChain = String(chain || '').toLowerCase();
    const adapter = this.adapters[selectedChain];
    if (!adapter || typeof adapter.verify !== 'function') {
      throw settlementReceiptError(`No settlement adapter for ${selectedChain || 'unknown chain'}`, 400);
    }
    const signedQuote = expectedQuote(quote);
    if (!signedQuote || signedQuote.chain !== CHAIN_NUMBER[selectedChain]) {
      throw settlementReceiptError('Settlement chain does not match the signed quote');
    }

    const receipt = normalizeSettlementReceipt(await adapter.verify({ quote, transactionId }));
    const comparisons = [
      ['chain', selectedChain],
      ['network', signedQuote.network],
      ['quoteId', signedQuote.quoteId],
      ['payer', signedQuote.payer],
      ['storageAddress', signedQuote.storageAddress],
      ['asset', signedQuote.asset],
      ['amount', String(signedQuote.amount)],
      ['fileHash', signedQuote.fileHash],
      ['storageExpirationMicros', String(signedQuote.storageExpirationMicros)],
      ['configVersion', String(signedQuote.configVersion)],
      ['transactionId', String(transactionId || '')],
    ];
    if (adapter.deploymentId) comparisons.push(['deploymentId', String(adapter.deploymentId)]);

    for (const [field, expected] of comparisons) {
      if (String(receipt[field]).toLowerCase() !== String(expected).toLowerCase()) {
        throw settlementReceiptError(`Settlement receipt ${field} does not match the signed quote`);
      }
    }
    return receipt;
  }
}
