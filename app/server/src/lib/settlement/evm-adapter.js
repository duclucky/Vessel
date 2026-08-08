import { Interface, JsonRpcProvider } from 'ethers';
import { normalizeSettlementReceipt } from './receipt.js';

const pendingError = () => Object.assign(new Error('Settlement receipt is not finalized yet'), {
  code: 'receipt_pending',
  status: 409,
  retriable: true,
});

const receiptError = (message) => Object.assign(new Error(message), {
  code: 'invalid_settlement_receipt',
  status: 400,
  retriable: false,
});

const ABI = [
  'event SettlementReceiptV1(uint8 chain,uint32 network,bytes32 quoteId,bytes32 payer,bytes32 storageAddress,bytes32 asset,uint64 amount,bytes32 fileHash,uint64 storageExpirationMicros,uint64 configVersion)',
];

const strip0x = (value) => String(value || '').replace(/^0x/, '').toLowerCase();

export class EvmSettlementAdapter {
  constructor({
    provider,
    rpcUrl,
    contractAddress,
    network = 11155111,
    confirmations = 1,
    iface = new Interface(ABI),
  }) {
    if (!contractAddress) throw new TypeError('EVM settlement deployment is required');
    this.provider = provider || new JsonRpcProvider(rpcUrl);
    this.contractAddress = String(contractAddress).toLowerCase();
    this.network = Number(network);
    this.confirmations = Number(confirmations);
    this.iface = iface;
    this.deploymentId = this.contractAddress;
  }

  async verify({ quote, transactionId }) {
    const hash = String(transactionId || '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw receiptError('EVM transaction hash is invalid');
    const signedQuote = quote?.contractQuote || quote;
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (!receipt) throw pendingError();
    if (receipt.status !== 1) throw receiptError('EVM settlement transaction failed');
    if (String(receipt.to || '').toLowerCase() !== this.contractAddress) {
      throw receiptError('EVM settlement transaction did not target the Vessel contract');
    }
    const currentBlock = await this.provider.getBlockNumber?.();
    if (
      Number.isSafeInteger(currentBlock)
      && Number.isSafeInteger(receipt.blockNumber)
      && currentBlock - receipt.blockNumber + 1 < this.confirmations
    ) {
      throw pendingError();
    }
    const parsed = (receipt.logs || [])
      .filter((log) => String(log.address || '').toLowerCase() === this.contractAddress)
      .map((log) => {
        try { return this.iface.parseLog(log); } catch { return null; }
      })
      .find((event) => event?.name === 'SettlementReceiptV1');
    if (!parsed) throw receiptError('EVM settlement receipt event is missing');

    const block = await this.provider.getBlock(receipt.blockNumber);
    const args = parsed.args;
    const normalized = normalizeSettlementReceipt({
      chain: 'evm',
      network: Number(args.network),
      deploymentId: this.deploymentId,
      quoteId: strip0x(args.quoteId),
      payer: strip0x(args.payer),
      storageAddress: strip0x(args.storageAddress),
      asset: strip0x(args.asset),
      amount: String(args.amount),
      fileHash: strip0x(args.fileHash),
      storageExpirationMicros: String(args.storageExpirationMicros),
      transactionId: hash,
      blockReference: String(receipt.blockNumber),
      finalizedAtMs: Number(block?.timestamp || 0) * 1000,
      configVersion: String(args.configVersion),
    });
    if (Number(signedQuote?.chain) !== 3 || Number(signedQuote?.network) !== this.network) {
      throw receiptError('EVM receipt domain does not match the signed quote');
    }
    return normalized;
  }
}
