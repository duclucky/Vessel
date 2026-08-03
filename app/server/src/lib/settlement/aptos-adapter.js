import { normalizeSettlementReceipt } from './receipt.js';

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

function canonicalAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(text)) return text;
  const compact = text.slice(2).replace(/^0+/, '');
  return `0x${compact || '0'}`;
}

function bytes32Hex(value, field) {
  let hex;
  if (Array.isArray(value) || value instanceof Uint8Array) {
    hex = Buffer.from(value).toString('hex');
  } else {
    hex = String(value || '').replace(/^0x/, '').toLowerCase();
  }
  if (!/^[0-9a-f]{64}$/.test(hex)) throw receiptError(`Aptos receipt ${field} must be 32 bytes`);
  return hex;
}

function eventTypeMatches(type, moduleAddress) {
  const [address, module, event] = String(type || '').split('::');
  return canonicalAddress(address) === canonicalAddress(moduleAddress)
    && module === 'vessel_settlement'
    && event === 'SettlementReceiptV1';
}

function storesFromChanges(changes = []) {
  const stores = new Map();
  for (const change of changes) {
    if (change?.type !== 'write_resource') continue;
    const address = canonicalAddress(change.address);
    const row = stores.get(address) || {};
    const type = String(change.data?.type || '');
    if (type.endsWith('::object::ObjectCore')) {
      row.owner = canonicalAddress(change.data?.data?.owner);
    }
    if (type.endsWith('::fungible_asset::FungibleStore')) {
      row.asset = canonicalAddress(
        change.data?.data?.metadata?.inner ?? change.data?.data?.metadata,
      );
    }
    stores.set(address, row);
  }
  return stores;
}

function hasExactVaultDeposit(transaction, vaultAddress, asset, amount) {
  const stores = storesFromChanges(transaction.changes);
  return transaction.events?.some((event) => {
    if (!String(event?.type || '').endsWith('::fungible_asset::Deposit')) return false;
    const store = stores.get(canonicalAddress(event?.data?.store));
    return store?.owner === canonicalAddress(vaultAddress)
      && store?.asset === canonicalAddress(`0x${asset}`)
      && String(event?.data?.amount) === String(amount);
  });
}

export class AptosSettlementAdapter {
  constructor({ aptos, moduleAddress, vaultAddress, chainId = 2, timeoutSecs = 20 }) {
    if (typeof aptos?.waitForTransaction !== 'function' || typeof aptos?.getTransactionByHash !== 'function') {
      throw new TypeError('Aptos client is required');
    }
    if (!moduleAddress || !vaultAddress) throw new TypeError('Aptos settlement deployment is required');
    this.aptos = aptos;
    this.moduleAddress = String(moduleAddress);
    this.vaultAddress = String(vaultAddress);
    this.chainId = Number(chainId);
    this.timeoutSecs = Number(timeoutSecs);
    this.deploymentId = `${this.moduleAddress}::vessel_settlement`;
  }

  async verify({ quote, transactionId }) {
    const signedQuote = quote?.contractQuote || quote;
    const hash = String(transactionId || '');
    if (!hash || !signedQuote) throw receiptError('Aptos transaction and signed quote are required');

    let waitError;
    try {
      await this.aptos.waitForTransaction({
        transactionHash: hash,
        options: { timeoutSecs: this.timeoutSecs, checkSuccess: true },
      });
    } catch (error) {
      waitError = error;
    }

    let transaction;
    try {
      transaction = await this.aptos.getTransactionByHash({ transactionHash: hash });
    } catch {
      transaction = null;
    }
    if (!transaction) throw pendingError();
    if (
      transaction.success !== true
      || String(transaction.hash || '').toLowerCase() !== hash.toLowerCase()
    ) {
      throw receiptError('Aptos settlement transaction failed');
    }
    if (waitError) throw receiptError('Aptos settlement finality check failed');
    if (canonicalAddress(transaction.sender) !== canonicalAddress(`0x${signedQuote.payer}`)) {
      throw receiptError('Aptos settlement sender does not match the signed quote');
    }

    const receiptEvents = (transaction.events || [])
      .filter((event) => eventTypeMatches(event?.type, this.moduleAddress));
    if (receiptEvents.length !== 1) {
      throw receiptError('Aptos transaction must contain exactly one Vessel settlement receipt');
    }
    const data = receiptEvents[0].data || {};
    if (!hasExactVaultDeposit(
      transaction,
      this.vaultAddress,
      signedQuote.asset,
      signedQuote.amount,
    )) {
      throw receiptError('Aptos settlement did not deposit the exact amount into the Vessel vault');
    }

    const timestampMicros = BigInt(transaction.timestamp || 0);
    const finalizedAtMs = Number(timestampMicros / 1_000n);
    const receipt = normalizeSettlementReceipt({
      chain: 'aptos',
      network: Number(data.network),
      deploymentId: this.deploymentId,
      quoteId: bytes32Hex(data.quote_id, 'quote ID'),
      payer: bytes32Hex(data.payer, 'payer'),
      storageAddress: bytes32Hex(data.storage_address, 'storage address'),
      asset: bytes32Hex(data.asset, 'asset'),
      amount: String(data.amount),
      fileHash: bytes32Hex(data.file_hash, 'file hash'),
      storageExpirationMicros: String(data.storage_expiration_micros),
      transactionId: hash,
      blockReference: String(transaction.version || ''),
      finalizedAtMs,
      configVersion: String(data.config_version),
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
    if (Number(data.chain) !== 1 || this.chainId !== Number(signedQuote.network)) {
      throw receiptError('Aptos receipt domain does not match the signed quote');
    }
    for (const [field, value] of expected) {
      if (String(receipt[field]).toLowerCase() !== String(value).toLowerCase()) {
        throw receiptError(`Aptos receipt ${field} does not match the signed quote`);
      }
    }
    return receipt;
  }
}
