import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicDir, readPage } from './html-test-utils.js';

test('wallet presentation describes disconnected, Aptos, and Solana DAA sessions', async () => {
  const modulePath = path.join(publicDir, 'wallet-ui.js');
  assert.equal(fs.existsSync(modulePath), true, 'wallet presentation module is missing');
  const { walletPresentation } = await import(pathToFileURL(modulePath));

  assert.deepEqual(walletPresentation(), {
    connected: false,
    headerLabel: 'Connect',
    headerAria: 'Connect wallet',
    identityLabel: 'CONNECT WALLET — OWN YOUR STORAGE',
    identityDisabled: false,
    chainLabel: '',
  });

  const aptos = walletPresentation({
    status: 'ready',
    session: { sourceAddress: '0x1234567890abcdef', mode: 'native' },
  });
  assert.equal(aptos.headerLabel, '0x12…bcdef');
  assert.equal(aptos.headerAria, 'Wallet 0x12…bcdef connected on APTOS');
  assert.equal(aptos.chainLabel, 'APTOS');

  const solana = walletPresentation({
    status: 'ready',
    session: { sourceAddress: 'EUrhHCRu1234567890c418sB', mode: 'daa' },
  });
  assert.equal(solana.connected, true);
  assert.equal(solana.headerLabel, 'EUrh…418sB');
  assert.equal(solana.headerAria, 'Wallet EUrh…418sB connected on SOLANA DAA');
  assert.equal(solana.identityLabel, 'CONNECTED — STORAGE READY');
  assert.equal(solana.identityDisabled, true);
  assert.equal(solana.chainLabel, 'SOLANA DAA');

  assert.deepEqual(walletPresentation({
    status: 'network_required',
    session: { sourceAddress: '0x1234', mode: 'native' },
  }), {
    connected: false,
    headerLabel: 'Switch network',
    headerAria: 'Switch wallet to Aptos Testnet',
    identityLabel: 'SWITCH TO APTOS TESTNET',
    identityDisabled: false,
    chainLabel: 'APTOS',
  });

  const identityHtml = readPage('identity.html');
  assert.match(identityHtml, /data-wallet-summary/);
  assert.match(identityHtml, /data-wallet-label/);
});
