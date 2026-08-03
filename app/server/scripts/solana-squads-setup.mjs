import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

const THRESHOLD = 2;
const TIMELOCK_SECONDS = 86_400;
const VAULT_INDEX = 0;
const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const SQUADS_PROGRAM_TREASURY = 'HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK';

const scriptError = (message) => Object.assign(new Error(message), {
  code: 'invalid_squads_setup',
});

function key(value, field) {
  try {
    return new PublicKey(String(value || ''));
  } catch {
    throw scriptError(`${field} must be a Solana public key`);
  }
}

export function normalizeSquadsMembers(value) {
  const members = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (members.length !== 3) throw scriptError('Exactly three Squads members are required');
  const normalized = members.map((member, index) => key(member, `Member ${index + 1}`).toBase58());
  if (new Set(normalized).size !== 3) throw scriptError('Squads members must be distinct');
  return Object.freeze(normalized);
}

export function buildSquadsCreatePlan({ members, createKey, creator, treasury }) {
  const create = key(createKey, 'Squads create key');
  const creatorKey = key(creator, 'Squads creator');
  const treasuryKey = key(treasury, 'Squads treasury');
  if (treasuryKey.toBase58() !== SQUADS_PROGRAM_TREASURY) {
    throw scriptError('Squads treasury must match the on-chain ProgramConfig program treasury');
  }
  const normalizedMembers = normalizeSquadsMembers(members.join(','));
  const [multisigPda] = multisig.getMultisigPda({ createKey: create });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: VAULT_INDEX });
  return Object.freeze({
    threshold: THRESHOLD,
    timeLock: TIMELOCK_SECONDS,
    configAuthority: null,
    createKey: create.toBase58(),
    creator: creatorKey.toBase58(),
    treasury: treasuryKey.toBase58(),
    multisigAddress: multisigPda.toBase58(),
    vaultAddress: vaultPda.toBase58(),
    vaultIndex: VAULT_INDEX,
    members: Object.freeze(normalizedMembers.map((member) => Object.freeze({
      key: member,
      permissions: Object.freeze(['initiate', 'vote', 'execute']),
    }))),
  });
}

function instructionJson(instruction) {
  return Object.freeze({
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map((account) => Object.freeze({
      pubkey: account.pubkey.toBase58(),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    dataBase64: Buffer.from(instruction.data).toString('base64'),
  });
}

export function buildCreateInstruction(plan) {
  const allPermissions = multisig.types.Permissions.fromPermissions([
    multisig.types.Permission.Initiate,
    multisig.types.Permission.Vote,
    multisig.types.Permission.Execute,
  ]);
  return multisig.instructions.multisigCreateV2({
    treasury: key(plan.treasury, 'Squads treasury'),
    creator: key(plan.creator, 'Squads creator'),
    multisigPda: key(plan.multisigAddress, 'Squads multisig'),
    configAuthority: null,
    threshold: THRESHOLD,
    members: plan.members.map((member) => ({
      key: key(member.key, 'Squads member'),
      permissions: allPermissions,
    })),
    timeLock: TIMELOCK_SECONDS,
    createKey: key(plan.createKey, 'Squads create key'),
    rentCollector: null,
    memo: 'Vessel autonomous 2-of-3 multisig',
  });
}

export async function verifySquads({ connection, plan }) {
  const address = key(plan.multisigAddress, 'Squads multisig');
  const account = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    address,
    'finalized',
  );
  const expectedMembers = new Set(plan.members.map((member) => member.key));
  const autonomous = account.configAuthority.equals(PublicKey.default);
  const membersMatch = account.members.length === 3 && account.members.every((member) => (
    expectedMembers.has(member.key.toBase58())
    && multisig.types.Permissions.has(member.permissions, multisig.types.Permission.Initiate)
    && multisig.types.Permissions.has(member.permissions, multisig.types.Permission.Vote)
    && multisig.types.Permissions.has(member.permissions, multisig.types.Permission.Execute)
  ));
  if (
    !autonomous
    || account.threshold !== THRESHOLD
    || account.timeLock !== TIMELOCK_SECONDS
    || !account.createKey.equals(key(plan.createKey, 'Squads create key'))
    || !membersMatch
  ) {
    throw scriptError('On-chain Squads configuration does not match the approved Vessel policy');
  }
  return Object.freeze({
    verified: true,
    multisigAddress: address.toBase58(),
    vaultAddress: plan.vaultAddress,
    configAuthority: null,
    threshold: account.threshold,
    timeLock: account.timeLock,
    members: account.members.map((member) => member.key.toBase58()),
  });
}

export function buildProgramAuthorityInstruction({ programId, currentAuthority, newAuthority }) {
  const program = key(programId, 'Vessel Program');
  const current = key(currentAuthority, 'Current upgrade authority');
  const [programData] = PublicKey.findProgramAddressSync([program.toBuffer()], UPGRADEABLE_LOADER);
  const keys = [
    { pubkey: programData, isSigner: false, isWritable: true },
    { pubkey: current, isSigner: true, isWritable: false },
  ];
  if (newAuthority) {
    keys.push({ pubkey: key(newAuthority, 'New upgrade authority'), isSigner: false, isWritable: false });
  }
  const data = Buffer.alloc(4);
  data.writeUInt32LE(4);
  return new TransactionInstruction({ programId: UPGRADEABLE_LOADER, keys, data });
}

async function verifyProgramAuthority(connection, programId, expectedAuthority) {
  const program = key(programId, 'Vessel Program');
  const expected = key(expectedAuthority, 'Expected upgrade authority');
  const [programData] = PublicKey.findProgramAddressSync([program.toBuffer()], UPGRADEABLE_LOADER);
  const info = await connection.getAccountInfo(programData, { commitment: 'finalized' });
  const data = Buffer.from(info?.data || []);
  if (
    !info
    || !info.owner.equals(UPGRADEABLE_LOADER)
    || data.length < 45
    || data.readUInt32LE(0) !== 3
    || data[12] !== 1
    || !new PublicKey(data.subarray(13, 45)).equals(expected)
  ) {
    throw scriptError('Vessel Program upgrade authority does not match the Squads vault');
  }
  return Object.freeze({
    verified: true,
    programId: program.toBase58(),
    programData: programData.toBase58(),
    upgradeAuthority: expected.toBase58(),
  });
}

function envPlan() {
  return buildSquadsCreatePlan({
    members: normalizeSquadsMembers(process.env.SOLANA_SQUADS_MEMBERS),
    createKey: process.env.SOLANA_SQUADS_CREATE_KEY,
    creator: process.env.SOLANA_SQUADS_CREATOR,
    treasury: process.env.SOLANA_SQUADS_TREASURY || SQUADS_PROGRAM_TREASURY,
  });
}

async function main() {
  const mode = process.argv[2] || 'derive';
  const plan = envPlan();
  if (mode === 'derive') return plan;
  if (mode === 'create-payload') {
    return Object.freeze({ ...plan, instruction: instructionJson(buildCreateInstruction(plan)) });
  }
  const connection = new Connection(
    process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
    'confirmed',
  );
  if (mode === 'verify') {
    const squads = await verifySquads({ connection, plan });
    const program = process.env.SOLANA_PROGRAM_ID
      ? await verifyProgramAuthority(connection, process.env.SOLANA_PROGRAM_ID, plan.vaultAddress)
      : null;
    return Object.freeze({ squads, program });
  }
  if (mode === 'program-authority-payload') {
    return Object.freeze({
      instruction: instructionJson(buildProgramAuthorityInstruction({
        programId: process.env.SOLANA_PROGRAM_ID,
        currentAuthority: process.env.SOLANA_CURRENT_UPGRADE_AUTHORITY,
        newAuthority: plan.vaultAddress,
      })),
    });
  }
  if (mode === 'lock-payload') {
    return Object.freeze({
      warning: 'Execute only after Config.upgrade_lock_intent is true and all three members approve permanence.',
      instruction: instructionJson(buildProgramAuthorityInstruction({
        programId: process.env.SOLANA_PROGRAM_ID,
        currentAuthority: plan.vaultAddress,
        newAuthority: null,
      })),
    });
  }
  throw scriptError(`Unknown mode: ${mode}`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
