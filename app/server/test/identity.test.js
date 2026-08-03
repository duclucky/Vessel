import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage, getIds, hasInlineTailwindConfig } from './html-test-utils.js';

test('Identity keeps runtime hooks inside the Ethereal shell', () => {
  const html = readPage('identity.html');
  const ids = getIds(html);
  for (const id of [
    'main-content',
    'origin-wallet',
    'derived-account',
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
  assert.doesNotMatch(html, /Ethereum Wallet|encrypted|weekly/i);
});
