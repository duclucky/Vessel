import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, sendAndConfirmTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import {
  SQUADS_PROGRAM_TREASURY,
  buildSquadsCreatePlan,
  buildVesselInitializeInstruction,
  buildVesselInitializePlan,
  normalizeSquadsMembers,
  verifySquads,
  verifyVesselDeployment,
} from './solana-squads-setup.mjs';
import { Connection } from '@solana/web3.js';

const rpc = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(rpc, 'confirmed');

function managedKey(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Buffer.from(value, 'base64'));
}

async function finalized(signature) {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const [{ value }] = await Promise.all([
      connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
    ]);
    const status = value[0];
    if (status?.err) throw new Error(`${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'finalized') return signature;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${signature} did not finalize in time`);
}

const member1 = managedKey('SOLANA_SQUADS_MEMBER_1_SECRET_KEY_B64');
const member2 = managedKey('SOLANA_SQUADS_MEMBER_2_SECRET_KEY_B64');
const member3 = managedKey('SOLANA_SQUADS_MEMBER_3_SECRET_KEY_B64');
const members = [member1, member2, member3];
const configuredMembers = normalizeSquadsMembers(process.env.SOLANA_SQUADS_MEMBERS);
if (members.some((member, index) => member.publicKey.toBase58() !== configuredMembers[index])) {
  throw new Error('Managed Squads member keys do not match SOLANA_SQUADS_MEMBERS');
}

async function create() {
  const createKey = Keypair.generate();
  const plan = buildSquadsCreatePlan({
    members: configuredMembers,
    createKey: createKey.publicKey.toBase58(),
    creator: member1.publicKey.toBase58(),
    treasury: SQUADS_PROGRAM_TREASURY,
  });
  const permissions = multisig.types.Permissions.fromPermissions([
    multisig.types.Permission.Initiate,
    multisig.types.Permission.Vote,
    multisig.types.Permission.Execute,
  ]);
  const creationSignature = await multisig.rpc.multisigCreateV2({
    connection,
    treasury: new PublicKey(plan.treasury),
    createKey,
    creator: member1,
    multisigPda: new PublicKey(plan.multisigAddress),
    configAuthority: null,
    threshold: plan.threshold,
    members: configuredMembers.map((key) => ({ key: new PublicKey(key), permissions })),
    timeLock: plan.timeLock,
    rentCollector: null,
    memo: 'Vessel Devnet beta autonomous 2-of-3 multisig (no native timelock)',
  });
  await finalized(creationSignature);
  const fundingSignature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: member1.publicKey,
      toPubkey: new PublicKey(plan.vaultAddress),
      lamports: 50_000_000,
    })),
    [member1],
    { commitment: 'finalized' },
  );
  const verified = await verifySquads({ connection, plan });
  return { ...verified, createKey: createKey.publicKey.toBase58(), creationSignature, fundingSignature };
}

async function initialize() {
  const multisigPda = new PublicKey(process.env.SOLANA_SQUADS_MULTISIG);
  const vaultPda = new PublicKey(process.env.SOLANA_SQUADS_VAULT);
  const plan = buildVesselInitializePlan({
    programId: process.env.SOLANA_PROGRAM_ID,
    squadsVault: vaultPda.toBase58(),
    mint: process.env.SOLANA_ACCEPTED_MINT,
    quotePublicKey: process.env.QUOTE_SIGNER_PUBLIC_KEY_HEX,
    network: 1,
    configVersion: 1n,
  });
  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda, 'finalized');
  if (account.timeLock !== 0 || account.threshold !== 2) throw new Error('Squads beta policy mismatch');
  const transactionIndex = BigInt(account.transactionIndex.toString()) + 1n;
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const transactionMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: [buildVesselInitializeInstruction(plan)],
  });
  const vaultTransactionSignature = await multisig.rpc.vaultTransactionCreate({
    connection,
    feePayer: member1,
    multisigPda,
    transactionIndex,
    creator: member1.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage,
    memo: 'Initialize Vessel settlement beta',
  });
  await finalized(vaultTransactionSignature);
  const proposalSignature = await multisig.rpc.proposalCreate({
    connection,
    feePayer: member1,
    creator: member1,
    multisigPda,
    transactionIndex,
    isDraft: false,
  });
  await finalized(proposalSignature);
  const approval1 = await multisig.rpc.proposalApprove({
    connection, feePayer: member1, member: member1, multisigPda, transactionIndex,
  });
  await finalized(approval1);
  const approval2 = await multisig.rpc.proposalApprove({
    connection, feePayer: member2, member: member2, multisigPda, transactionIndex,
  });
  await finalized(approval2);
  const executionSignature = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: member1,
    multisigPda,
    transactionIndex,
    member: member1.publicKey,
  });
  await finalized(executionSignature);
  return {
    ...plan,
    transactionIndex: transactionIndex.toString(),
    vaultTransactionSignature,
    proposalSignature,
    approval1,
    approval2,
    executionSignature,
  };
}

async function verify() {
  const plan = buildVesselInitializePlan({
    programId: process.env.SOLANA_PROGRAM_ID,
    squadsVault: process.env.SOLANA_SQUADS_VAULT,
    mint: process.env.SOLANA_ACCEPTED_MINT,
    quotePublicKey: process.env.QUOTE_SIGNER_PUBLIC_KEY_HEX,
    network: 1,
    configVersion: 1n,
  });
  const squadsPlan = buildSquadsCreatePlan({
    members: configuredMembers,
    createKey: process.env.SOLANA_SQUADS_CREATE_KEY,
    creator: member1.publicKey.toBase58(),
    treasury: SQUADS_PROGRAM_TREASURY,
  });
  if (
    squadsPlan.multisigAddress !== process.env.SOLANA_SQUADS_MULTISIG
    || squadsPlan.vaultAddress !== process.env.SOLANA_SQUADS_VAULT
  ) throw new Error('Squads addresses do not match the create key');
  return {
    squads: await verifySquads({ connection, plan: squadsPlan }),
    deployment: await verifyVesselDeployment({ connection, plan }),
  };
}

const mode = process.argv[2];
const result = mode === 'create'
  ? await create()
  : mode === 'initialize'
    ? await initialize()
    : mode === 'verify'
      ? await verify()
      : null;
if (!result) throw new Error('Use create, initialize, or verify');
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
