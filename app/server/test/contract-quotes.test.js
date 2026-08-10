import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import bs58 from 'bs58';
import {
  assertContractQuoteMatchesContext,
  ContractQuoteManager,
  verifyContractQuoteSignature,
} from '../src/lib/settlement/contract-quotes.js';

const breakdown = Object.freeze({
  tierId: 0,
  configVersion: 'cfg-1',
  paymentEpochs: 7,
  chunksetCount: '1',
  storageSpShelbyUsdUnits: '1170',
  storageAdminShelbyUsdUnits: '90',
  storageShelbyUsdUnits: '1260',
  storageAccountingMicro: '13',
  gasOctas: '700000',
  gasAccountingMicro: '35000',
  subtotalAccountingMicro: '35013',
  serviceFeeAccountingMicro: '841',
  totalAccountingMicro: '35854',
  minimumApplied: false,
});

const aptosContext = Object.freeze({
  operation: 'upload',
  chain: 'aptos',
  sourceNetwork: 'aptos-testnet',
  storageNetwork: 'shelby-testnet',
  sourceAddress: `0x${'22'.repeat(32)}`,
  storageAddress: `0x${'33'.repeat(32)}`,
  fileHash: '55'.repeat(32),
  blobName: `media/${'55'.repeat(32)}.png`,
  sizeBytes: 42,
  contentType: 'image/png',
  encoding: 0,
  days: 7,
  expirationMicros: 1_786_354_494_000_000,
});

const keys = () => generateKeyPairSync('ed25519');

test('contract quote is signed by the configured Ed25519 key', async () => {
  const { privateKey, publicKey } = keys();
  const manager = ContractQuoteManager.forTest({
    privateKey,
    publicKey,
    now: () => 1_785_749_694_000n,
    pricing: async () => breakdown,
    randomBytes: () => Buffer.alloc(32, 0x11),
  });

  const result = await manager.issueUpload(aptosContext);

  assert.equal(result.contractQuote.quoteExpiresAtSecs, '1785749994');
  assert.equal(result.contractQuote.amount, '84100');
  assert.equal(result.contractSignature.length, 128);
  assert.equal(result.quotePublicKey.length, 64);
  assert.equal(manager.verifySignature(result), true);
  assert.equal(verifyContractQuoteSignature(result), true);
  assert.equal(manager.verifySignature({
    ...result,
    contractQuote: { ...result.contractQuote, amount: '84101' },
  }), false);
});

test('Aptos-style @ storage addresses are accepted in contract quotes', async () => {
  const { privateKey, publicKey } = keys();
  const storageHex = '4d'.repeat(32);
  const manager = ContractQuoteManager.forTest({
    privateKey,
    publicKey,
    now: () => 1_785_749_694_000n,
    pricing: async () => breakdown,
    randomBytes: () => Buffer.alloc(32, 0x11),
  });

  const result = await manager.issueUpload({
    ...aptosContext,
    storageAddress: `@${storageHex}`,
  });

  assert.equal(result.contractQuote.storageAddress, storageHex);
});

test('Solana quote collects the total accounting amount and expires after five minutes', async () => {
  const { privateKey, publicKey } = keys();
  const manager = ContractQuoteManager.forTest({
    privateKey,
    publicKey,
    now: () => 1_000_000n,
    pricing: async () => breakdown,
    solanaMintHex: '66'.repeat(32),
  });

  const result = await manager.issueUpload({
    ...aptosContext,
    chain: 'solana',
    sourceNetwork: 'solana-devnet',
    sourceAddress: '11111111111111111111111111111111',
    days: 30,
  });

  assert.equal(result.contractQuote.chain, 2);
  assert.equal(result.contractQuote.network, 1);
  assert.equal(result.contractQuote.amount, breakdown.totalAccountingMicro);
  assert.equal(result.contractQuote.quoteExpiresAtSecs, '1300');
  assert.equal(manager.verifySignature(result), true);
});

test('Ethereum DAA quote targets Sepolia settlement while storage stays on ShelbyNet', async () => {
  const { privateKey, publicKey } = keys();
  const manager = ContractQuoteManager.forTest({
    privateKey,
    publicKey,
    now: () => 1_000_000n,
    pricing: async () => breakdown,
    evmAssetHex: 'ee'.repeat(32),
    evmNetwork: 11155111,
  });
  const context = {
    ...aptosContext,
    chain: 'evm',
    sourceNetwork: 'sepolia',
    storageNetwork: 'shelbynet',
    sourceAddress: '0x1234567890abcdef1234567890abcdef12345678',
  };

  const result = await manager.issueUpload(context);
  const signedQuote = { context, breakdown };
  const deployments = {
    configVersion: '1',
    aptos: { acceptedAsset: `0x${'44'.repeat(32)}` },
    solana: { acceptedMint: bs58.encode(Buffer.from('66'.repeat(32), 'hex')) },
    evm: { chainId: 11155111, acceptedAsset: `0x${'ee'.repeat(32)}` },
  };

  assert.equal(result.contractQuote.chain, 3);
  assert.equal(result.contractQuote.network, 11155111);
  assert.equal(result.contractQuote.payer, '0000000000000000000000001234567890abcdef1234567890abcdef12345678');
  assert.equal(result.contractQuote.storageAddress, '33'.repeat(32));
  assert.equal(result.contractQuote.asset, 'ee'.repeat(32));
  assert.equal(result.contractQuote.amount, breakdown.serviceFeeAccountingMicro);
  assert.equal(manager.verifySignature(result), true);
  assert.doesNotThrow(() => assertContractQuoteMatchesContext(
    result.contractQuote,
    signedQuote,
    deployments,
  ));
});

test('precomputed contract quote reuses the server breakdown without another pricing read', async () => {
  const { privateKey, publicKey } = keys();
  let pricingCalls = 0;
  const manager = ContractQuoteManager.forTest({
    privateKey,
    publicKey,
    now: () => 1_000_000n,
    pricing: async () => {
      pricingCalls += 1;
      return breakdown;
    },
  });

  const result = await manager.issueUploadFromBreakdown(aptosContext, breakdown);

  assert.equal(pricingCalls, 0);
  assert.equal(result.contractQuote.amount, '84100');
  assert.equal(manager.verifySignature(result), true);
});

test('Aptos contract quote uses the deployed runtime chain ID', async () => {
  const { privateKey, publicKey } = keys();
  const manager = ContractQuoteManager.forTest({
    privateKey,
    publicKey,
    now: () => 1_000_000n,
    pricing: async () => breakdown,
    aptosNetwork: 118,
  });

  const result = await manager.issueUpload({
    ...aptosContext,
    sourceNetwork: 'shelbynet',
    storageNetwork: 'shelbynet',
  });
  const signedQuote = {
    context: {
      ...aptosContext,
      sourceNetwork: 'shelbynet',
      storageNetwork: 'shelbynet',
    },
    breakdown,
  };
  const deployments = {
    configVersion: '1',
    aptos: { acceptedAsset: `0x${'44'.repeat(32)}`, chainId: 118 },
    solana: { acceptedMint: bs58.encode(Buffer.from('66'.repeat(32), 'hex')) },
  };

  assert.equal(result.contractQuote.chain, 1);
  assert.equal(result.contractQuote.network, 118);
  assert.doesNotThrow(() => assertContractQuoteMatchesContext(
    result.contractQuote,
    signedQuote,
    deployments,
  ));
  assert.throws(
    () => assertContractQuoteMatchesContext(
      { ...result.contractQuote, network: 2 },
      signedQuote,
      deployments,
    ),
    (error) => error.code === 'quote_context_mismatch',
  );
});

test('contract overlap validation binds every Solana context field before RPC', async () => {
  const { privateKey, publicKey } = keys();
  const manager = ContractQuoteManager.forTest({
    privateKey,
    publicKey,
    now: () => 1_000_000n,
    pricing: async () => breakdown,
    solanaMintHex: '66'.repeat(32),
  });
  const context = {
    ...aptosContext,
    chain: 'solana',
    sourceNetwork: 'solana-devnet',
    sourceAddress: '11111111111111111111111111111111',
    days: 30,
  };
  const issued = await manager.issueUpload(context);
  const signedQuote = { context, breakdown };
  const deployments = {
    configVersion: '1',
    aptos: { acceptedAsset: `0x${'44'.repeat(32)}` },
    solana: { acceptedMint: bs58.encode(Buffer.from('66'.repeat(32), 'hex')) },
  };

  assert.doesNotThrow(() => assertContractQuoteMatchesContext(
    issued.contractQuote,
    signedQuote,
    deployments,
  ));
  for (const change of [
    { network: 2 },
    { payer: '77'.repeat(32) },
    { storageAddress: '77'.repeat(32) },
    { asset: '77'.repeat(32) },
    { amount: '1' },
  ]) {
    assert.throws(
      () => assertContractQuoteMatchesContext(
        { ...issued.contractQuote, ...change },
        signedQuote,
        deployments,
      ),
      (error) => error.code === 'quote_context_mismatch' && error.retriable === false,
    );
  }
});

test('contract quote manager rejects a mismatched key pair', () => {
  const first = keys();
  const second = keys();
  assert.throws(() => new ContractQuoteManager({
    privateKey: first.privateKey,
    publicKey: second.publicKey,
    priceUpload: async () => breakdown,
    aptosAssetHex: '44'.repeat(32),
    solanaMintHex: '66'.repeat(32),
    configVersion: 1,
  }), /key pair/i);
});
