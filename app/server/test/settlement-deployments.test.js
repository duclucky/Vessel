import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadSettlementDeployments } from '../src/lib/settlement/deployments.js';
import bundledTestnetManifest from '../src/lib/settlement/bundled-testnet-manifest.js';

const key = (byte) => bs58.encode(Buffer.alloc(32, byte));
const signature = (byte) => bs58.encode(Buffer.alloc(64, byte));
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
    deploymentSignature: signature(6),
    timelockSeconds: 0,
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

test('enabled settlement registry loads a ShelbyNet Aptos deployment without deleting Testnet', () => {
  const manifest = validManifest();
  manifest.environment = 'shelbynet';
  manifest.aptos.chainId = 118;

  const result = loadSettlementDeployments({
    file: manifestFile(manifest),
    quotePublicKey,
    enabled: true,
    environment: 'test',
  });

  assert.equal(result.enabled, true);
  assert.equal(result.environment, 'shelbynet');
  assert.equal(result.aptos.chainId, 118);
  assert.equal(result.solana.cluster, 'devnet');
});

test('enabled settlement registry rejects undeployed or inconsistent records', () => {
  const invalid = [
    (value) => { value.aptos.moduleAddress = '0x0'; },
    (value) => { value.solana.programId = '11111111111111111111111111111111'; },
    (value) => { value.solana.deploymentSignature = key(6); },
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

test('Vercel runtime manifest stays identical to the repository deployment record', () => {
  const repository = JSON.parse(readFileSync('../../deployments/vessel-settlement.testnet.json', 'utf8'));
  const runtime = JSON.parse(readFileSync('deployments/vessel-settlement.testnet.json', 'utf8'));
  assert.deepEqual(runtime, repository);
  assert.deepEqual(bundledTestnetManifest, repository);
  const shelbynetRepository = JSON.parse(readFileSync('../../deployments/vessel-settlement.shelbynet.json', 'utf8'));
  const shelbynetRuntime = JSON.parse(readFileSync('deployments/vessel-settlement.shelbynet.json', 'utf8'));
  assert.deepEqual(shelbynetRuntime, shelbynetRepository);
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const apiBuild = vercel.builds.find((build) => build.src === 'api/index.js');
  assert.ok(apiBuild.config.includeFiles.includes('deployments/**'));
});

test('Solana manifest PDAs are derived from the configured program and mint', () => {
  for (const file of [
    '../../deployments/vessel-settlement.testnet.json',
    '../../deployments/vessel-settlement.shelbynet.json',
    'deployments/vessel-settlement.testnet.json',
    'deployments/vessel-settlement.shelbynet.json',
  ]) {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    const program = new PublicKey(manifest.solana.programId);
    const mint = new PublicKey(manifest.solana.acceptedMint);
    const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program);
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault-authority')],
      program,
    );
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority, true);

    assert.equal(manifest.solana.configPda, configPda.toBase58(), `${file} configPda`);
    assert.equal(manifest.solana.vaultAta, vaultAta.toBase58(), `${file} vaultAta`);
  }
});

test('bundled manifest keeps serverless startup independent from the process cwd', () => {
  const manifest = JSON.parse(readFileSync('deployments/vessel-settlement.testnet.json', 'utf8'));
  const deployment = loadSettlementDeployments({
    file: 'missing/runtime/vessel-settlement.testnet.json',
    quotePublicKey: manifest.quotePublicKey,
    enabled: true,
    environment: 'production',
  });
  assert.equal(deployment.solana.programId, manifest.solana.programId);
  assert.equal(deployment.aptos.moduleAddress, manifest.aptos.moduleAddress);
});
