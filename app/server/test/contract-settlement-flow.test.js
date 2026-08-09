import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import bs58 from 'bs58';
import { settleContractQuote } from '../public/contract-settlement-client.js';
import { createRecoveryLedger } from '../public/recovery-ledger.js';
import { createLedger } from '../public/ledger.js';
import { reconcileArtifacts } from '../client-src/wallets/artifact-reconciler.js';
import { extractShelbyTransactionEvidence } from '../client-src/wallets/transaction-evidence.js';
import { QuoteManager } from '../src/lib/quotes.js';
import {
  assertContractQuoteMatchesContext,
  ContractQuoteManager,
  verifyContractQuoteSignature,
} from '../src/lib/settlement/contract-quotes.js';
import { SettlementAdapterRegistry } from '../src/lib/settlement/adapters.js';
import { PaidAuthorizationManager } from '../src/lib/paid-authorizations.js';

const SECRET = 'contract-flow-test-secret-at-least-32-bytes';
const NOW_MS = 1_785_749_694_000;
const APTOS_ASSET = `0x${'44'.repeat(32)}`;
const SOLANA_MINT_HEX = '66'.repeat(32);
const SOLANA_MINT = bs58.encode(Buffer.from(SOLANA_MINT_HEX, 'hex'));
const STORAGE_ADDRESS = `0x${'33'.repeat(32)}`;

const breakdown = Object.freeze({
  tierId: 0,
  configVersion: 'shelby-1',
  paymentEpochs: 30,
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

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function chainContext(chain) {
  return Object.freeze({
    operation: 'upload',
    chain,
    sourceNetwork: chain === 'aptos' ? 'aptos-testnet' : 'solana-devnet',
    storageNetwork: 'shelby-testnet',
    sourceAddress: chain === 'aptos'
      ? `0x${'22'.repeat(32)}`
      : '11111111111111111111111111111111',
    storageAddress: STORAGE_ADDRESS,
    fileHash: '55'.repeat(32),
    blobName: `media/${'55'.repeat(32)}.png`,
    sizeBytes: 42,
    contentType: 'image/png',
    encoding: 0,
    days: chain === 'aptos' ? 7 : 30,
    expirationMicros: chain === 'aptos' ? 1_786_354_494_000_000 : 1_788_341_694_000_000,
  });
}

function harness(chain, { pendingOnce = false } = {}) {
  const keys = generateKeyPairSync('ed25519');
  const contractQuotes = ContractQuoteManager.forTest({
    ...keys,
    now: () => BigInt(NOW_MS),
    pricing: async () => breakdown,
    randomBytes: () => Buffer.alloc(32, chain === 'aptos' ? 0x11 : 0x12),
    aptosAssetHex: APTOS_ASSET,
    solanaMintHex: SOLANA_MINT_HEX,
    configVersion: 1,
  });
  const quotes = new QuoteManager({
    secret: SECRET,
    environment: 'test',
    now: () => NOW_MS,
    priceUpload: async () => breakdown,
    contractQuoteManager: contractQuotes,
  });
  const deployments = Object.freeze({
    configVersion: '1',
    aptos: Object.freeze({ acceptedAsset: APTOS_ASSET }),
    solana: Object.freeze({ acceptedMint: SOLANA_MINT }),
  });
  const deploymentId = chain === 'aptos'
    ? `0x${'aa'.repeat(32)}::vessel_settlement`
    : 'CGsM9YkQZEvyfkKrVwNxuQfoXrw7U4AytLEiQz2GH2Th';
  let pending = pendingOnce;
  let block = 100;
  const adapter = {
    deploymentId,
    async verify({ quote, transactionId }) {
      if (pending) {
        pending = false;
        throw Object.assign(new Error('Receipt pending'), {
          code: 'receipt_pending', status: 409, retriable: true,
        });
      }
      const signed = quote.contractQuote;
      return {
        chain,
        network: signed.network,
        deploymentId,
        quoteId: signed.quoteId,
        payer: signed.payer,
        storageAddress: signed.storageAddress,
        asset: signed.asset,
        amount: signed.amount,
        fileHash: signed.fileHash,
        storageExpirationMicros: signed.storageExpirationMicros,
        transactionId,
        blockReference: String(block++),
        finalizedAtMs: NOW_MS + 4_000,
        configVersion: signed.configVersion,
      };
    },
  };
  const adapters = new SettlementAdapterRegistry({ [chain]: adapter });
  const authorizations = new PaidAuthorizationManager({
    secret: SECRET,
    now: () => NOW_MS + 5_000,
    settlementContractsEnabled: true,
  });

  async function request(_path, { body }) {
    const signedServerQuote = quotes.validate(body.quoteToken, body.uploadContext, {
      allowExpired: true,
    });
    const evidence = {
      quoteToken: body.quoteToken,
      uploadContext: signedServerQuote.context,
      contractQuote: body.contractQuote,
      contractSignature: body.contractSignature,
      quotePublicKey: contractQuotes.publicKeyHex,
    };
    if (!verifyContractQuoteSignature(evidence)) throw new Error('Invalid contract signature');
    assertContractQuoteMatchesContext(body.contractQuote, signedServerQuote, deployments);
    const receipt = await adapters.verify({
      chain: signedServerQuote.context.chain,
      quote: evidence,
      transactionId: body.transactionId,
    });
    return {
      paidAuthorization: authorizations.issue({ quote: evidence, receipt }),
      receipt,
    };
  }

  return { quotes, deployments, authorizations, request };
}

async function runInterruptedFlow(chain) {
  const context = chainContext(chain);
  const flow = harness(chain, { pendingOnce: true });
  const quote = await flow.quotes.issueUpload(context);
  const recoveryStorage = memoryStorage();
  const recovery = createRecoveryLedger(recoveryStorage, () => NOW_MS);
  recovery.save({
    id: quote.quoteId,
    stage: 'quoted',
    walletIdentity: context,
    quoteId: quote.quoteId,
    quoteToken: quote.quoteToken,
    context,
    contractQuote: quote.contractQuote,
    contractSignature: quote.contractSignature,
    quotePublicKey: quote.quotePublicKey,
  });
  let submits = 0;
  const chainClient = {
    submit: async () => ({ transactionId: `${chain}-contract-tx-${++submits}` }),
  };

  await assert.rejects(() => settleContractQuote({
    quote,
    chainClient,
    request: flow.request,
    onSubmitted: ({ transactionId }) => recovery.advance(
      quote.quoteId,
      'settlement_submitted',
      { settlementTransactionId: transactionId },
    ),
  }), (error) => error.code === 'receipt_pending');

  const submitted = recovery.loadForWallet(context)[0];
  const verified = await settleContractQuote({
    quote,
    chainClient,
    request: flow.request,
    transactionId: submitted.settlementTransactionId,
  });
  recovery.advance(quote.quoteId, 'paid', {
    paidAuthorization: verified.paidAuthorization,
    settlementHash: verified.receipt.transactionId,
  });
  const restartedRecovery = createRecoveryLedger(recoveryStorage, () => NOW_MS + 10_000);
  assert.equal(restartedRecovery.loadForWallet(context)[0].stage, 'paid');
  flow.authorizations.validate(verified.paidAuthorization, quote, {
    transactionId: verified.receipt.transactionId,
  });

  const registration = extractShelbyTransactionEvidence({
    success: true,
    hash: `${chain}-register-tx`,
    gas_used: '718',
    events: [{
      type: '0x42::blob_metadata::BlobRegisteredEvent',
      data: { payment_amount: '4200', blob_name: context.blobName },
    }],
  });
  const ledger = createLedger(memoryStorage(), () => NOW_MS + 10_000);
  ledger.commitUpload({
    key: context.blobName,
    url: `https://shelby.example/${context.blobName}`,
    size: context.sizeBytes,
    contentType: context.contentType,
    ownedByYou: true,
    account: context.storageAddress,
    expirationMicros: context.expirationMicros,
    ...registration,
    acknowledgementHash: `${chain}-bytes-ack`,
    settlementHash: verified.receipt.transactionId,
  });
  const gallery = reconcileArtifacts(ledger.loadMine(), [{
    owner: context.storageAddress,
    blobNameSuffix: context.blobName,
    size: context.sizeBytes,
    creationMicros: NOW_MS * 1_000,
    expirationMicros: context.expirationMicros,
    isWritten: true,
    isDeleted: false,
  }], context);

  return { submits, quote, verified, recovery: restartedRecovery, gallery };
}

test('Aptos 7-day contract flow resumes after submission and reaches Gallery without a second approval', async () => {
  const result = await runInterruptedFlow('aptos');
  assert.equal(result.submits, 1);
  assert.equal(result.quote.days, 7);
  assert.equal(result.gallery[0].state, 'active');
  assert.equal(result.gallery[0].paymentSignature, 'aptos-contract-tx-1');
});

test('Solana 30-day DAA contract flow resumes after submission and reaches Gallery without a second approval', async () => {
  const result = await runInterruptedFlow('solana');
  assert.equal(result.submits, 1);
  assert.equal(result.quote.days, 30);
  assert.equal(result.gallery[0].state, 'active');
  assert.equal(result.gallery[0].paymentSignature, 'solana-contract-tx-1');
});

test('wallet, network, file, retention, and expiration mutations fail before contract submission', async () => {
  const flow = harness('aptos');
  const context = chainContext('aptos');
  const quote = await flow.quotes.issueUpload(context);
  let submits = 0;
  const chainClient = { submit: async () => ({ transactionId: `tx-${++submits}` }) };
  for (const change of [
    { sourceAddress: `0x${'99'.repeat(32)}` },
    { storageAddress: `0x${'98'.repeat(32)}` },
    { sourceNetwork: 'aptos-mainnet' },
    { fileHash: '97'.repeat(32) },
    { days: 8 },
    { expirationMicros: context.expirationMicros + 1 },
  ]) {
    const changed = { ...context, ...change };
    assert.throws(() => flow.quotes.validate(quote.quoteToken, changed), /context/i);
  }
  assert.equal(submits, 0);
  await assert.rejects(() => settleContractQuote({
    quote: { ...quote, contractSignature: '00'.repeat(64) },
    chainClient,
    request: flow.request,
  }), /contract signature/i);
  assert.equal(submits, 1);
});

test('contract authorization rejects ordinary direct-transfer evidence', async () => {
  const flow = harness('solana');
  const quote = await flow.quotes.issueUpload(chainContext('solana'));
  assert.throws(
    () => flow.authorizations.issue({
      quote,
      settlementChain: 'solana',
      settlementHash: 'ordinary-wallet-transfer',
    }),
    /receipt/i,
  );
});
