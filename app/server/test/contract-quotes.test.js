import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { ContractQuoteManager } from '../src/lib/settlement/contract-quotes.js';

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
  assert.equal(manager.verifySignature({
    ...result,
    contractQuote: { ...result.contractQuote, amount: '84101' },
  }), false);
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
