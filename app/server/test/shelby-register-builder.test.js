import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSponsoredRegisterTransaction } from '../src/lib/shelby-register-builder.js';

test('server builds a Shelby sponsored registration from the paid quote binding', async () => {
  const builds = [];
  const transaction = { bcsToBytes: () => new Uint8Array([1, 2, 3]) };
  const signedQuote = {
    context: {
      storageAddress: `0x${'11'.repeat(32)}`,
      blobName: `media/${'22'.repeat(32)}.png`,
      sizeBytes: 1_127_355,
      expirationMicros: 2_592_001_000_000,
      encoding: 0,
    },
    breakdown: { tierId: 3 },
  };
  const result = await buildSponsoredRegisterTransaction({
    shelbyClient: {
      aptos: {
        transaction: {
          build: {
            async multiAgent(input) {
              builds.push(input);
              return transaction;
            },
          },
        },
      },
    },
    gasStationAccount: `0x${'33'.repeat(32)}`,
    signedQuote,
    blobMerkleRoot: `0x${'44'.repeat(32)}`,
  });

  assert.equal(result, transaction);
  assert.equal(builds[0].sender, signedQuote.context.storageAddress);
  assert.deepEqual(builds[0].secondarySignerAddresses, [`0x${'33'.repeat(32)}`]);
  assert.equal(builds[0].withFeePayer, true);
  assert.match(builds[0].data.function, /::blob_metadata::register_blob_with_sponsor$/);
  assert.equal(builds[0].data.functionArguments.length, 10);
  assert.equal(builds[0].data.functionArguments[0], signedQuote.context.blobName);
  assert.equal(builds[0].data.functionArguments[1], null);
  assert.equal(builds[0].data.functionArguments[2], null);
  assert.equal(builds[0].data.functionArguments[3], signedQuote.context.expirationMicros);
  assert.deepEqual(builds[0].data.functionArguments[4], Uint8Array.from({ length: 32 }, () => 0x44));
  assert.equal(builds[0].data.functionArguments[5], 1);
  assert.equal(builds[0].data.functionArguments[6], signedQuote.context.sizeBytes);
  assert.equal(builds[0].data.functionArguments[7], 0);
  assert.equal(builds[0].data.functionArguments[8], 0);
  assert.equal(builds[0].data.functionArguments[9], 0);
});

test('server refuses an invalid commitment root or payment tier before building', async () => {
  const base = {
    shelbyClient: { aptos: { transaction: { build: { multiAgent: () => assert.fail('must not build') } } } },
    gasStationAccount: `0x${'33'.repeat(32)}`,
    signedQuote: {
      context: {
        storageAddress: `0x${'11'.repeat(32)}`,
        blobName: 'media/file.bin',
        sizeBytes: 42,
        expirationMicros: 2_592_001_000_000,
        encoding: 0,
      },
      breakdown: { tierId: -1 },
    },
  };
  await assert.rejects(
    () => buildSponsoredRegisterTransaction({ ...base, blobMerkleRoot: 'bad' }),
    (error) => error.code === 'invalid_blob_commitment',
  );
  await assert.rejects(
    () => buildSponsoredRegisterTransaction({ ...base, blobMerkleRoot: `0x${'44'.repeat(32)}` }),
    (error) => error.code === 'invalid_payment_tier',
  );
});
