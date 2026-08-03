import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCreatePayload,
  buildInitializeProposalPayload,
  buildPublishProposalPayload,
  readMultisigStatus,
  validateMultisigInputs,
  verifyAptosDeployment,
} from '../scripts/aptos-multisig-payload.mjs';

const owners = [
  `0x${'11'.repeat(32)}`,
  `0x${'22'.repeat(32)}`,
  `0x${'33'.repeat(32)}`,
];
const multisigAddress = `0x${'44'.repeat(32)}`;

test('Aptos multisig create payload fixes 2-of-3 governance without a Testnet timelock', () => {
  const config = validateMultisigInputs({ owners, threshold: 2, timelockSeconds: null });
  const payload = buildCreatePayload(config);

  assert.equal(payload.function, '0x1::multisig_account::create_with_owners');
  assert.deepEqual(payload.typeArguments, []);
  assert.deepEqual(payload.functionArguments, [
    owners.slice(1),
    2,
    ['vessel_role'],
    [[...Buffer.from('settlement_admin', 'utf8')]],
  ]);
});

test('Aptos multisig validation rejects unsafe governance inputs', () => {
  assert.throws(
    () => validateMultisigInputs({ owners: [owners[0], owners[0], owners[2]], threshold: 2, timelockSeconds: null }),
    /unique/i,
  );
  assert.throws(
    () => validateMultisigInputs({ owners: owners.slice(0, 2), threshold: 2, timelockSeconds: null }),
    /three/i,
  );
  assert.throws(
    () => validateMultisigInputs({ owners, threshold: 1, timelockSeconds: null }),
    /threshold/i,
  );
  assert.throws(
    () => validateMultisigInputs({ owners, threshold: 2, timelockSeconds: 86_400 }),
    /disabled on Aptos Testnet/i,
  );
});

test('Aptos multisig status treats an absent timelock resource as the approved null policy', async () => {
  const status = await readMultisigStatus({
    client: {
      getLedgerInfo: async () => ({ chain_id: 2 }),
      getAccountResource: async ({ resourceType }) => {
        if (resourceType === '0x1::multisig_account::MultisigAccount') {
          return {
            owners,
            num_signatures_required: '2',
            next_sequence_number: '0',
            last_executed_sequence_number: '0',
          };
        }
        const error = new Error('Resource not found');
        error.status = 404;
        throw error;
      },
    },
    multisigAddress,
  });

  assert.equal(status.timelockSeconds, null);
  assert.equal(status.overrideThreshold, null);
  assert.equal(status.threshold, 2);
  assert.deepEqual(status.owners, owners);
});

test('publish proposal wraps bytecode compiled for the created multisig address', () => {
  const targetHex = multisigAddress.slice(2);
  const publicationPayload = {
    function_id: '0x1::code::publish_package_txn',
    type_args: [],
    args: [
      { type: 'hex', value: `0x01${targetHex}02` },
      { type: 'hex', value: [`0x03${targetHex}04`] },
    ],
  };

  const result = buildPublishProposalPayload({ multisigAddress, publicationPayload });
  assert.equal(result.publishTarget, multisigAddress);
  assert.equal(result.function, '0x1::multisig_account::create_transaction');
  assert.equal(result.functionArguments[0], multisigAddress);
  assert.ok(Array.isArray(result.functionArguments[1]));
  assert.ok(result.functionArguments[1].length > 64);

  assert.throws(
    () => buildPublishProposalPayload({
      multisigAddress,
      publicationPayload: {
        ...publicationPayload,
        args: publicationPayload.args.map((arg) => ({
          ...arg,
          value: Array.isArray(arg.value) ? ['0x0304'] : '0x0102',
        })),
      },
    }),
    /compiled for/i,
  );
});

test('initialization is a separate multisig proposal bound to public deployment config', () => {
  const proposal = buildInitializeProposalPayload({
    multisigAddress,
    acceptedAsset: `0x${'55'.repeat(32)}`,
    quotePublicKey: '66'.repeat(32),
    configVersion: '1',
  });
  assert.equal(
    proposal.initializeTarget,
    `${multisigAddress}::vessel_settlement::initialize`,
  );
  assert.equal(proposal.initializeTypeArgument, '0x1::fungible_asset::Metadata');
  assert.equal(proposal.function, '0x1::multisig_account::create_transaction');
  assert.equal(proposal.functionArguments[0], multisigAddress);
  assert.ok(proposal.functionArguments[1].length > 100);
  assert.throws(
    () => buildInitializeProposalPayload({
      multisigAddress,
      acceptedAsset: `0x${'55'.repeat(32)}`,
      quotePublicKey: '00'.repeat(32),
    }),
    /non-zero/i,
  );
});

test('deployment verification fails closed outside Aptos Testnet', async () => {
  await assert.rejects(
    verifyAptosDeployment({
      client: { getLedgerInfo: async () => ({ chain_id: 1 }) },
      deployment: { multisigAddress },
      expected: {},
    }),
    /Testnet chain ID 2/i,
  );
});
