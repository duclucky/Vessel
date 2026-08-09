import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureShelbyDaaFunding } from '../src/lib/shelby-daa-funding.js';

test('DAA funding preflight faucets only balances below the configured thresholds', async () => {
  const funded = [];

  await ensureShelbyDaaFunding({
    address: `0x${'11'.repeat(32)}`,
    aptos: {
      async getAccountAPTAmount() {
        return 10n;
      },
      async getCurrentFungibleAssetBalances() {
        return [{ amount: '20' }];
      },
      async fundAccount(input) {
        funded.push(['apt', input]);
        return { hash: '0xapt' };
      },
    },
    shelbyClient: {
      async fundAccountWithShelbyUSD(input) {
        funded.push(['shelbyusd', input]);
        return '0xusd';
      },
    },
    minAptOctas: 100n,
    aptFaucetOctas: 1_000n,
    minShelbyUsdUnits: 200n,
    shelbyUsdFaucetUnits: 2_000n,
  });

  assert.deepEqual(funded, [
    ['apt', { accountAddress: `0x${'11'.repeat(32)}`, amount: 1_000 }],
    ['shelbyusd', { address: `0x${'11'.repeat(32)}`, amount: 2_000 }],
  ]);
});

test('DAA funding preflight skips faucet when balances already satisfy thresholds', async () => {
  let faucetCalls = 0;

  const result = await ensureShelbyDaaFunding({
    address: `0x${'11'.repeat(32)}`,
    aptos: {
      async getAccountAPTAmount() {
        return 1_000n;
      },
      async getCurrentFungibleAssetBalances() {
        return [{ amount: '2000' }];
      },
      async fundAccount() {
        faucetCalls += 1;
      },
    },
    shelbyClient: {
      async fundAccountWithShelbyUSD() {
        faucetCalls += 1;
      },
    },
    minAptOctas: 100n,
    minShelbyUsdUnits: 200n,
  });

  assert.equal(faucetCalls, 0);
  assert.deepEqual(result, {
    aptFunded: false,
    shelbyUsdFunded: false,
    aptOctas: 1_000n,
    shelbyUsdUnits: 2000n,
  });
});
