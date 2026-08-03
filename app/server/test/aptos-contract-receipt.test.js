import test from 'node:test';
import assert from 'node:assert/strict';
import { AptosSettlementAdapter } from '../src/lib/settlement/aptos-adapter.js';

const moduleAddress = `0x${'aa'.repeat(32)}`;
const vaultAddress = `0x${'cc'.repeat(32)}`;
const storeAddress = `0x${'dd'.repeat(32)}`;
const transactionId = `0x${'bb'.repeat(32)}`;
const contractQuote = Object.freeze({
  version: 1,
  chain: 1,
  network: 2,
  quoteId: '11'.repeat(32),
  payer: '22'.repeat(32),
  storageAddress: '33'.repeat(32),
  asset: '44'.repeat(32),
  amount: '84100',
  fileHash: '55'.repeat(32),
  retentionDays: 7,
  storageExpirationMicros: '1786354494000000',
  quoteExpiresAtSecs: '1785749994',
  configVersion: '1',
});

const receiptEvent = (patch = {}) => ({
  type: `${moduleAddress}::vessel_settlement::SettlementReceiptV1`,
  data: {
    chain: '1',
    network: '2',
    quote_id: `0x${contractQuote.quoteId}`,
    payer: `0x${contractQuote.payer}`,
    storage_address: `0x${contractQuote.storageAddress}`,
    asset: `0x${contractQuote.asset}`,
    amount: contractQuote.amount,
    file_hash: `0x${contractQuote.fileHash}`,
    storage_expiration_micros: contractQuote.storageExpirationMicros,
    config_version: contractQuote.configVersion,
    ...patch,
  },
});

const vaultDeposit = (amount = contractQuote.amount) => ({
  type: '0x1::fungible_asset::Deposit',
  data: { store: storeAddress, amount },
});

const transaction = (patch = {}) => ({
  hash: transactionId,
  success: true,
  sender: `0x${contractQuote.payer}`,
  version: '12345',
  timestamp: '1785749700000000',
  events: [
    receiptEvent(),
    vaultDeposit(),
  ],
  changes: [
    {
      type: 'write_resource',
      address: storeAddress,
      data: { type: '0x1::object::ObjectCore', data: { owner: vaultAddress } },
    },
    {
      type: 'write_resource',
      address: storeAddress,
      data: {
        type: '0x1::fungible_asset::FungibleStore',
        data: { metadata: { inner: `0x${contractQuote.asset}` } },
      },
    },
  ],
  ...patch,
});

const adapterWith = (tx, wait = async () => ({})) => new AptosSettlementAdapter({
  aptos: {
    waitForTransaction: wait,
    getTransactionByHash: async () => tx,
  },
  moduleAddress,
  vaultAddress,
  chainId: 2,
});

test('finalized Aptos Move receipt and vault movement normalize successfully', async () => {
  let waitInput;
  const adapter = adapterWith(transaction(), async (input) => { waitInput = input; });
  const receipt = await adapter.verify({ quote: { contractQuote }, transactionId });

  assert.deepEqual(waitInput, {
    transactionHash: transactionId,
    options: { timeoutSecs: 20, checkSuccess: true },
  });
  assert.equal(receipt.chain, 'aptos');
  assert.equal(receipt.deploymentId, `${moduleAddress}::vessel_settlement`);
  assert.equal(receipt.quoteId, contractQuote.quoteId);
  assert.equal(receipt.amount, contractQuote.amount);
  assert.equal(receipt.blockReference, '12345');
  assert.equal(receipt.finalizedAtMs, 1_785_749_700_000);
});

test('not-yet-final Aptos transaction returns a retriable pending receipt', async () => {
  const adapter = adapterWith(null, async () => { throw new Error('waitForTransaction timeout'); });
  await assert.rejects(
    () => adapter.verify({ quote: { contractQuote }, transactionId }),
    (error) => error.code === 'receipt_pending' && error.status === 409 && error.retriable === true,
  );
});

test('Aptos adapter rejects VM, sender, module, receipt, and vault mismatches', async () => {
  const cases = [
    transaction({ success: false }),
    transaction({ sender: `0x${'99'.repeat(32)}` }),
    transaction({ events: [
      { ...receiptEvent(), type: `0x${'99'.repeat(32)}::vessel_settlement::SettlementReceiptV1` },
      vaultDeposit(),
    ] }),
    transaction({ events: [receiptEvent({ quote_id: `0x${'99'.repeat(32)}` }), vaultDeposit()] }),
    transaction({ events: [receiptEvent(), vaultDeposit('84101')] }),
    transaction({ changes: [{
      type: 'write_resource',
      address: storeAddress,
      data: { type: '0x1::object::ObjectCore', data: { owner: `0x${'99'.repeat(32)}` } },
    }] }),
  ];

  for (const tx of cases) {
    await assert.rejects(
      () => adapterWith(tx).verify({ quote: { contractQuote }, transactionId }),
      (error) => error.code === 'invalid_settlement_receipt' && error.retriable === false,
    );
  }
});
