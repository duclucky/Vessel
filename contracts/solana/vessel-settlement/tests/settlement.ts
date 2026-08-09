import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as anchor from '@anchor-lang/core';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from '@solana/spl-token';
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

const DOMAIN = Buffer.from('VESSEL_SETTLEMENT_V1', 'ascii');

function u16(value: number) {
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value);
  return output;
}

function u32(value: number) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
  return output;
}

function u64(value: anchor.BN) {
  return value.toArrayLike(Buffer, 'le', 8);
}

function vector32(value: number[]) {
  return Buffer.concat([Buffer.from([32]), Buffer.from(value)]);
}

function quoteDigest(quote: any) {
  const encoded = Buffer.concat([
    Buffer.from([quote.version, quote.chain]),
    u32(quote.network),
    vector32(quote.quoteId),
    vector32(quote.payer),
    vector32(quote.storageAddress),
    vector32(quote.asset),
    u64(quote.amount),
    vector32(quote.fileHash),
    u16(quote.retentionDays),
    u64(quote.storageExpirationMicros),
    u64(quote.quoteExpiresAtSecs),
    u64(quote.configVersion),
  ]);
  return createHash('sha256').update(DOMAIN).update(encoded).digest();
}

describe('Vessel Solana settlement', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = anchor.workspace.vesselSettlement;
  const payer = (provider.wallet as any).payer as Keypair;
  const quoteSigner = Keypair.generate();
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority')],
    program.programId,
  );

  let mint: PublicKey;
  let payerAta: PublicKey;
  let vaultAta: PublicKey;

  before(async () => {
    mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    payerAta = await createAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey);
    vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority, true);
    await mintTo(provider.connection, payer, mint, payerAta, payer, 2_000_000n);

    await program.methods
      .initialize(
        Array.from(quoteSigner.publicKey.toBytes()),
        payer.publicKey,
        1,
        new anchor.BN(1),
      )
      .accounts({
        payer: payer.publicKey,
        config,
        vaultAuthority,
        mint,
        vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  function makeQuote(patch: Record<string, unknown> = {}) {
    const nowSecs = Math.floor(Date.now() / 1000);
    return {
      version: 1,
      chain: 2,
      network: 1,
      quoteId: Array.from(Keypair.generate().publicKey.toBytes()),
      payer: Array.from(payer.publicKey.toBytes()),
      storageAddress: Array.from(Keypair.generate().publicKey.toBytes()),
      asset: Array.from(mint.toBytes()),
      amount: new anchor.BN(84_100),
      fileHash: Array.from(Buffer.alloc(32, 0x55)),
      retentionDays: 30,
      storageExpirationMicros: new anchor.BN((nowSecs + 30 * 86_400) * 1_000_000),
      quoteExpiresAtSecs: new anchor.BN(nowSecs + 300),
      configVersion: new anchor.BN(1),
      ...patch,
    };
  }

  function receiptFor(quote: any) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('receipt'), Buffer.from(quote.quoteId)],
      program.programId,
    )[0];
  }

  async function settleInstruction(
    quote: any,
    overrides: Record<string, PublicKey> = {},
  ) {
    return program.methods
      .settle(quote)
      .accounts({
        payer: payer.publicKey,
        config,
        receipt: receiptFor(quote),
        mint,
        payerAta,
        vaultAta,
        vaultAuthority,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...overrides,
      })
      .instruction();
  }

  function proofInstruction(quote: any, signer = quoteSigner, message = quoteDigest(quote)) {
    return Ed25519Program.createInstructionWithPrivateKey({
      privateKey: signer.secretKey,
      message,
    });
  }

  async function assertRejectedWithoutDebit(transaction: Transaction) {
    const payerBefore = (await getAccount(provider.connection, payerAta)).amount;
    const vaultBefore = (await getAccount(provider.connection, vaultAta)).amount;
    await assert.rejects(provider.sendAndConfirm(transaction));
    assert.equal((await getAccount(provider.connection, payerAta)).amount, payerBefore);
    assert.equal((await getAccount(provider.connection, vaultAta)).amount, vaultBefore);
  }

  it('moves the exact amount, writes a receipt, and rejects replay', async () => {
    const quote = makeQuote();
    const receipt = receiptFor(quote);
    const verifyInstruction = proofInstruction(quote);
    const settle = await settleInstruction(quote);

    const payerBefore = (await getAccount(provider.connection, payerAta)).amount;
    const vaultBefore = (await getAccount(provider.connection, vaultAta)).amount;
    await provider.sendAndConfirm(new Transaction().add(verifyInstruction, settle));
    const payerAfter = (await getAccount(provider.connection, payerAta)).amount;
    const vaultAfter = (await getAccount(provider.connection, vaultAta)).amount;
    assert.equal(payerBefore - payerAfter, 84_100n);
    assert.equal(vaultAfter - vaultBefore, 84_100n);

    const stored = await program.account.vesselFeeReceiptV1.fetch(receipt);
    assert.deepEqual(Buffer.from(stored.quoteId), Buffer.from(quote.quoteId));
    assert.equal(stored.payer.toBase58(), payer.publicKey.toBase58());
    assert.equal(stored.amount.toString(), '84100');

    await assert.rejects(
      provider.sendAndConfirm(new Transaction().add(verifyInstruction, settle)),
    );
    assert.equal((await getAccount(provider.connection, payerAta)).amount, payerAfter);
    assert.equal((await getAccount(provider.connection, vaultAta)).amount, vaultAfter);
  });

  it('rejects malformed proof placement, key, signature, and digest without a debit', async () => {
    for (const kind of ['program', 'key', 'signature', 'digest']) {
      const quote = makeQuote();
      const settle = await settleInstruction(quote);
      let proof = proofInstruction(quote);
      if (kind === 'program') proof = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 0 });
      if (kind === 'key') proof = proofInstruction(quote, Keypair.generate());
      if (kind === 'signature') proof.data[48] ^= 0xff;
      if (kind === 'digest') proof = proofInstruction(quote, quoteSigner, Buffer.alloc(32, 0x99));
      await assertRejectedWithoutDebit(new Transaction().add(proof, settle));
    }

    const quote = makeQuote();
    await assertRejectedWithoutDebit(
      new Transaction().add(proofInstruction(quote), SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: payer.publicKey,
        lamports: 0,
      }), await settleInstruction(quote)),
    );
  });

  it('rejects every mismatched quote field without a debit', async () => {
    const invalidQuotes = [
      makeQuote({ version: 2 }),
      makeQuote({ chain: 1 }),
      makeQuote({ network: 2 }),
      makeQuote({ payer: Array.from(Keypair.generate().publicKey.toBytes()) }),
      makeQuote({ asset: Array.from(Keypair.generate().publicKey.toBytes()) }),
      makeQuote({ amount: new anchor.BN(0) }),
      makeQuote({ retentionDays: 0 }),
      makeQuote({ retentionDays: 366 }),
      makeQuote({ storageExpirationMicros: new anchor.BN(1) }),
      makeQuote({ quoteExpiresAtSecs: new anchor.BN(1) }),
      makeQuote({ configVersion: new anchor.BN(2) }),
    ];
    for (const quote of invalidQuotes) {
      await assertRejectedWithoutDebit(
        new Transaction().add(proofInstruction(quote), await settleInstruction(quote)),
      );
    }
  });

  it('rejects wrong receipt, mint, token program, and fixed-length fields', async () => {
    const quote = makeQuote();
    await assertRejectedWithoutDebit(new Transaction().add(
      proofInstruction(quote),
      await settleInstruction(quote, { receipt: Keypair.generate().publicKey }),
    ));

    const otherMint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    const wrongMintQuote = makeQuote({ asset: Array.from(otherMint.toBytes()) });
    await assertRejectedWithoutDebit(new Transaction().add(
      proofInstruction(wrongMintQuote),
      await settleInstruction(wrongMintQuote, { mint: otherMint }),
    ));

    const wrongProgramQuote = makeQuote();
    await assertRejectedWithoutDebit(new Transaction().add(
      proofInstruction(wrongProgramQuote),
      await settleInstruction(wrongProgramQuote, { tokenProgram: SystemProgram.programId }),
    ));

    for (const patch of [
      { quoteId: Array.from(Buffer.alloc(31)) },
      { storageAddress: Array.from(Buffer.alloc(31)) },
      { fileHash: Array.from(Buffer.alloc(31)) },
    ]) {
      await assert.rejects(settleInstruction(makeQuote(patch)));
    }
  });
});
