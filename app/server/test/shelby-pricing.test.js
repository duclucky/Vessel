import test from 'node:test';
import assert from 'node:assert/strict';
import { SHELBY_DEPLOYER } from '@shelby-protocol/sdk/node';
import {
  calculateUploadQuote,
  createShelbyPricingReader,
} from '../src/lib/shelby-pricing.js';

const activeTier = {
  payment_to_sp_per_chunk_per_epoch: '39',
  payment_to_admin_per_chunk_per_epoch: '3',
  active: true,
};

function aptosFixture({ tiers = [activeTier], epoch = '86400000000', fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async view({ payload }) {
      calls.push(payload.function);
      if (fail) throw new Error('rpc unavailable');
      if (payload.function.endsWith('::payment::get_payment_tiers')) return [tiers];
      if (payload.function.endsWith('::config::get_payment_epoch_duration')) return [epoch];
      throw new Error(`unexpected view: ${payload.function}`);
    },
  };
}

test('pricing reader loads live active Shelby tier and epoch duration', async () => {
  const aptos = aptosFixture();
  const reader = createShelbyPricingReader({ aptos, now: () => 1_000 });
  const pricing = await reader.read();

  assert.deepEqual(aptos.calls, [
    `${SHELBY_DEPLOYER}::payment::get_payment_tiers`,
    `${SHELBY_DEPLOYER}::config::get_payment_epoch_duration`,
  ]);
  assert.equal(pricing.tierId, 0);
  assert.equal(pricing.spUnitsPerChunkEpoch, 39n);
  assert.equal(pricing.adminUnitsPerChunkEpoch, 3n);
  assert.equal(pricing.epochDurationMicros, 86_400_000_000n);
  assert.equal(pricing.serverTimeMicros, 1_000_000n);
  assert.match(pricing.configVersion, /^[0-9a-f]{64}$/);
});

test('pricing reader caches a successful read for 30 seconds', async () => {
  let current = 1_000;
  const aptos = aptosFixture();
  const reader = createShelbyPricingReader({ aptos, now: () => current });

  const first = await reader.read();
  current += 29_999;
  const second = await reader.read();

  assert.equal(first, second);
  assert.equal(aptos.calls.length, 2);
});

test('pricing reader fails closed for unavailable or malformed configuration', async () => {
  for (const aptos of [
    aptosFixture({ tiers: [{ ...activeTier, active: false }] }),
    aptosFixture({ tiers: [{ ...activeTier, payment_to_sp_per_chunk_per_epoch: 'bad' }] }),
    aptosFixture({ epoch: 'bad' }),
    aptosFixture({ fail: true }),
  ]) {
    await assert.rejects(
      createShelbyPricingReader({ aptos, now: () => 1_000 }).read(),
      (error) => error.code === 'pricing_unavailable' && error.status === 503,
    );
  }
});

test('upload quote uses integer epoch, storage, gas, service fee, and minimum arithmetic', () => {
  const result = calculateUploadQuote({
    intent: { sizeBytes: 1_127_355, expirationMicros: 604_801_000_000 },
    pricing: {
      tierId: 0,
      spUnitsPerChunkEpoch: 39n,
      adminUnitsPerChunkEpoch: 3n,
      epochDurationMicros: 86_400_000_000n,
      serverTimeMicros: 1_000_000n,
      configVersion: 'cfg-1',
    },
    chunksetCount: 4,
    gasUnits: 7_000n,
    gasUnitPriceOctas: 100n,
    aptUsdMicros: 5_000_000n,
  });

  assert.equal(result.paymentEpochs, 7);
  assert.equal(result.storageShelbyUsdUnits, '1176');
  assert.equal(result.storageAccountingMicro, '12');
  assert.equal(result.gasAccountingMicro, '35000');
  assert.equal(Number(result.totalAccountingMicro) >= 10_000, true);
  assert.equal(
    BigInt(result.serviceFeeAccountingMicro),
    BigInt(result.totalAccountingMicro) - BigInt(result.subtotalAccountingMicro),
  );
});

test('upload quote applies the one-cent minimum without losing the uplift amount', () => {
  const result = calculateUploadQuote({
    intent: { sizeBytes: 1, expirationMicros: 2_000_000 },
    pricing: {
      tierId: 2,
      spUnitsPerChunkEpoch: 1n,
      adminUnitsPerChunkEpoch: 0n,
      epochDurationMicros: 1_000_000n,
      serverTimeMicros: 1_000_000n,
      configVersion: 'cfg-min',
    },
    chunksetCount: 1,
    gasUnits: 0n,
    gasUnitPriceOctas: 0n,
    aptUsdMicros: 5_000_000n,
  });

  assert.equal(result.totalAccountingMicro, '10000');
  assert.equal(result.subtotalAccountingMicro, '1');
  assert.equal(result.serviceFeeAccountingMicro, '9999');
  assert.equal(result.minimumApplied, true);
});
