import assert from 'node:assert/strict';
import * as anchor from '@anchor-lang/core';
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

describe('Vessel Solana administration', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = anchor.workspace.vesselSettlement;
  const payer = (provider.wallet as any).payer as Keypair;
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const [pendingChange] = PublicKey.findProgramAddressSync(
    [Buffer.from('pending-change')],
    program.programId,
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority')],
    program.programId,
  );

  let mint: PublicKey;
  let vaultAta: PublicKey;
  let destinationAta: PublicKey;

  before(async () => {
    const state = await program.account.config.fetch(config);
    mint = state.acceptedMint;
    vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority, true);
    destinationAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
  });

  it('rejects a non-authority administrator', async () => {
    const outsider = Keypair.generate();
    await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: outsider.publicKey,
      lamports: 10_000_000,
    })));
    await assert.rejects(program.methods
      .pause()
      .accounts({ authority: outsider.publicKey, config })
      .signers([outsider])
      .rpc());
  });

  it('pauses and unpauses settlement through the configured authority', async () => {
    await program.methods.pause().accounts({ authority: payer.publicKey, config }).rpc();
    assert.equal((await program.account.config.fetch(config)).paused, true);
    await program.methods.unpause().accounts({ authority: payer.publicKey, config }).rpc();
    assert.equal((await program.account.config.fetch(config)).paused, false);
  });

  it('schedules rotation and rejects execution at 86,399 seconds', async () => {
    const nextQuoteKey = Keypair.generate().publicKey.toBytes();
    await program.methods
      .scheduleConfigChange(1, Array.from(nextQuoteKey))
      .accounts({
        authority: payer.publicKey,
        config,
        pendingChange,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const pending = await program.account.pendingChange.fetch(pendingChange);
    assert.equal(pending.kind, 1);
    assert.deepEqual(Buffer.from(pending.value), Buffer.from(nextQuoteKey));
    await assert.rejects(program.methods
      .executeConfigChange()
      .accounts({ authority: payer.publicKey, config, pendingChange })
      .rpc());
  });

  it('withdraws the exact vault amount using PDA authority', async () => {
    const amount = new anchor.BN(10_000);
    const vaultBefore = (await getAccount(provider.connection, vaultAta)).amount;
    const destinationBefore = (await getAccount(provider.connection, destinationAta)).amount;
    await program.methods
      .withdraw(amount)
      .accounts({
        authority: payer.publicKey,
        config,
        vaultAuthority,
        mint,
        vaultAta,
        destinationAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    assert.equal(vaultBefore - (await getAccount(provider.connection, vaultAta)).amount, 10_000n);
    assert.equal(
      (await getAccount(provider.connection, destinationAta)).amount - destinationBefore,
      10_000n,
    );
  });

  it('records upgrade lock intent once and never clears it', async () => {
    await program.methods
      .lockUpgradeIntent()
      .accounts({ authority: payer.publicKey, config })
      .rpc();
    assert.equal((await program.account.config.fetch(config)).upgradeLockIntent, true);
    await assert.rejects(program.methods
      .lockUpgradeIntent()
      .accounts({ authority: payer.publicKey, config })
      .rpc());
    assert.equal((await program.account.config.fetch(config)).upgradeLockIntent, true);
  });
});
