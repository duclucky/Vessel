import { SHELBYUSD_FA_METADATA_ADDRESS } from '@shelby-protocol/sdk/node';

const ADDRESS = /^0x[0-9a-f]{64}$/i;

function toBigIntAmount(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

function transactionHashOf(result) {
  const hash = typeof result === 'string'
    ? result
    : (result?.hash || result?.transactionHash || result?.transaction_hash);
  return /^0x[0-9a-f]{64}$/i.test(String(hash || '')) || /^0x[a-z0-9]+$/i.test(String(hash || ''))
    ? String(hash)
    : '';
}

async function readAptBalance(aptos, accountAddress) {
  try {
    return toBigIntAmount(await aptos.getAccountAPTAmount({ accountAddress }));
  } catch {
    return 0n;
  }
}

async function readShelbyUsdBalance(aptos, accountAddress) {
  try {
    const rows = await aptos.getCurrentFungibleAssetBalances({
      options: {
        where: {
          owner_address: { _eq: accountAddress },
          asset_type: { _eq: SHELBYUSD_FA_METADATA_ADDRESS },
        },
      },
    });
    return toBigIntAmount(rows?.[0]?.amount);
  } catch {
    return 0n;
  }
}

async function waitForHash(aptos, result) {
  const transactionHash = transactionHashOf(result);
  if (transactionHash && typeof aptos.waitForTransaction === 'function') {
    await aptos.waitForTransaction({ transactionHash });
  }
}

export async function ensureShelbyDaaFunding({
  address,
  aptos,
  shelbyClient,
  minAptOctas = 100_000_000n,
  aptFaucetOctas = 1_000_000_000n,
  minShelbyUsdUnits = 100_000_000n,
  shelbyUsdFaucetUnits = 1_000_000_000n,
} = {}) {
  const accountAddress = String(address || '').toLowerCase();
  if (!ADDRESS.test(accountAddress)) {
    const error = new Error('Valid Shelby DAA account is required');
    error.status = 400;
    error.code = 'invalid_storage_address';
    throw error;
  }

  let aptOctas = await readAptBalance(aptos, accountAddress);
  let shelbyUsdUnits = await readShelbyUsdBalance(aptos, accountAddress);

  let aptFunded = false;
  let shelbyUsdFunded = false;

  if (aptOctas < minAptOctas) {
    const result = await aptos.fundAccount({
      accountAddress,
      amount: Number(aptFaucetOctas),
    });
    await waitForHash(aptos, result);
    aptFunded = true;
  }

  if (shelbyUsdUnits < minShelbyUsdUnits) {
    const result = await shelbyClient.fundAccountWithShelbyUSD({
      address: accountAddress,
      amount: Number(shelbyUsdFaucetUnits),
    });
    await waitForHash(aptos, result);
    shelbyUsdFunded = true;
  }

  if (aptFunded) aptOctas = await readAptBalance(aptos, accountAddress);
  if (shelbyUsdFunded) shelbyUsdUnits = await readShelbyUsdBalance(aptos, accountAddress);

  return {
    aptFunded,
    shelbyUsdFunded,
    aptOctas,
    shelbyUsdUnits,
  };
}
