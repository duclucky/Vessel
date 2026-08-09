import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage, getIds, hasInlineTailwindConfig } from './html-test-utils.js';

test('Identity keeps runtime hooks inside the Ethereal shell', () => {
  const html = readPage('identity.html');
  const ids = getIds(html);
  for (const id of [
    'main-content',
    'origin-wallet',
    'origin-wallet-label',
    'derived-account',
    'storage-account-label',
    'sign-btn',
    'sign-btn-label',
    'auth-status',
  ]) {
    assert.equal(ids.has(id), true, id);
  }
  assert.match(html, /<script src="\/theme\.js"><\/script>/);
  assert.equal(hasInlineTailwindConfig(html), false);
  assert.match(html, /Connected wallet/i);
  assert.match(html, /Shelby storage account/i);
  assert.match(html, /Aptos wallets use their own address/i);
  assert.match(html, /Solana and Ethereum wallets control a derived Aptos storage account/i);
  assert.match(html, /APT gas and ShelbyUSD storage fees directly/i);
  assert.doesNotMatch(html, /encrypted|weekly/i);
});
