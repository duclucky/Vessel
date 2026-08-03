import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import { loadSettlementDeployments } from '../src/lib/settlement/deployments.js';

const key = (byte) => bs58.encode(Buffer.alloc(32, byte));
const quotePublicKey = '77'.repeat(32);
const validManifest = () => ({
  schemaVersion: 1,
  environment: 'testnet',
  quotePublicKey,
  configVersion: '1',
  aptos: {
    chainId: 2,
    moduleAddress: `0x${'11'.repeat(32)}`,
    vaultAddress: `0x${'22'.repeat(32)}`,
    multisigAddress: `0x${'33'.repeat(32)}`,
    acceptedAsset: `0x${'44'.repeat(32)}`,
    deploymentTransaction: `0x${'55'.repeat(32)}`,
    timelockSeconds: null,
  },
  solana: {
    cluster: 'devnet',
    programId: key(1),
    configPda: key(2),
    vaultAta: key(3),
    squadsMultisig: key(4),
    acceptedMint: key(5),
    deploymentSignature: key(6),
    timelockSeconds: 86400,
  },
});

function manifestFile(value) {
  const directory = mkdtempSync(join(tmpdir(), 'vessel-deployment-'));
  const file = join(directory, 'manifest.json');
  writeFileSync(file, JSON.stringify(value));
  return file;
}

test('enabled settlement registry loads and freezes complete chain deployments', () => {
  const result = loadSettlementDeployments({
    file: manifestFile(validManifest()),
    quotePublicKey,
    enabled: true,
    environment: 'test',
  });

  assert.equal(result.enabled, true);
  assert.equal(result.configVersion, '1');
  assert.equal(result.aptos.chainId, 2);
  assert.equal(result.aptos.timelockSeconds, null);
  assert.equal(result.solana.cluster, 'devnet');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.aptos), true);
});

test('enabled settlement registry rejects undeployed or inconsistent records', () => {
  const invalid = [
    (value) => { value.aptos.moduleAddress = '0x0'; },
    (value) => { value.solana.programId = '11111111111111111111111111111111'; },
    (value) => { value.quotePublicKey = '88'.repeat(32); },
    (value) => { value.aptos.timelockSeconds = 86400; },
    (value) => { value.solana.timelockSeconds = 60; },
    (value) => { value.aptos.chainId = 1; },
    (value) => { value.solana.cluster = 'mainnet-beta'; },
    (value) => { delete value.aptos.vaultAddress; },
    (value) => { delete value.solana.squadsMultisig; },
  ];

  for (const mutate of invalid) {
    const value = validManifest();
    mutate(value);
    assert.throws(() => loadSettlementDeployments({
      file: manifestFile(value),
      quotePublicKey,
      enabled: true,
      environment: 'test',
    }));
  }
});

test('disabled contracts allow undeployed manifests only outside production', () => {
  assert.deepEqual(loadSettlementDeployments({
    file: 'not-created.json',
    quotePublicKey: '',
    enabled: false,
    environment: 'development',
  }), { enabled: false });

  assert.throws(() => loadSettlementDeployments({
    file: 'not-created.json',
    quotePublicKey: '',
    enabled: false,
    environment: 'production',
  }), /production/i);
});
