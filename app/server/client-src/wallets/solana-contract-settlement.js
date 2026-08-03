import * as anchorNamespace from '@anchor-lang/core';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const DOMAIN = new TextEncoder().encode('VESSEL_SETTLEMENT_V1');
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const DEFAULT_PROGRAM = '11111111111111111111111111111111';
const { BN, Program } = anchorNamespace.default || anchorNamespace;

const SETTLE_IDL = Object.freeze({
  address: DEFAULT_PROGRAM,
  metadata: {
    name: 'vessel_settlement',
    version: '0.1.0',
    spec: '0.1.0',
  },
  instructions: [{
    name: 'settle',
    discriminator: [175, 42, 185, 87, 144, 131, 102, 212],
    accounts: [
      { name: 'payer', writable: true, signer: true },
      { name: 'config' },
      { name: 'receipt', writable: true },
      { name: 'mint' },
      { name: 'payer_ata', writable: true },
      { name: 'vault_ata', writable: true },
      { name: 'vault_authority' },
      { name: 'instructions' },
      { name: 'token_program' },
      { name: 'associated_token_program' },
      { name: 'system_program' },
    ],
    args: [{ name: 'quote', type: { defined: { name: 'QuoteV1' } } }],
  }],
  types: [{
    name: 'QuoteV1',
    type: {
      kind: 'struct',
      fields: [
        { name: 'version', type: 'u8' },
        { name: 'chain', type: 'u8' },
        { name: 'network', type: 'u32' },
        { name: 'quote_id', type: { array: ['u8', 32] } },
        { name: 'payer', type: { array: ['u8', 32] } },
        { name: 'storage_address', type: { array: ['u8', 32] } },
        { name: 'asset', type: { array: ['u8', 32] } },
        { name: 'amount', type: 'u64' },
        { name: 'file_hash', type: { array: ['u8', 32] } },
        { name: 'retention_days', type: 'u16' },
        { name: 'storage_expiration_micros', type: 'u64' },
        { name: 'quote_expires_at_secs', type: 'u64' },
        { name: 'config_version', type: 'u64' },
      ],
    },
  }],
});

const settlementError = (message, code = 'invalid_contract_settlement') => Object.assign(
  new Error(message),
  { code, retriable: false },
);

function hexBytes(value, pattern = HEX_32) {
  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!pattern.test(text)) throw settlementError('Invalid signed Solana settlement bytes');
  return Uint8Array.from(text.match(/../g).map((byte) => Number.parseInt(byte, 16)));
}

function publicKey(value, field) {
  try {
    return new PublicKey(String(value || ''));
  } catch {
    throw settlementError(`${field} is not a valid Solana public key`, 'settlement_unavailable');
  }
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, Number(value), true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Number(value), true);
  return bytes;
}

function u64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

function vector32(value) {
  return Uint8Array.from([32, ...value]);
}

function concatBytes(parts) {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function quoteDigest(quote) {
  const bytes = concatBytes([
    Uint8Array.from([quote.version, quote.chain]),
    u32(quote.network),
    vector32(hexBytes(quote.quoteId)),
    vector32(hexBytes(quote.payer)),
    vector32(hexBytes(quote.storageAddress)),
    vector32(hexBytes(quote.asset)),
    u64(quote.amount),
    vector32(hexBytes(quote.fileHash)),
    u16(quote.retentionDays),
    u64(quote.storageExpirationMicros),
    u64(quote.quoteExpiresAtSecs),
    u64(quote.configVersion),
  ]);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', concatBytes([DOMAIN, bytes])));
}

function toAnchorQuote(quote) {
  return {
    version: Number(quote.version),
    chain: Number(quote.chain),
    network: Number(quote.network),
    quoteId: Array.from(hexBytes(quote.quoteId)),
    payer: Array.from(hexBytes(quote.payer)),
    storageAddress: Array.from(hexBytes(quote.storageAddress)),
    asset: Array.from(hexBytes(quote.asset)),
    amount: new BN(String(quote.amount)),
    fileHash: Array.from(hexBytes(quote.fileHash)),
    retentionDays: Number(quote.retentionDays),
    storageExpirationMicros: new BN(String(quote.storageExpirationMicros)),
    quoteExpiresAtSecs: new BN(String(quote.quoteExpiresAtSecs)),
    configVersion: new BN(String(quote.configVersion)),
  };
}

export async function submitSolanaContractSettlement({
  provider,
  connection,
  deployment,
  contractQuote: quote,
  contractSignature,
}) {
  const owner = provider?.publicKey ? new PublicKey(provider.publicKey) : null;
  const canSign = typeof provider?.signTransaction === 'function';
  const canSignAndSend = typeof provider?.signAndSendTransaction === 'function';
  if (!owner || (!canSign && !canSignAndSend)) {
    throw settlementError('Reconnect the selected Solana wallet', 'settlement_unavailable');
  }
  if (Number(quote?.version) !== 1 || Number(quote?.chain) !== 2 || Number(quote?.network) !== 1) {
    throw settlementError('The quote does not target Solana Devnet', 'settlement_context_mismatch');
  }
  if (!Buffer.from(owner.toBytes()).equals(Buffer.from(hexBytes(quote.payer)))) {
    throw settlementError(
      'The connected Solana account no longer matches this quote',
      'settlement_context_mismatch',
    );
  }

  const programId = publicKey(deployment?.programId, 'Vessel Program');
  if (programId.toBase58() === DEFAULT_PROGRAM) {
    throw settlementError('Vessel Solana settlement program is not deployed', 'settlement_unavailable');
  }
  const mint = publicKey(deployment?.acceptedMint, 'Accepted mint');
  if (!Buffer.from(mint.toBytes()).equals(Buffer.from(hexBytes(quote.asset)))) {
    throw settlementError('The quote asset does not match the deployment', 'settlement_context_mismatch');
  }
  const quotePublicKey = hexBytes(deployment?.quotePublicKey);
  if (quotePublicKey.every((byte) => byte === 0)) {
    throw settlementError('Vessel quote signer is not configured', 'settlement_unavailable');
  }
  const signature = hexBytes(contractSignature, HEX_64);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority')],
    programId,
  );
  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('receipt'), Buffer.from(hexBytes(quote.quoteId))],
    programId,
  );
  const payerAta = getAssociatedTokenAddressSync(mint, owner);
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority, true);
  if (
    deployment?.configPda && publicKey(deployment.configPda, 'Config PDA').toBase58() !== configPda.toBase58()
  ) {
    throw settlementError('Configured Solana settlement PDA is invalid', 'settlement_unavailable');
  }
  if (
    deployment?.vaultAta && publicKey(deployment.vaultAta, 'Vault ATA').toBase58() !== vaultAta.toBase58()
  ) {
    throw settlementError('Configured Solana vault ATA is invalid', 'settlement_unavailable');
  }

  const verifyInstruction = Ed25519Program.createInstructionWithPublicKey({
    publicKey: quotePublicKey,
    message: await quoteDigest(quote),
    signature,
  });
  const idl = { ...SETTLE_IDL, address: programId.toBase58() };
  const program = new Program(idl, { connection });
  const settleInstruction = await program.methods
    .settle(toAnchorQuote(quote))
    .accountsStrict({
      payer: owner,
      config: configPda,
      receipt: receiptPda,
      mint,
      payerAta,
      vaultAta,
      vaultAuthority,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const transaction = new Transaction().add(verifyInstruction, settleInstruction);
  transaction.feePayer = owner;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  let rawSignature;
  if (canSign) {
    const expectedMessage = transaction.serializeMessage();
    const signedResult = await provider.signTransaction(transaction);
    const signedBytes = signedResult?.signedTransaction || signedResult;
    if (!(signedBytes instanceof Uint8Array)) {
      throw settlementError(
        'Solana wallet did not return signed transaction bytes',
        'settlement_submission_failed',
      );
    }
    const signedTransaction = Transaction.from(signedBytes);
    if (!Buffer.from(signedTransaction.serializeMessage()).equals(Buffer.from(expectedMessage))) {
      throw settlementError(
        'Solana wallet changed the settlement transaction',
        'settlement_context_mismatch',
      );
    }
    const payerSignature = signedTransaction.signatures
      .find(({ publicKey: signer }) => signer.equals(owner))?.signature;
    if (!payerSignature || !signedTransaction.verifySignatures(true)) {
      throw settlementError(
        'Solana wallet returned an invalid payer signature',
        'settlement_submission_failed',
      );
    }
    rawSignature = await connection.sendRawTransaction(signedBytes, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
  } else {
    const submitted = await provider.signAndSendTransaction(transaction);
    rawSignature = submitted?.signature || submitted;
  }
  const transactionId = typeof rawSignature === 'string'
    ? rawSignature
    : rawSignature instanceof Uint8Array ? bs58.encode(rawSignature) : '';
  if (!transactionId) {
    throw settlementError('Solana wallet did not return a transaction signature', 'settlement_submission_failed');
  }
  return Object.freeze({ transactionId });
}
