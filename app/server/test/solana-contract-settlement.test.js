import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ComputeBudgetProgram,
  Ed25519Program,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { submitSolanaContractSettlement } from '../client-src/wallets/solana-contract-settlement.js';

const ownerKeypair = Keypair.generate();
const owner = ownerKeypair.publicKey;
const mint = Keypair.generate().publicKey;
const programId = Keypair.generate().publicKey;
const quoteId = Buffer.alloc(32, 0x11);
const quote = Object.freeze({
  version: 1,
  chain: 2,
  network: 1,
  quoteId: quoteId.toString('hex'),
  payer: Buffer.from(owner.toBytes()).toString('hex'),
  storageAddress: '33'.repeat(32),
  asset: Buffer.from(mint.toBytes()).toString('hex'),
  amount: '84100',
  fileHash: '55'.repeat(32),
  retentionDays: 30,
  storageExpirationMicros: '1786354494000000',
  quoteExpiresAtSecs: '1785749994',
  configVersion: '1',
});

const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault-authority')],
  programId,
);
const [receiptPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('receipt'), quoteId],
  programId,
);
const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority, true);

const deployment = Object.freeze({
  programId: programId.toBase58(),
  acceptedMint: mint.toBase58(),
  configPda: configPda.toBase58(),
  vaultAta: vaultAta.toBase58(),
  quotePublicKey: '77'.repeat(32),
});

test('Solana wallet signs then broadcasts the verified transaction through Devnet RPC', async () => {
  let submitted;
  let legacySubmissions = 0;
  const provider = {
    publicKey: owner,
    async signTransaction(transaction) {
      submitted = transaction;
      transaction.partialSign(ownerKeypair);
      return { signedTransaction: transaction.serialize() };
    },
    async signAndSendTransaction() {
      legacySubmissions += 1;
    },
  };
  let broadcasted;
  const connection = {
    async getLatestBlockhash() {
      return { blockhash: Keypair.generate().publicKey.toBase58() };
    },
    async sendRawTransaction(bytes, options) {
      broadcasted = { bytes, options };
      return 'solana-contract-tx';
    },
  };

  const result = await submitSolanaContractSettlement({
    provider,
    connection,
    deployment,
    contractQuote: quote,
    contractSignature: '66'.repeat(64),
  });

  assert.deepEqual(result, { transactionId: 'solana-contract-tx' });
  assert.equal(legacySubmissions, 0);
  assert.equal(Transaction.from(broadcasted.bytes).verifySignatures(), true);
  assert.equal(broadcasted.options.preflightCommitment, 'confirmed');
  assert.equal(submitted.instructions.length, 4);
  assert.equal(submitted.instructions[0].programId.toBase58(), ComputeBudgetProgram.programId.toBase58());
  assert.equal(submitted.instructions[1].programId.toBase58(), ComputeBudgetProgram.programId.toBase58());
  assert.equal(submitted.instructions[2].programId.toBase58(), Ed25519Program.programId.toBase58());
  assert.equal(submitted.instructions[3].programId.toBase58(), programId.toBase58());
  assert.equal(submitted.feePayer.toBase58(), owner.toBase58());
  const settlementKeys = submitted.instructions[3].keys.map(({ pubkey }) => pubkey.toBase58());
  for (const expected of [configPda, receiptPda, vaultAuthority, vaultAta]) {
    assert.ok(settlementKeys.includes(expected.toBase58()));
  }
  assert.equal(
    submitted.instructions[3].keys.find(({ pubkey }) => pubkey.equals(owner)).isSigner,
    true,
  );
});

test('browser settlement builder copies Ed25519 bytes without Buffer.fill coercion', () => {
  const source = fs.readFileSync(
    new URL('../client-src/wallets/solana-contract-settlement.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /Ed25519Program\.createInstructionWithPublicKey/);
  assert.match(source, /instructionData\.set\(publicKey, PUBLIC_KEY_OFFSET\)/);
  assert.match(source, /instructionData\.set\(signature, SIGNATURE_OFFSET\)/);
  assert.match(source, /instructionData\.set\(message, MESSAGE_OFFSET\)/);
});

test('wallet may refresh the blockhash and add compute budget instructions', async () => {
  let broadcasts = 0;
  const refreshedBlockhash = Keypair.generate().publicKey.toBase58();
  const result = await submitSolanaContractSettlement({
    provider: {
      publicKey: owner,
      async signTransaction(transaction) {
        transaction.recentBlockhash = refreshedBlockhash;
        transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
        transaction.partialSign(ownerKeypair);
        return { signedTransaction: transaction.serialize() };
      },
    },
    connection: {
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
      sendRawTransaction: async (bytes) => {
        broadcasts += 1;
        assert.equal(Transaction.from(bytes).recentBlockhash, refreshedBlockhash);
        return 'refreshed-blockhash-tx';
      },
    },
    deployment,
    contractQuote: quote,
    contractSignature: '66'.repeat(64),
  });

  assert.deepEqual(result, { transactionId: 'refreshed-blockhash-tx' });
  assert.equal(broadcasts, 1);
});

test('instruction mutations or unsigned wallet results fail before Devnet broadcast', async () => {
  for (const kind of ['mutated', 'unsigned']) {
    let broadcasts = 0;
    const provider = {
      publicKey: owner,
      async signTransaction(transaction) {
        if (kind === 'mutated') {
          transaction.instructions.at(-1).data = Buffer.from([0xde, 0xad]);
          transaction.partialSign(ownerKeypair);
          return { signedTransaction: transaction.serialize() };
        }
        return {
          signedTransaction: transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        };
      },
    };
    const connection = {
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
      sendRawTransaction: async () => {
        broadcasts += 1;
        return 'must-not-broadcast';
      },
    };

    await assert.rejects(
      () => submitSolanaContractSettlement({
        provider,
        connection,
        deployment,
        contractQuote: quote,
        contractSignature: '66'.repeat(64),
      }),
      kind === 'mutated' ? /changed/i : /signature/i,
    );
    assert.equal(broadcasts, 0);
  }
});

test('simulation failures surface the final program logs instead of truncating the RPC preamble', async () => {
  const provider = {
    publicKey: owner,
    async signTransaction(transaction) {
      transaction.partialSign(ownerKeypair);
      return { signedTransaction: transaction.serialize() };
    },
  };
  const simulationError = Object.assign(new Error(
    'Transaction simulation failed: Error processing Instruction 3: custom program error: 0x2',
  ), {
    transactionMessage: 'Transaction simulation failed: Error processing Instruction 3: custom program error: 0x2',
    transactionLogs: [
      'Program ComputeBudget111111111111111111111111111111 success',
      'Program log: TransferChecked failed: TokenError::InvalidMint',
      `Program ${programId.toBase58()} failed: custom program error: 0x2`,
    ],
  });
  await assert.rejects(
    () => submitSolanaContractSettlement({
      provider,
      connection: {
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
        sendRawTransaction: async () => { throw simulationError; },
      },
      deployment,
      contractQuote: quote,
      contractSignature: '66'.repeat(64),
    }),
    new RegExp(`${programId.toBase58()}.*InvalidMint`),
  );
});

test('wallets without signTransaction retain the signAndSend fallback', async () => {
  let submissions = 0;
  const result = await submitSolanaContractSettlement({
    provider: {
      publicKey: owner,
      async signAndSendTransaction() {
        submissions += 1;
        return { signature: 'fallback-contract-tx' };
      },
    },
    connection: {
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
    },
    deployment,
    contractQuote: quote,
    contractSignature: '66'.repeat(64),
  });

  assert.deepEqual(result, { transactionId: 'fallback-contract-tx' });
  assert.equal(submissions, 1);
});

test('mismatched payer and undeployed program fail before opening the wallet', async () => {
  let approvals = 0;
  const provider = {
    publicKey: owner,
    async signAndSendTransaction() {
      approvals += 1;
    },
  };
  const connection = { getLatestBlockhash: async () => ({ blockhash: owner.toBase58() }) };
  for (const patch of [
    { contractQuote: { ...quote, payer: '99'.repeat(32) } },
    { deployment: { ...deployment, programId: '11111111111111111111111111111111' } },
  ]) {
    await assert.rejects(() => submitSolanaContractSettlement({
      provider,
      connection,
      deployment,
      contractQuote: quote,
      contractSignature: '66'.repeat(64),
      ...patch,
    }));
  }
  assert.equal(approvals, 0);
});
