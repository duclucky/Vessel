import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, PublicKey } from '@solana/web3.js';
import { SolanaSettlementAdapter } from '../src/lib/settlement/solana-adapter.js';

const programId = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const vaultAta = Keypair.generate().publicKey;
const transactionId = bs58.encode(Buffer.alloc(64, 0x77));
const contractQuote = Object.freeze({
  version: 1,
  chain: 2,
  network: 1,
  quoteId: '11'.repeat(32),
  payer: Buffer.from(payer.toBytes()).toString('hex'),
  storageAddress: '33'.repeat(32),
  asset: Buffer.from(mint.toBytes()).toString('hex'),
  amount: '84100',
  fileHash: '55'.repeat(32),
  retentionDays: 30,
  storageExpirationMicros: '1786354494000000',
  quoteExpiresAtSecs: '1785749994',
  configVersion: '1',
});
const [receiptPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('receipt'), Buffer.from(contractQuote.quoteId, 'hex')],
  programId,
);

function receiptData(patch = {}) {
  const fields = {
    quoteId: Buffer.from(contractQuote.quoteId, 'hex'),
    payer,
    storageAddress: Buffer.from(contractQuote.storageAddress, 'hex'),
    asset: mint,
    amount: 84_100n,
    fileHash: Buffer.from(contractQuote.fileHash, 'hex'),
    storageExpirationMicros: BigInt(contractQuote.storageExpirationMicros),
    configVersion: 1n,
    settledSlot: 12345n,
    settledAtSecs: 1_785_749_700n,
    ...patch,
  };
  const data = Buffer.alloc(208);
  Buffer.from([26, 164, 173, 120, 100, 37, 178, 163]).copy(data, 0);
  fields.quoteId.copy(data, 8);
  Buffer.from(fields.payer.toBytes()).copy(data, 40);
  fields.storageAddress.copy(data, 72);
  Buffer.from(fields.asset.toBytes()).copy(data, 104);
  data.writeBigUInt64LE(fields.amount, 136);
  fields.fileHash.copy(data, 144);
  data.writeBigUInt64LE(fields.storageExpirationMicros, 176);
  data.writeBigUInt64LE(fields.configVersion, 184);
  data.writeBigUInt64LE(fields.settledSlot, 192);
  data.writeBigInt64LE(fields.settledAtSecs, 200);
  return data;
}

function finalizedTransaction(patch = {}) {
  const accountKeys = [payer, programId, receiptPda, vaultAta, mint];
  return {
    slot: 12345,
    blockTime: 1_785_749_700,
    transaction: {
      signatures: [transactionId],
      message: {
        accountKeys,
        header: { numRequiredSignatures: 1 },
        instructions: [{ programIdIndex: 1, accounts: [0, 2, 3, 4] }],
      },
    },
    meta: {
      err: null,
      preTokenBalances: [{
        accountIndex: 3,
        mint: mint.toBase58(),
        uiTokenAmount: { amount: '100' },
      }],
      postTokenBalances: [{
        accountIndex: 3,
        mint: mint.toBase58(),
        uiTokenAmount: { amount: '84200' },
      }],
    },
    ...patch,
  };
}

function adapterWith({ transaction = finalizedTransaction(), account = {} } = {}) {
  return new SolanaSettlementAdapter({
    connection: {
      getTransaction: async () => transaction,
      getAccountInfo: async () => ({
        owner: programId,
        data: receiptData(),
        ...account,
      }),
    },
    programId: programId.toBase58(),
    vaultAta: vaultAta.toBase58(),
    acceptedMint: mint.toBase58(),
    network: 1,
  });
}

test('finalized Solana receipt PDA and exact vault delta normalize successfully', async () => {
  let transactionOptions;
  const adapter = new SolanaSettlementAdapter({
    connection: {
      getTransaction: async (_id, options) => {
        transactionOptions = options;
        return finalizedTransaction();
      },
      getAccountInfo: async () => ({ owner: programId, data: receiptData() }),
    },
    programId: programId.toBase58(),
    vaultAta: vaultAta.toBase58(),
    acceptedMint: mint.toBase58(),
    network: 1,
  });
  const receipt = await adapter.verify({ quote: { contractQuote }, transactionId });

  assert.deepEqual(transactionOptions, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  assert.equal(receipt.chain, 'solana');
  assert.equal(receipt.deploymentId, programId.toBase58());
  assert.equal(receipt.quoteId, contractQuote.quoteId);
  assert.equal(receipt.amount, '84100');
  assert.equal(receipt.blockReference, '12345');
  assert.equal(receipt.finalizedAtMs, 1_785_749_700_000);
});

test('missing transaction or receipt account remains retriable', async () => {
  for (const options of [
    { transaction: null },
    { account: null },
  ]) {
    const adapter = options.account === null
      ? new SolanaSettlementAdapter({
        connection: {
          getTransaction: async () => finalizedTransaction(),
          getAccountInfo: async () => null,
        },
        programId: programId.toBase58(),
        vaultAta: vaultAta.toBase58(),
        acceptedMint: mint.toBase58(),
        network: 1,
      })
      : adapterWith(options);
    await assert.rejects(
      () => adapter.verify({ quote: { contractQuote }, transactionId }),
      (error) => error.code === 'receipt_pending' && error.retriable === true,
    );
  }
});

test('Solana adapter rejects failed transactions, owners, receipts, programs, mints, and deltas', async () => {
  const cases = [
    adapterWith({ transaction: finalizedTransaction({ meta: { err: { InstructionError: [1, 'Custom'] } } }) }),
    adapterWith({ transaction: finalizedTransaction({ transaction: {
      signatures: [transactionId],
      message: {
        accountKeys: [payer, receiptPda, vaultAta, mint],
        header: { numRequiredSignatures: 1 },
        instructions: [],
      },
    } }) }),
    adapterWith({ account: { owner: Keypair.generate().publicKey } }),
    adapterWith({ account: { data: Buffer.alloc(208) } }),
    adapterWith({ account: { data: receiptData({ amount: 84_101n }) } }),
    adapterWith({ transaction: finalizedTransaction({ meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 3, mint: mint.toBase58(), uiTokenAmount: { amount: '100' } }],
      postTokenBalances: [{ accountIndex: 3, mint: mint.toBase58(), uiTokenAmount: { amount: '84199' } }],
    } }) }),
    adapterWith({ transaction: finalizedTransaction({ meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 3, mint: payer.toBase58(), uiTokenAmount: { amount: '100' } }],
      postTokenBalances: [{ accountIndex: 3, mint: payer.toBase58(), uiTokenAmount: { amount: '84200' } }],
    } }) }),
  ];

  for (const adapter of cases) {
    await assert.rejects(
      () => adapter.verify({ quote: { contractQuote }, transactionId }),
      (error) => error.code === 'invalid_settlement_receipt' && error.retriable === false,
    );
  }
});
