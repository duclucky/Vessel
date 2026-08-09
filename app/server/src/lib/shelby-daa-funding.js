import { SHELBYUSD_FA_METADATA_ADDRESS } from '@shelby-protocol/sdk/node';

const ADDRESS = /^0x[0-9a-f]{64}$/i;

function toBigIntAmount(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
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

  let aptOctas = 0n;
  try {
    aptOctas = toBigIntAmount(await aptos.getAccountAPTAmount({ accountAddress }));
  } catch {
    aptOctas = 0n;
  }

  let shelbyUsdUnits = 0n;
  try {
    const rows = await aptos.getCurrentFungibleAssetBalances({
      options: {
        where: {
          owner_address: { _eq: accountAddress },
          asset_type: { _eq: SHELBYUSD_FA_METADATA_ADDRESS },
        },
      },
    });
    shelbyUsdUnits = toBigIntAmount(rows?.[0]?.amount);
  } catch {
    shelbyUsdUnits = 0n;
  }

  let aptFunded = false;
  let shelbyUsdFunded = false;

  if (aptOctas < minAptOctas) {
    await aptos.fundAccount({
      accountAddress,
      amount: Number(aptFaucetOctas),
    });
    aptFunded = true;
  }

  if (shelbyUsdUnits < minShelbyUsdUnits) {
    await shelbyClient.fundAccountWithShelbyUSD({
      address: accountAddress,
      amount: Number(shelbyUsdFaucetUnits),
    });
    shelbyUsdFunded = true;
  }

  return {
    aptFunded,
    shelbyUsdFunded,
    aptOctas,
    shelbyUsdUnits,
  };
}
