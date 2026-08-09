import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureShelbyDaaFunding } from '../src/lib/shelby-daa-funding.js';

test('DAA funding preflight faucets only balances below the configured thresholds', async () => {
  const funded = [];
  const waits = [];
  const aptBalances = [10n, 1_500n];
  const shelbyUsdBalances = ['20', '2500'];

  const result = await ensureShelbyDaaFunding({
    address: `0x${'11'.repeat(32)}`,
    aptos: {
      async getAccountAPTAmount() {
        return aptBalances.shift();
      },
      async getCurrentFungibleAssetBalances() {
        return [{ amount: shelbyUsdBalances.shift() }];
      },
      async fundAccount(input) {
        funded.push(['apt', input]);
        return { hash: '0xapt' };
      },
      async waitForTransaction(input) {
        waits.push(input);
      },
    },
    shelbyClient: {
      async fundAccountWithShelbyUSD(input) {
        funded.push(['shelbyusd', input]);
        return { hash: '0xusd' };
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
  assert.deepEqual(waits, [
    { transactionHash: '0xapt' },
    { transactionHash: '0xusd' },
  ]);
  assert.deepEqual(result, {
    aptFunded: true,
    shelbyUsdFunded: true,
    aptOctas: 1_500n,
    shelbyUsdUnits: 2500n,
  });
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
