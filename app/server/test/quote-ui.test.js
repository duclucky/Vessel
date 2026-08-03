import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicDir } from './html-test-utils.js';
import {
  formatAccountingMicro,
  quoteViewModel,
} from '../public/quote-ui.js';

test('quote amounts remain exact at the six-decimal accounting boundary', () => {
  assert.equal(formatAccountingMicro('1'), '$0.000001');
  assert.equal(formatAccountingMicro('10000'), '$0.01');
  assert.equal(formatAccountingMicro('35714'), '$0.035714');
});

test('quote view model itemizes storage, gas, Vessel fee, minimum, and wallet-family token', () => {
  const model = quoteViewModel({
    chain: 'solana',
    storageAccountingMicro: '13',
    gasAccountingMicro: '35000',
    serviceFeeAccountingMicro: '9999',
    totalAccountingMicro: '10000',
    minimumApplied: true,
    settlementToken: 'Devnet USDC',
    settlementNetwork: 'Solana Devnet',
    targetExpirationUtc: '2026-09-02T00:00:00.000Z',
    expiresAtMs: 301_000,
  }, 1_000);

  assert.equal(model.storage, '$0.000013');
  assert.equal(model.gas, '$0.035');
  assert.match(model.serviceFee, /minimum/i);
  assert.equal(model.total, '$0.01');
  assert.equal(model.tokenLine, 'Devnet USDC · Solana Devnet');
  assert.equal(model.countdown, '05:00');
});

test('quote UI owns loading, expiry, validation, and confirmation states without auto approval', () => {
  const source = fs.readFileSync(path.join(publicDir, 'quote-ui.js'), 'utf8');
  assert.match(source, /export function mountQuoteUi/);
  assert.match(source, /normalizeRetentionDays/);
  assert.match(source, /kind === 'loading'/);
  assert.match(source, /kind === 'ready'/);
  assert.match(source, /kind === 'expired'/);
  assert.match(source, /kind === 'unavailable'/);
  assert.match(source, /setInterval\([^,]+,\s*1_000\)/s);
  assert.doesNotMatch(source, /wallet|signAndSubmit|payUSDC/i);
});
