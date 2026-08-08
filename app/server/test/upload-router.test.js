import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadRouter } from '../client-src/wallets/upload-router.js';

test('native Aptos routes only to the direct wallet upload', async () => {
  const calls = [];
  const router = createUploadRouter({
    aptosUpload: async () => { calls.push('aptos'); return { paymentMode: 'native-aptos' }; },
    solanaUpload: async () => { calls.push('solana'); },
  });

  const result = await router.upload({}, {
    session: { chain: 'aptos', mode: 'native' },
  });

  assert.deepEqual(calls, ['aptos']);
  assert.equal(result.paymentMode, 'native-aptos');
});

test('Solana DAA routes only to the sponsored compatibility upload', async () => {
  const calls = [];
  const router = createUploadRouter({
    aptosUpload: async () => { calls.push('aptos'); },
    solanaUpload: async () => { calls.push('solana'); return { paymentMode: 'solana-usdc' }; },
  });

  const result = await router.upload({}, {
    session: { chain: 'solana', mode: 'daa' },
  });

  assert.deepEqual(calls, ['solana']);
  assert.equal(result.paymentMode, 'solana-usdc');
});

test('Ethereum DAA routes to the sponsored ShelbyNet upload', async () => {
  const calls = [];
  const router = createUploadRouter({
    aptosUpload: async () => { calls.push('aptos'); },
    solanaUpload: async () => { calls.push('solana'); },
    evmUpload: async () => { calls.push('evm'); return { paymentMode: 'evm-sepolia' }; },
  });

  const result = await router.upload({}, {
    session: { chain: 'evm', mode: 'daa' },
  });

  assert.deepEqual(calls, ['evm']);
  assert.equal(result.paymentMode, 'evm-sepolia');
});

test('upload refuses a disconnected or unsupported session', async () => {
  const router = createUploadRouter({ aptosUpload: async () => {}, solanaUpload: async () => {} });
  await assert.rejects(() => router.upload({}, { session: null }), /Connect a wallet/);
  await assert.rejects(
    () => router.upload({}, { session: { chain: 'evm', mode: 'beta' } }),
    /unavailable for evm/,
  );
});
