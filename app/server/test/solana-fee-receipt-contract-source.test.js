import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';

const solanaRoot = new URL('../../../contracts/solana/vessel-settlement/', import.meta.url);
const source = (relativePath) => readFileSync(new URL(relativePath, solanaRoot), 'utf8');
const accountDiscriminator = (name) => (
  createHash('sha256').update(`account:${name}`).digest().subarray(0, 8)
);

test('Solana program source models Vessel fees as fee receipts, not generic settlement receipts', () => {
  const state = source('programs/vessel-settlement/src/state.rs');
  const settle = source('programs/vessel-settlement/src/instructions/settle.rs');
  const anchorTest = source('tests/settlement.ts');

  assert.match(state, /pub struct VesselFeeReceiptV1\b/);
  assert.match(state, /pub struct VesselFeeReceiptCreatedV1\b/);
  assert.match(settle, /VesselFeeReceiptV1::INIT_SPACE/);
  assert.match(settle, /emit!\(VesselFeeReceiptCreatedV1/);
  assert.match(anchorTest, /program\.account\.vesselFeeReceiptV1\.fetch/);
  assert.doesNotMatch(state, /SettlementReceiptV1/);
  assert.doesNotMatch(settle, /SettlementReceiptV1/);
});

test('Solana receipt verifier expects the Anchor discriminator for VesselFeeReceiptV1', () => {
  const adapter = readFileSync(
    new URL('../src/lib/settlement/solana-adapter.js', import.meta.url),
    'utf8',
  );
  const expected = `const RECEIPT_DISCRIMINATOR = Buffer.from([${Array.from(accountDiscriminator('VesselFeeReceiptV1')).join(', ')}]);`;

  assert.ok(adapter.includes(expected), `expected adapter to contain: ${expected}`);
});

test('Solana source program id matches the deploy keypair used for SBF artifacts', () => {
  const deployKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    source('target/deploy/vessel_settlement-keypair.json'),
  ))).publicKey.toBase58();
  const lib = source('programs/vessel-settlement/src/lib.rs');
  const anchor = source('Anchor.toml');

  assert.match(lib, new RegExp(`declare_id!\\("${deployKeypair}"\\);`));
  assert.match(anchor, new RegExp(`vessel_settlement = "${deployKeypair}"`));
});
