import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNativeBalances,
  readNativeBalances,
  uploadNativeAptos,
} from '../client-src/wallets/aptos-upload.js';

test('balance preflight reads APT and the ShelbyUSD fungible asset', async () => {
  let aptQuery;
  let where;
  const balances = await readNativeBalances('0xabc', {
    shelbyUsdAsset: '0xshelby',
    aptos: {
      getAccountAPTAmount: async (query) => { aptQuery = query; return 123; },
      getCurrentFungibleAssetBalances: async ({ options }) => {
        where = options.where;
        return [{ amount: '456' }];
      },
    },
  });

  assert.deepEqual(balances, { aptOctas: 123, shelbyUsdUnits: 456 });
  assert.deepEqual(aptQuery, { accountAddress: '0xabc' });
  assert.deepEqual(where, {
    owner_address: { _eq: '0xabc' },
    asset_type: { _eq: '0xshelby' },
  });
});

test('native upload registers before RPC byte upload and returns the wallet namespace', async () => {
  const calls = [];
  const steps = [];
  let chunksetInput;
  const file = {
    name: 'Proof Final.PNG',
    type: 'image/png',
    size: 3,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
  };
  const expectedFileHash = 'ab'.repeat(32);

  const result = await uploadNativeAptos(file, {
    session: { chain: 'aptos', mode: 'native', storageAddress: '0xabc', sourceAddress: '0xabc' },
    adapter: {
      signAndSubmitTransaction: async ({ data }) => {
        calls.push(['sign', data]);
        return { hash: '0xtxn' };
      },
    },
    expirationMicros: 2_592_001_000_000,
    expectedFileHash,
    quoteToken: 'vquote.test.signed',
    paidAuthorization: 'vpaid.test.authorization',
    contractQuote: { quoteId: 'contract-quote' },
    contractSignature: 'contract-signature',
    paymentTier: 3,
    uploadContext: {
      chain: 'aptos',
      sourceAddress: '0xabc',
      storageAddress: '0xabc',
      fileHash: expectedFileHash,
      blobName: `media/${expectedFileHash}.png`,
      sizeBytes: 3,
      expirationMicros: 2_592_001_000_000,
    },
    onStep: (step) => steps.push(step),
    deps: {
      aptos: {
        getAccountAPTAmount: async () => 100,
        getCurrentFungibleAssetBalances: async () => [{ amount: '100' }],
        waitForTransaction: async ({ transactionHash }) => {
          calls.push(['wait', transactionHash]);
          return {
            success: true,
            hash: transactionHash,
            gas_used: '718',
            events: [{
              type: '0x42::blob_metadata::BlobRegisteredEvent',
              data: { payment_amount: '4200' },
            }],
          };
        },
      },
      shelby: {
        baseUrl: 'https://api.testnet.shelby.xyz/shelby',
        rpc: { putBlob: async (args) => calls.push(['put', args]) },
      },
      shelbyUsdAsset: '0xshelby',
      createProvider: async () => ({ config: { chunkSizeBytes: 2, erasure_k: 3, enumIndex: 7 } }),
      generateCommitments: async () => ({ blob_merkle_root: '0xroot', raw_data_size: 3 }),
      expectedTotalChunksets: (rawSize, chunksetSize) => {
        chunksetInput = { rawSize, chunksetSize };
        return 1;
      },
      createRegisterPayload: (args) => ({
        function: 'register',
        functionArguments: [
          args.blobName,
          args.expirationMicros,
          args.blobMerkleRoot,
          args.numChunksets,
          args.blobSize,
          0,
          args.encoding,
        ],
      }),
      digest: async () => Uint8Array.from({ length: 32 }, () => 0xab).buffer,
    },
  });

  assert.deepEqual(calls.map(([name]) => name), ['sign', 'wait', 'put']);
  assert.deepEqual(steps, ['encoding', 'signing', 'confirming', 'uploading']);
  assert.equal(calls[0][1].functionArguments[0], `media/${expectedFileHash}.png`);
  assert.equal(calls[0][1].functionArguments[1], 2_592_001_000_000);
  assert.equal(calls[0][1].functionArguments[5], 3);
  assert.equal(calls[0][1].functionArguments[6], 7);
  assert.deepEqual(chunksetInput, { rawSize: 3, chunksetSize: 6 });
  assert.equal(calls[2][1].account, '0xabc');
  assert.equal(calls[2][1].blobName, `media/${expectedFileHash}.png`);
  assert.deepEqual([...calls[2][1].blobData], [1, 2, 3]);
  assert.equal(result.account, '0xabc');
  assert.equal(result.key, `media/${expectedFileHash}.png`);
  assert.equal(result.paymentMode, 'native-aptos');
  assert.equal(result.ownedByYou, true);
  assert.equal(result.expirationMicros, 2_592_001_000_000);
  assert.equal(result.actualStorageUnits, '4200');
  assert.equal(result.actualGasUsed, '718');
});

test('native upload rejects a changed file before encoding or signing', async () => {
  const calls = [];
  await assert.rejects(
    () => uploadNativeAptos(
      {
        name: 'proof.bin',
        size: 1,
        arrayBuffer: async () => Uint8Array.of(1).buffer,
      },
      {
        session: { chain: 'aptos', mode: 'native', storageAddress: '0xabc', sourceAddress: '0xabc' },
        adapter: { signAndSubmitTransaction: async () => calls.push('sign') },
        expirationMicros: 2_592_001_000_000,
        expectedFileHash: 'ff'.repeat(32),
        quoteToken: 'vquote.test.signed',
        paidAuthorization: 'vpaid.test.authorization',
        paymentTier: 0,
        uploadContext: {
          chain: 'aptos',
          sourceAddress: '0xabc',
          storageAddress: '0xabc',
          fileHash: 'ff'.repeat(32),
          blobName: `media/${'ff'.repeat(32)}.bin`,
          sizeBytes: 1,
          expirationMicros: 2_592_001_000_000,
        },
        deps: {
          aptos: {
            getAccountAPTAmount: async () => 1,
            getCurrentFungibleAssetBalances: async () => [{ amount: '1' }],
          },
          shelbyUsdAsset: '0xshelby',
          digest: async () => Uint8Array.from({ length: 32 }, () => 0xab).buffer,
          createProvider: async () => calls.push('encode'),
        },
      },
    ),
    (error) => error.code === 'file_changed',
  );
  assert.deepEqual(calls, []);
});

test('balance preflight reports the missing native funding asset explicitly', () => {
  assert.throws(
    () => assertNativeBalances({ aptOctas: 0, shelbyUsdUnits: 10 }),
    (error) => error.code === 'insufficient_apt',
  );
  assert.throws(
    () => assertNativeBalances({ aptOctas: 10, shelbyUsdUnits: 0 }),
    (error) => error.code === 'insufficient_shelby_usd',
  );
});

test('insufficient balances stop before encoding or wallet signing', async () => {
  const calls = [];
  await assert.rejects(
    () => uploadNativeAptos(
      { name: 'proof.bin', arrayBuffer: async () => new ArrayBuffer(1) },
      {
        session: { storageAddress: '0xabc', sourceAddress: '0xabc' },
        adapter: { signAndSubmitTransaction: async () => calls.push('sign') },
        deps: {
          aptos: {
            getAccountAPTAmount: async () => 0,
            getCurrentFungibleAssetBalances: async () => [{ amount: '10' }],
          },
          shelbyUsdAsset: '0xshelby',
          createProvider: async () => calls.push('encode'),
        },
      },
    ),
    (error) => error.code === 'insufficient_apt',
  );
  assert.deepEqual(calls, []);
});
