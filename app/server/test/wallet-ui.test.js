import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicDir, readPage } from './html-test-utils.js';

test('wallet presentation changes both connect CTAs after verification', async () => {
  const modulePath = path.join(publicDir, 'wallet-ui.js');
  assert.equal(fs.existsSync(modulePath), true, 'wallet presentation module is missing');
  const { walletPresentation } = await import(pathToFileURL(modulePath));

  assert.deepEqual(walletPresentation({ address: '', verified: false }), {
    connected: false,
    headerLabel: 'Connect',
    headerAria: 'Connect wallet',
    identityLabel: 'CONNECT PHANTOM — OWN YOUR STORAGE',
    identityDisabled: false,
  });

  const connected = walletPresentation({
    address: 'EUrhHCRu1234567890c418sB',
    verified: true,
  });
  assert.equal(connected.connected, true);
  assert.equal(connected.headerLabel, 'EUrh…418sB');
  assert.equal(connected.headerAria, 'Wallet EUrh…418sB connected');
  assert.equal(connected.identityLabel, 'CONNECTED — STORAGE READY');
  assert.equal(connected.identityDisabled, true);

  const identityHtml = readPage('identity.html');
  assert.match(identityHtml, /data-wallet-summary/);
  assert.match(identityHtml, /data-wallet-label/);
});
