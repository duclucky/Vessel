import { readFileSync } from 'node:fs';
import path from 'node:path';
import bs58 from 'bs58';
import bundledTestnetManifest from './bundled-testnet-manifest.js';

const HEX_32 = /^[0-9a-f]{64}$/;
const APTOS_ADDRESS = /^0x[0-9a-f]{64}$/;
const SOLANA_BETA_TIMELOCK_SECONDS = 0;

const deploymentError = (message) => Object.assign(new Error(message), {
  code: 'invalid_settlement_deployment',
  status: 503,
  retriable: false,
});

function requiredAptosAddress(value, field) {
  const normalized = String(value || '').toLowerCase();
  if (!APTOS_ADDRESS.test(normalized) || /^0x0+$/.test(normalized)) {
    throw deploymentError(`${field} must be a deployed Aptos address`);
  }
  return normalized;
}

function requiredSolanaKey(value, field) {
  const text = String(value || '');
  let bytes;
  try {
    bytes = Buffer.from(bs58.decode(text));
  } catch {
    throw deploymentError(`${field} must be a Solana public key`);
  }
  if (bytes.length !== 32 || bytes.every((byte) => byte === 0)) {
    throw deploymentError(`${field} must be a deployed Solana public key`);
  }
  return text;
}

function requiredSolanaSignature(value, field) {
  const text = String(value || '');
  let bytes;
  try {
    bytes = Buffer.from(bs58.decode(text));
  } catch {
    throw deploymentError(`${field} must be a Solana transaction signature`);
  }
  if (bytes.length !== 64 || bytes.every((byte) => byte === 0)) {
    throw deploymentError(`${field} must be a 64-byte Solana transaction signature`);
  }
  return text;
}

function requiredHex32(value, field) {
  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!HEX_32.test(text) || /^0+$/.test(text)) throw deploymentError(`${field} must be 32 bytes`);
  return text;
}

function requireTimelock(value, field) {
  if (Number(value) !== SOLANA_BETA_TIMELOCK_SECONDS) {
    throw deploymentError(`${field} must be ${SOLANA_BETA_TIMELOCK_SECONDS} seconds`);
  }
  return SOLANA_BETA_TIMELOCK_SECONDS;
}

function requireAptosNoTimelock(value) {
  if (value !== null) {
    throw deploymentError('Aptos Testnet timelock must be null because the native feature is disabled');
  }
  return null;
}

export function loadSettlementDeployments({
  file,
  quotePublicKey,
  enabled = true,
  environment = process.env.NODE_ENV || 'development',
} = {}) {
  if (!enabled) {
    if (environment === 'production') {
      throw deploymentError('Settlement contracts cannot be disabled in production');
    }
    return Object.freeze({ enabled: false });
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    if (path.basename(String(file || '')) !== 'vessel-settlement.testnet.json') {
      throw deploymentError('Settlement deployment manifest is missing or invalid');
    }
    manifest = bundledTestnetManifest;
  }
  if (manifest.schemaVersion !== 1 || manifest.environment !== 'testnet') {
    throw deploymentError('Settlement manifest must target the version 1 testnet schema');
  }

  const configuredQuoteKey = requiredHex32(quotePublicKey, 'Configured quote public key');
  const manifestQuoteKey = requiredHex32(manifest.quotePublicKey, 'Manifest quote public key');
  if (configuredQuoteKey !== manifestQuoteKey) {
    throw deploymentError('Configured quote public key does not match the deployment manifest');
  }

  const configVersion = BigInt(manifest.configVersion || 0);
  if (configVersion <= 0n) throw deploymentError('configVersion must be positive');
  if (manifest.aptos?.chainId !== 2) throw deploymentError('Aptos deployment must use Testnet chain ID 2');
  if (manifest.solana?.cluster !== 'devnet') throw deploymentError('Solana deployment must use Devnet');

  const aptos = Object.freeze({
    chainId: 2,
    moduleAddress: requiredAptosAddress(manifest.aptos.moduleAddress, 'Aptos module address'),
    vaultAddress: requiredAptosAddress(manifest.aptos.vaultAddress, 'Aptos vault address'),
    multisigAddress: requiredAptosAddress(manifest.aptos.multisigAddress, 'Aptos multisig address'),
    acceptedAsset: requiredAptosAddress(manifest.aptos.acceptedAsset, 'Aptos accepted asset'),
    deploymentTransaction: requiredAptosAddress(
      manifest.aptos.deploymentTransaction,
      'Aptos deployment transaction',
    ),
    timelockSeconds: requireAptosNoTimelock(manifest.aptos.timelockSeconds),
  });
  const solana = Object.freeze({
    cluster: 'devnet',
    programId: requiredSolanaKey(manifest.solana.programId, 'Solana program ID'),
    configPda: requiredSolanaKey(manifest.solana.configPda, 'Solana config PDA'),
    vaultAta: requiredSolanaKey(manifest.solana.vaultAta, 'Solana vault ATA'),
    squadsMultisig: requiredSolanaKey(manifest.solana.squadsMultisig, 'Squads multisig'),
    acceptedMint: requiredSolanaKey(manifest.solana.acceptedMint, 'Solana accepted mint'),
    deploymentSignature: requiredSolanaSignature(
      manifest.solana.deploymentSignature,
      'Solana deployment signature',
    ),
    timelockSeconds: requireTimelock(manifest.solana.timelockSeconds, 'Solana timelock'),
  });

  return Object.freeze({
    enabled: true,
    environment: 'testnet',
    quotePublicKey: manifestQuoteKey,
    configVersion: configVersion.toString(),
    aptos,
    solana,
  });
}
