import test from 'node:test';
import assert from 'node:assert/strict';
import { settleQuote } from '../public/settlement-client.js';

test('Solana settlement pays the exact quote amount and verifies its signed token', async () => {
  const calls = [];
  const result = await settleQuote({
    quote: {
      chain: 'solana',
      quoteId: 'quote-1',
      quoteToken: 'vquote.signed',
      solanaAmountMicro: '35714',
      treasuryAta: 'treasury-ata',
      usdcMint: 'devnet-usdc',
      sourceAddress: 'solana-owner',
    },
    session: { chain: 'solana', sourceAddress: 'solana-owner' },
    solanaClient: {
      payUSDC: async (input) => { calls.push(['pay', input]); return { signature: 'solana-tx' }; },
    },
    request: async (path, options) => {
      calls.push(['request', path, options]);
      return { ok: true, paidAuthorization: 'vpaid.solana', settlementHash: 'solana-tx' };
    },
  });

  assert.equal(calls[0][1].amountMicro, '35714');
  assert.equal(calls[0][1].memo, 'quote-1');
  assert.deepEqual(calls[1].slice(1), [
    '/api/pay/solana/verify',
    { method: 'POST', body: { quoteToken: 'vquote.signed', signature: 'solana-tx' } },
  ]);
  assert.deepEqual(result, { paidAuthorization: 'vpaid.solana', settlementHash: 'solana-tx' });
});

test('native Aptos settlement transfers the exact ShelbyUSD service fee before verification', async () => {
  let signedPayload;
  let verification;
  const result = await settleQuote({
    quote: {
      chain: 'aptos',
      quoteToken: 'vquote.aptos',
      nativeServiceFeeShelbyUsdUnits: '999900',
      aptosTreasuryAddress: '0xtreasury',
      shelbyUsdAssetAddress: '0xshelby',
      sourceAddress: '0xowner',
    },
    session: { chain: 'aptos', sourceAddress: '0xowner' },
    aptosAdapter: {
      signAndSubmitTransaction: async ({ data }) => {
        signedPayload = data;
        return { hash: '0xservicefee' };
      },
    },
    request: async (path, options) => {
      verification = { path, options };
      return { ok: true, paidAuthorization: 'vpaid.aptos', settlementHash: '0xservicefee' };
    },
  });

  assert.deepEqual(signedPayload, {
    function: '0x1::primary_fungible_store::transfer',
    functionArguments: ['0xshelby', '0xtreasury', '999900'],
  });
  assert.deepEqual(verification, {
    path: '/api/pay/aptos/verify',
    options: { method: 'POST', body: { quoteToken: 'vquote.aptos', transactionHash: '0xservicefee' } },
  });
  assert.deepEqual(result, { paidAuthorization: 'vpaid.aptos', settlementHash: '0xservicefee' });
});

test('settlement rejects a mismatched session before opening an approval', async () => {
  await assert.rejects(
    () => settleQuote({
      quote: { chain: 'aptos', sourceAddress: '0xquoted' },
      session: { chain: 'aptos', sourceAddress: '0xchanged' },
      aptosAdapter: {},
      request: async () => ({}),
    }),
    (error) => error.code === 'settlement_context_mismatch',
  );
});
