import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { compileVesselEvmSettlement } from '../scripts/evm-settlement-build.mjs';

test('EVM settlement contract exposes the browser settlement ABI', () => {
  const artifact = compileVesselEvmSettlement();
  assert.ok(artifact.bytecode.startsWith('0x'));
  assert.ok(artifact.bytecode.length > 500);

  const iface = new Interface(artifact.abi);
  const settle = iface.getFunction('settle');
  assert.equal(settle.inputs.length, 2);
  assert.equal(settle.inputs[0].components.map((field) => field.name).join(','), [
    'version',
    'chain',
    'network',
    'quoteId',
    'payer',
    'storageAddress',
    'asset',
    'amount',
    'fileHash',
    'retentionDays',
    'storageExpirationMicros',
    'quoteExpiresAtSecs',
    'configVersion',
  ].join(','));

  const receipt = iface.getEvent('SettlementReceiptV1');
  assert.equal(receipt.inputs.map((field) => field.name).join(','), [
    'chain',
    'network',
    'quoteId',
    'payer',
    'storageAddress',
    'asset',
    'amount',
    'fileHash',
    'storageExpirationMicros',
    'configVersion',
  ].join(','));
});

