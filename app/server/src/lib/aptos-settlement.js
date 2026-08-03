const paymentError = (message) => Object.assign(new Error(message), {
  code: 'payment_verification_failed',
  status: 402,
  retriable: false,
});

const canonicalAddress = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(text)) return text;
  const compact = text.slice(2).replace(/^0+/, '');
  return `0x${compact || '0'}`;
};

const quoteField = (quote, field) => quote?.[field] ?? quote?.context?.[field];

function requiredAmount(quote) {
  const explicit = quoteField(quote, 'nativeServiceFeeShelbyUsdUnits');
  const derived = quote?.breakdown?.serviceFeeAccountingMicro == null
    ? null
    : BigInt(quote.breakdown.serviceFeeAccountingMicro) * 100n;
  try {
    const amount = explicit == null ? derived : BigInt(explicit);
    if (amount == null || amount <= 0n) throw new Error();
    return amount;
  } catch {
    throw paymentError('Invalid Aptos settlement amount');
  }
}

function storesFromChanges(changes = []) {
  const stores = new Map();
  for (const change of changes) {
    if (change?.type !== 'write_resource') continue;
    const address = canonicalAddress(change.address);
    const type = String(change.data?.type || '');
    const row = stores.get(address) || {};
    if (type.endsWith('::object::ObjectCore')) row.owner = canonicalAddress(change.data?.data?.owner);
    if (type.endsWith('::fungible_asset::FungibleStore')) {
      row.asset = canonicalAddress(
        change.data?.data?.metadata?.inner ?? change.data?.data?.metadata,
      );
    }
    stores.set(address, row);
  }
  return stores;
}

export async function verifyAptosShelbyUsdTransfer({
  transactionHash,
  quote,
  aptos,
  treasury,
  assetAddress,
}) {
  const hash = String(transactionHash || '');
  const source = canonicalAddress(quoteField(quote, 'sourceAddress'));
  const treasuryAddress = canonicalAddress(treasury);
  const asset = canonicalAddress(assetAddress);
  if (!hash || !source || !treasuryAddress || !asset) {
    throw paymentError('Aptos settlement configuration is incomplete');
  }
  const amount = requiredAmount(quote);
  const transaction = await aptos.getTransactionByHash({ transactionHash: hash })
    .catch(() => null);
  if (
    !transaction
    || transaction.hash !== hash
    || transaction.success !== true
    || canonicalAddress(transaction.sender) !== source
  ) {
    throw paymentError('Aptos transaction did not match the quote');
  }

  const payload = transaction.payload || {};
  const args = payload.arguments || payload.functionArguments || [];
  if (
    payload.function !== '0x1::primary_fungible_store::transfer'
    || canonicalAddress(args[0]) !== asset
    || canonicalAddress(args[1]) !== treasuryAddress
    || BigInt(args[2] || 0) < amount
  ) {
    throw paymentError('Aptos transfer payload did not match the quote');
  }

  const stores = storesFromChanges(transaction.changes);
  const eventAmount = (event) => {
    try { return BigInt(event?.data?.amount); } catch { return -1n; }
  };
  const matchedEvent = (suffix, owner) => transaction.events?.some((event) => {
    const store = stores.get(canonicalAddress(event?.data?.store));
    return String(event?.type || '').endsWith(suffix)
      && store?.owner === owner
      && store?.asset === asset
      && eventAmount(event) >= amount;
  });
  if (!matchedEvent('::fungible_asset::Withdraw', source)
    || !matchedEvent('::fungible_asset::Deposit', treasuryAddress)) {
    throw paymentError('Aptos transfer events did not match the quote');
  }

  return Object.freeze({
    ok: true,
    transactionHash: hash,
    amountUnits: amount.toString(),
  });
}
