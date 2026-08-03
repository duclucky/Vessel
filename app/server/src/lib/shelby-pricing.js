import crypto from 'node:crypto';
import { SHELBY_DEPLOYER } from '@shelby-protocol/sdk/node';

const pricingError = (message) => Object.assign(new Error(message), {
  code: 'pricing_unavailable',
  status: 503,
  retriable: true,
});

const asBigInt = (value, field) => {
  try {
    const result = BigInt(value);
    if (result < 0n) throw new Error();
    return result;
  } catch {
    throw pricingError(`Invalid Shelby pricing field: ${field}`);
  }
};

const asQuoteBigInt = (value, field) => {
  try {
    const result = BigInt(value);
    if (result < 0n) throw new Error();
    return result;
  } catch {
    throw new TypeError(`Invalid quote field: ${field}`);
  }
};

const ceilDiv = (numerator, denominator) => {
  if (denominator <= 0n) throw pricingError('Invalid Shelby pricing field: epoch duration');
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
};

export function createShelbyPricingReader({ aptos, now = Date.now, cacheMs = 30_000 }) {
  let cached;
  return {
    async read() {
      const current = now();
      if (cached && current - cached.readAtMs < cacheMs) return cached;
      try {
        const [tierResult, epochResult] = await Promise.all([
          aptos.view({
            payload: {
              function: `${SHELBY_DEPLOYER}::payment::get_payment_tiers`,
              functionArguments: [],
            },
          }),
          aptos.view({
            payload: {
              function: `${SHELBY_DEPLOYER}::config::get_payment_epoch_duration`,
              functionArguments: [],
            },
          }),
        ]);
        const tiers = tierResult[0];
        if (!Array.isArray(tiers)) throw pricingError('Invalid Shelby payment tiers');
        const tierId = tiers.findIndex((tier) => tier?.active === true);
        if (tierId < 0) throw pricingError('Shelby has no active payment tier');
        const tier = tiers[tierId];
        const epochDurationMicros = asBigInt(epochResult[0], 'epoch duration');
        if (epochDurationMicros === 0n) throw pricingError('Invalid Shelby pricing field: epoch duration');
        const canonical = JSON.stringify({ tierId, tier, epoch: epochResult[0] });
        cached = Object.freeze({
          tierId,
          spUnitsPerChunkEpoch: asBigInt(
            tier.payment_to_sp_per_chunk_per_epoch,
            'sp fee',
          ),
          adminUnitsPerChunkEpoch: asBigInt(
            tier.payment_to_admin_per_chunk_per_epoch,
            'admin fee',
          ),
          epochDurationMicros,
          serverTimeMicros: BigInt(current) * 1_000n,
          readAtMs: current,
          configVersion: crypto.createHash('sha256').update(canonical).digest('hex'),
        });
        return cached;
      } catch (error) {
        if (error?.code === 'pricing_unavailable') throw error;
        throw pricingError('Live Shelby pricing is unavailable');
      }
    },
  };
}

export function calculateUploadQuote({
  intent,
  pricing,
  chunksetCount,
  gasUnits,
  gasUnitPriceOctas,
  aptUsdMicros,
}) {
  const expirationMicros = asQuoteBigInt(intent.expirationMicros, 'expiration');
  const serverTimeMicros = asQuoteBigInt(pricing.serverTimeMicros, 'server time');
  const epochDurationMicros = asQuoteBigInt(pricing.epochDurationMicros, 'epoch duration');
  if (expirationMicros <= serverTimeMicros) {
    throw new RangeError('Expiration must be after quote server time');
  }
  if (epochDurationMicros === 0n) throw pricingError('Invalid Shelby pricing field: epoch duration');

  const chunks = asQuoteBigInt(chunksetCount, 'chunkset count');
  const spPerEpoch = asQuoteBigInt(pricing.spUnitsPerChunkEpoch, 'sp fee');
  const adminPerEpoch = asQuoteBigInt(pricing.adminUnitsPerChunkEpoch, 'admin fee');
  const paymentEpochsBigInt = ceilDiv(
    expirationMicros - serverTimeMicros,
    epochDurationMicros,
  );
  const storageSpUnits = chunks * paymentEpochsBigInt * spPerEpoch;
  const storageAdminUnits = chunks * paymentEpochsBigInt * adminPerEpoch;
  const storageUnits = storageSpUnits + storageAdminUnits;
  const storageMicro = ceilDiv(storageUnits, 100n);

  const gasOctas = asQuoteBigInt(gasUnits, 'gas units')
    * asQuoteBigInt(gasUnitPriceOctas, 'gas unit price');
  const gasMicro = ceilDiv(
    gasOctas * asQuoteBigInt(aptUsdMicros, 'APT USD reference'),
    100_000_000n,
  );
  const subtotalMicro = storageMicro + gasMicro;
  const markedUpMicro = ceilDiv(subtotalMicro * 102n, 100n);
  const totalMicro = markedUpMicro < 10_000n ? 10_000n : markedUpMicro;
  const serviceFeeMicro = totalMicro - subtotalMicro;

  return Object.freeze({
    tierId: pricing.tierId,
    configVersion: pricing.configVersion,
    paymentEpochs: Number(paymentEpochsBigInt),
    chunksetCount: chunks.toString(),
    storageSpShelbyUsdUnits: storageSpUnits.toString(),
    storageAdminShelbyUsdUnits: storageAdminUnits.toString(),
    storageShelbyUsdUnits: storageUnits.toString(),
    storageAccountingMicro: storageMicro.toString(),
    gasOctas: gasOctas.toString(),
    gasAccountingMicro: gasMicro.toString(),
    subtotalAccountingMicro: subtotalMicro.toString(),
    serviceFeeAccountingMicro: serviceFeeMicro.toString(),
    totalAccountingMicro: totalMicro.toString(),
    minimumApplied: totalMicro === 10_000n && markedUpMicro < 10_000n,
  });
}
