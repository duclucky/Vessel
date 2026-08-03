import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AccountAddress,
  Aptos,
  AptosConfig,
  EntryFunction,
  MultiSigTransactionPayload,
  MoveVector,
  Network,
  parseTypeTag,
  Serializer,
  U64,
} from '@aptos-labs/ts-sdk';

export const APTOS_TESTNET_CHAIN_ID = 2;
export const REQUIRED_THRESHOLD = 2;
export const REQUIRED_TIMELOCK_SECONDS = 86_400;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const DEFAULT_PUBLICATION_FILE = path.join(
  REPOSITORY_ROOT,
  'contracts',
  'aptos',
  'vessel_settlement',
  'build',
  'publish-payload.json',
);
const DEFAULT_DEPLOYMENT_FILE = path.join(
  REPOSITORY_ROOT,
  'deployments',
  'vessel-settlement.testnet.json',
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeAddress(value, label = 'address') {
  const hex = String(value || '').trim().toLowerCase().replace(/^0x/, '');
  invariant(/^[0-9a-f]{1,64}$/.test(hex), `${label} must be a valid Aptos address`);
  return `0x${hex.padStart(64, '0')}`;
}

function parseInteger(value, label) {
  const parsed = Number(value);
  invariant(Number.isSafeInteger(parsed), `${label} must be an integer`);
  return parsed;
}

export function validateMultisigInputs({ owners, threshold, timelockSeconds }) {
  invariant(Array.isArray(owners) && owners.length === 3, 'Exactly three Aptos multisig owners are required');
  const normalizedOwners = owners.map((owner, index) => normalizeAddress(owner, `owner ${index + 1}`));
  invariant(new Set(normalizedOwners).size === 3, 'Aptos multisig owners must be unique');

  const normalizedThreshold = parseInteger(threshold, 'threshold');
  invariant(normalizedThreshold === REQUIRED_THRESHOLD, 'Aptos multisig threshold must be 2');
  const normalizedTimelock = parseInteger(timelockSeconds, 'timelock');
  invariant(
    normalizedTimelock === REQUIRED_TIMELOCK_SECONDS,
    'Aptos multisig timelock must be exactly 86,400 seconds',
  );

  return Object.freeze({
    owners: Object.freeze(normalizedOwners),
    threshold: normalizedThreshold,
    timelockSeconds: normalizedTimelock,
  });
}

export function buildCreatePayload(config) {
  const validated = validateMultisigInputs(config);
  return Object.freeze({
    bootstrapper: validated.owners[0],
    function: '0x1::multisig_account::create_with_owners_and_timelock',
    typeArguments: Object.freeze([]),
    functionArguments: Object.freeze([
      Object.freeze(validated.owners.slice(1)),
      validated.threshold,
      Object.freeze(['vessel_role']),
      Object.freeze([Object.freeze([...Buffer.from('settlement_admin', 'utf8')])]),
      validated.timelockSeconds,
      null,
    ]),
  });
}

function publicationArgument(argument) {
  invariant(argument?.type === 'hex', 'Publication arguments must be pre-serialized hex values');
  if (Array.isArray(argument.value)) {
    return new MoveVector(argument.value.map((value) => MoveVector.U8(value)));
  }
  return MoveVector.U8(argument.value);
}

function publicationContainsTarget(publicationPayload, normalizedAddress) {
  const needle = normalizedAddress.slice(2);
  return (publicationPayload?.args || []).some((argument) => {
    const values = Array.isArray(argument?.value) ? argument.value : [argument?.value];
    return values.some((value) => String(value || '').toLowerCase().replace(/^0x/, '').includes(needle));
  });
}

export function buildPublishProposalPayload({ multisigAddress, publicationPayload }) {
  const target = normalizeAddress(multisigAddress, 'multisig address');
  invariant(
    publicationPayload?.function_id === '0x1::code::publish_package_txn',
    'Publication payload must target 0x1::code::publish_package_txn',
  );
  invariant(Array.isArray(publicationPayload.args) && publicationPayload.args.length === 2,
    'Publication payload must contain package metadata and modules');
  invariant(
    publicationContainsTarget(publicationPayload, target),
    'Move package payload was not compiled for the configured multisig address',
  );

  const args = publicationPayload.args.map(publicationArgument);
  const entryFunction = EntryFunction.build('0x1::code', 'publish_package_txn', [], args);
  const multisigPayload = new MultiSigTransactionPayload(entryFunction);
  const serializer = new Serializer();
  multisigPayload.serialize(serializer);

  return Object.freeze({
    publishTarget: target,
    function: '0x1::multisig_account::create_transaction',
    typeArguments: Object.freeze([]),
    functionArguments: Object.freeze([
      target,
      Object.freeze([...serializer.toUint8Array()]),
    ]),
  });
}

export function buildInitializeProposalPayload({
  multisigAddress,
  acceptedAsset,
  quotePublicKey,
  configVersion = '1',
}) {
  const target = normalizeAddress(multisigAddress, 'multisig address');
  const asset = normalizeAddress(acceptedAsset, 'accepted ShelbyUSD asset');
  const publicKey = String(quotePublicKey || '').trim().toLowerCase().replace(/^0x/, '');
  invariant(/^[0-9a-f]{64}$/.test(publicKey) && !/^0+$/.test(publicKey),
    'Quote public key must be a non-zero 32-byte hex value');
  const version = BigInt(configVersion);
  invariant(version > 0n, 'Config version must be positive');

  const entryFunction = EntryFunction.build(
    `${target}::vessel_settlement`,
    'initialize',
    [parseTypeTag('0x1::fungible_asset::Metadata')],
    [AccountAddress.from(asset), MoveVector.U8(publicKey), new U64(version)],
  );
  const multisigPayload = new MultiSigTransactionPayload(entryFunction);
  const serializer = new Serializer();
  multisigPayload.serialize(serializer);
  return Object.freeze({
    initializeTarget: `${target}::vessel_settlement::initialize`,
    initializeTypeArgument: '0x1::fungible_asset::Metadata',
    function: '0x1::multisig_account::create_transaction',
    typeArguments: Object.freeze([]),
    functionArguments: Object.freeze([target, Object.freeze([...serializer.toUint8Array()])]),
  });
}

async function assertTestnet(client) {
  const ledger = await client.getLedgerInfo();
  invariant(Number(ledger.chain_id ?? ledger.chainId) === APTOS_TESTNET_CHAIN_ID,
    'Refusing operation: Aptos ledger must be Testnet chain ID 2');
  return ledger;
}

function resourceData(resource) {
  return resource?.data ?? resource;
}

function enumV1Data(resource) {
  const data = resourceData(resource);
  return data?.V1 ?? data?.v1 ?? data;
}

function bytesHex(value) {
  if (typeof value === 'string') return value.toLowerCase().replace(/^0x/, '');
  return Buffer.from(value || []).toString('hex');
}

export async function readMultisigStatus({ client, multisigAddress }) {
  const address = normalizeAddress(multisigAddress, 'multisig address');
  await assertTestnet(client);
  const [account, timelock] = await Promise.all([
    client.getAccountResource({
      accountAddress: address,
      resourceType: '0x1::multisig_account::MultisigAccount',
    }),
    client.getAccountResource({
      accountAddress: address,
      resourceType: '0x1::multisig_account::MultisigAccountTimeLock',
    }),
  ]);
  const accountData = resourceData(account);
  const timelockData = enumV1Data(timelock);
  return Object.freeze({
    multisigAddress: address,
    owners: Object.freeze((accountData.owners || []).map((owner) => normalizeAddress(owner))),
    threshold: Number(accountData.num_signatures_required),
    timelockSeconds: Number(timelockData.timelock_period),
    overrideThreshold: timelockData.override_threshold?.vec?.[0] ?? null,
    nextSequenceNumber: String(accountData.next_sequence_number),
    lastExecutedSequenceNumber: String(accountData.last_executed_sequence_number),
  });
}

export async function verifyAptosDeployment({ client, deployment, expected }) {
  await assertTestnet(client);
  const multisigAddress = normalizeAddress(deployment.multisigAddress, 'multisig address');
  const moduleAddress = normalizeAddress(deployment.moduleAddress || multisigAddress, 'module address');
  invariant(moduleAddress === multisigAddress, 'Move module must be published at the multisig address');

  const status = await readMultisigStatus({ client, multisigAddress });
  invariant(status.owners.length === 3 && status.threshold === REQUIRED_THRESHOLD,
    'On-chain multisig must be 2-of-3');
  invariant(status.timelockSeconds === REQUIRED_TIMELOCK_SECONDS && status.overrideThreshold === null,
    'On-chain multisig must enforce the 86,400-second timelock without override');

  await client.getAccountModule({ accountAddress: moduleAddress, moduleName: 'vessel_settlement' });
  const versionResult = await client.view({
    payload: { function: `${moduleAddress}::vessel_settlement::version`, typeArguments: [], functionArguments: [] },
  });
  invariant(Number(versionResult?.[0]) === 1, 'Vessel settlement module version must be 1');

  const configResource = await client.getAccountResource({
    accountAddress: moduleAddress,
    resourceType: `${moduleAddress}::vessel_settlement::Config`,
  });
  const config = resourceData(configResource);
  const expectedKey = String(expected.quotePublicKey || '').toLowerCase().replace(/^0x/, '');
  const actualKey = bytesHex(config.quote_public_key);
  invariant(actualKey === expectedKey, 'On-chain quote public key does not match the configured server key');
  invariant(normalizeAddress(config.accepted_asset) === normalizeAddress(expected.acceptedAsset),
    'On-chain ShelbyUSD asset does not match the deployment manifest');
  invariant(String(config.config_version) === String(expected.configVersion),
    'On-chain config version does not match the deployment manifest');
  invariant(normalizeAddress(config.admin) === multisigAddress,
    'On-chain Vessel admin must be the Aptos multisig account');

  return Object.freeze({
    ok: true,
    ...status,
    moduleAddress,
    vaultAddress: normalizeAddress(config.vault_address, 'vault address'),
    acceptedAsset: normalizeAddress(config.accepted_asset),
    quotePublicKey: actualKey,
    configVersion: String(config.config_version),
    version: Number(versionResult[0]),
    paused: config.paused === true || config.paused === 'true',
    upgradeLocked: config.upgrade_locked === true || config.upgrade_locked === 'true',
  });
}

function environmentConfig(env = process.env) {
  const owners = String(env.APTOS_MULTISIG_OWNERS || '').split(',').map((value) => value.trim()).filter(Boolean);
  return validateMultisigInputs({
    owners,
    threshold: env.APTOS_MULTISIG_THRESHOLD ?? REQUIRED_THRESHOLD,
    timelockSeconds: env.APTOS_MULTISIG_TIMELOCK_SECONDS ?? REQUIRED_TIMELOCK_SECONDS,
  });
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function main() {
  const mode = process.argv[2];
  invariant(['create', 'publish-payload', 'initialize-payload', 'status', 'verify'].includes(mode),
    'Usage: aptos-multisig-payload.mjs <create|publish-payload|initialize-payload|status|verify>');

  const client = new Aptos(new AptosConfig({ network: Network.TESTNET }));
  await assertTestnet(client);
  const multisigAddress = process.env.APTOS_MULTISIG_ADDRESS;

  if (mode === 'create') {
    console.log(JSON.stringify(buildCreatePayload(environmentConfig()), null, 2));
    return;
  }
  invariant(multisigAddress, 'APTOS_MULTISIG_ADDRESS is required');
  if (mode === 'publish-payload') {
    const file = path.resolve(process.env.APTOS_PUBLISH_PAYLOAD_FILE || DEFAULT_PUBLICATION_FILE);
    console.log(JSON.stringify(buildPublishProposalPayload({
      multisigAddress,
      publicationPayload: loadJson(file),
    }), null, 2));
    return;
  }
  if (mode === 'initialize-payload') {
    const deployment = loadJson(path.resolve(process.env.SETTLEMENT_DEPLOYMENTS_FILE || DEFAULT_DEPLOYMENT_FILE));
    console.log(JSON.stringify(buildInitializeProposalPayload({
      multisigAddress,
      acceptedAsset: process.env.SHELBYUSD_METADATA_ADDRESS || deployment.aptos.acceptedAsset,
      quotePublicKey: process.env.QUOTE_SIGNER_PUBLIC_KEY_HEX || deployment.quotePublicKey,
      configVersion: deployment.configVersion,
    }), null, 2));
    return;
  }
  if (mode === 'status') {
    console.log(JSON.stringify(await readMultisigStatus({ client, multisigAddress }), null, 2));
    return;
  }

  const deployment = loadJson(path.resolve(process.env.SETTLEMENT_DEPLOYMENTS_FILE || DEFAULT_DEPLOYMENT_FILE));
  console.log(JSON.stringify(await verifyAptosDeployment({
    client,
    deployment: deployment.aptos,
    expected: {
      quotePublicKey: process.env.QUOTE_SIGNER_PUBLIC_KEY_HEX || deployment.quotePublicKey,
      acceptedAsset: process.env.SHELBYUSD_METADATA_ADDRESS || deployment.aptos.acceptedAsset,
      configVersion: deployment.configVersion,
    },
  }), null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}
