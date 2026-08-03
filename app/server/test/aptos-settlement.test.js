import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAptosShelbyUsdTransfer } from '../src/lib/aptos-settlement.js';

const quote = {
  sourceAddress: '0xsource',
  nativeServiceFeeShelbyUsdUnits: '70100',
};

function transaction({
  hash = '0xtxn',
  sender = '0xsource',
  asset = '0xasset',
  treasury = '0xtreasury',
  amount = '70100',
  success = true,
} = {}) {
  const sourceStore = '0xsource-store';
  const treasuryStore = '0xtreasury-store';
  const storeChanges = (store, owner) => [
    {
      type: 'write_resource',
      address: store,
      data: { type: '0x1::object::ObjectCore', data: { owner } },
    },
    {
      type: 'write_resource',
      address: store,
      data: {
        type: '0x1::fungible_asset::FungibleStore',
        data: { metadata: { inner: asset } },
      },
    },
  ];
  return {
    hash,
    sender,
    success,
    vm_status: success ? 'Executed successfully' : 'Move abort',
    payload: {
      function: '0x1::primary_fungible_store::transfer',
      type_arguments: ['0x1::fungible_asset::Metadata'],
      arguments: [{ inner: asset }, treasury, amount],
    },
    changes: [
      ...storeChanges(sourceStore, sender),
      ...storeChanges(treasuryStore, treasury),
    ],
    events: [
      { type: '0x1::fungible_asset::Withdraw', data: { store: sourceStore, amount } },
      { type: '0x1::fungible_asset::Deposit', data: { store: treasuryStore, amount } },
    ],
  };
}

const verify = (tx, overrides = {}) => verifyAptosShelbyUsdTransfer({
  transactionHash: overrides.transactionHash || '0xtxn',
  quote: overrides.quote || quote,
  aptos: { getTransactionByHash: async () => tx },
  treasury: overrides.treasury || '0xtreasury',
  assetAddress: overrides.assetAddress || '0xasset',
});

test('Aptos settlement verifies successful ShelbyUSD movement from wallet to treasury', async () => {
  assert.deepEqual(await verify(transaction()), {
    ok: true,
    transactionHash: '0xtxn',
    amountUnits: '70100',
  });
});

test('Aptos settlement rejects wrong sender, asset, treasury, amount, VM status, and hash', async () => {
  for (const [tx, overrides] of [
    [transaction({ sender: '0xother' }), {}],
    [transaction({ asset: '0xother' }), {}],
    [transaction({ treasury: '0xother' }), {}],
    [transaction({ amount: '70099' }), {}],
    [transaction({ success: false }), {}],
    [transaction({ hash: '0xother' }), {}],
  ]) {
    await assert.rejects(
      () => verify(tx, overrides),
      (error) => error.code === 'payment_verification_failed',
    );
  }
});
