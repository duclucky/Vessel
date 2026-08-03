import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import {
  buildCreateInstruction,
  buildProgramAuthorityInstruction,
  buildSquadsCreatePlan,
  normalizeSquadsMembers,
} from '../scripts/solana-squads-setup.mjs';

const keys = Array.from({ length: 6 }, () => Keypair.generate().publicKey.toBase58());
const squadsProgramTreasury = 'HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK';

test('Squads creation is autonomous 2-of-3 with a 24-hour timelock', () => {
  const members = normalizeSquadsMembers(keys.slice(0, 3).join(','));
  const plan = buildSquadsCreatePlan({
    members,
    createKey: keys[3],
    creator: keys[4],
    treasury: squadsProgramTreasury,
  });

  assert.equal(plan.threshold, 2);
  assert.equal(plan.timeLock, 86_400);
  assert.equal(plan.configAuthority, null);
  assert.equal(plan.members.length, 3);
  assert.deepEqual(plan.members.map((member) => member.key), members);
  for (const member of plan.members) {
    assert.deepEqual(member.permissions, ['initiate', 'vote', 'execute']);
  }
  assert.ok(plan.multisigAddress);
  assert.ok(plan.vaultAddress);
  const instruction = buildCreateInstruction(plan);
  assert.equal(instruction.programId.toBase58(), 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
  assert.ok(instruction.keys.some(({ pubkey }) => pubkey.toBase58() === plan.multisigAddress));
});

test('Squads creation rejects a treasury that differs from ProgramConfig', () => {
  assert.throws(
    () => buildSquadsCreatePlan({
      members: keys.slice(0, 3),
      createKey: keys[3],
      creator: keys[4],
      treasury: keys[5],
    }),
    /program treasury/i,
  );
});

test('Squads setup rejects duplicate or malformed members', () => {
  assert.throws(() => normalizeSquadsMembers(`${keys[0]},${keys[0]},${keys[1]}`));
  assert.throws(() => normalizeSquadsMembers(`${keys[0]},not-a-key,${keys[1]}`));
  assert.throws(() => normalizeSquadsMembers(keys.slice(0, 2).join(',')));
});

test('upgrade authority payload requires only the current authority signature', () => {
  const transfer = buildProgramAuthorityInstruction({
    programId: keys[0],
    currentAuthority: keys[1],
    newAuthority: keys[2],
  });
  assert.equal(transfer.keys.length, 3);
  assert.equal(transfer.keys[1].pubkey.toBase58(), keys[1]);
  assert.equal(transfer.keys[1].isSigner, true);
  assert.equal(transfer.keys[2].pubkey.toBase58(), keys[2]);
  assert.equal(transfer.keys[2].isSigner, false);

  const permanentLock = buildProgramAuthorityInstruction({
    programId: keys[0],
    currentAuthority: keys[2],
    newAuthority: null,
  });
  assert.equal(permanentLock.keys.length, 2);
});
