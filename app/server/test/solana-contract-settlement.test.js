import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Ed25519Program,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { submitSolanaContractSettlement } from '../client-src/wallets/solana-contract-settlement.js';

const owner = Keypair.generate().publicKey;
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

test('Solana wallet submits Ed25519 verification immediately before Vessel settlement', async () => {
  let submitted;
  const provider = {
    publicKey: owner,
    async signAndSendTransaction(transaction) {
      submitted = transaction;
      return { signature: 'solana-contract-tx' };
    },
  };
  const connection = {
    async getLatestBlockhash() {
      return { blockhash: Keypair.generate().publicKey.toBase58() };
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
  assert.equal(submitted.instructions.length, 2);
  assert.equal(submitted.instructions[0].programId.toBase58(), Ed25519Program.programId.toBase58());
  assert.equal(submitted.instructions[1].programId.toBase58(), programId.toBase58());
  assert.equal(submitted.feePayer.toBase58(), owner.toBase58());
  const settlementKeys = submitted.instructions[1].keys.map(({ pubkey }) => pubkey.toBase58());
  for (const expected of [configPda, receiptPda, vaultAuthority, vaultAta]) {
    assert.ok(settlementKeys.includes(expected.toBase58()));
  }
  assert.equal(
    submitted.instructions[1].keys.find(({ pubkey }) => pubkey.equals(owner)).isSigner,
    true,
  );
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
