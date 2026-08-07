import test from 'node:test';
import assert from 'node:assert/strict';
import { ShelbyUploadGateway } from '../src/lib/shelby-upload-gateway.js';

const SECRET = 'test-upload-secret-that-is-at-least-32-bytes';

test('Shelby upload gateway keeps the private API key upstream and scopes every chunk', async () => {
  const uploads = [];
  const storageSignature = Uint8Array.from({ length: 64 }, (_, index) => index);
  const gateway = new ShelbyUploadGateway({
    apiKey: 'server-only-key',
    rpcBaseUrl: 'https://api.testnet.shelby.xyz/shelby',
    secret: SECRET,
    rpcClient: {
      putBlobChunksets: async (args) => {
        uploads.push(args);
        return { spAcks: [{ slot: 2, signature: storageSignature }] };
      },
    },
    createProvider: async () => ({ config: { erasure_n: 16, erasure_k: 10, chunkSizeBytes: 1 } }),
    generateCommitmentsImpl: async (_provider, bytes) => ({
      raw_data_size: bytes.byteLength,
      blob_merkle_root: `0x${'44'.repeat(32)}`,
      chunkset_commitments: [{ chunkset_root: `0x${'55'.repeat(32)}`, chunk_commitments: Array.from({ length: 16 }, () => `0x${'66'.repeat(32)}`) }],
    }),
    now: () => 1_000,
    maxPartBytes: 4_000_000,
  });

  const started = await gateway.start({
    account: `0x${'11'.repeat(32)}`,
    blobName: `media/${'22'.repeat(32)}.png`,
    totalBytes: 3,
    partSize: 3,
    registrationUid: '79234787875693568',
    blobMerkleRoot: `0x${'44'.repeat(32)}`,
  });
  assert.match(started.uploadId, /^[0-9a-f-]{36}$/);
  assert.equal(started.partSize, 3);
  assert.match(started.uploadToken, /^vupload\./);

  const uploaded = await gateway.putPart({
    uploadId: started.uploadId,
    partIdx: 0,
    data: new Uint8Array([1, 2, 3]),
    uploadToken: started.uploadToken,
  });
  const completed = await gateway.complete({
    uploadId: started.uploadId,
    uploadToken: started.uploadToken,
    spAcks: uploaded.spAcks,
  });

  assert.equal(uploads[0].accountAddress, `0x${'11'.repeat(32)}`);
  assert.equal(uploads[0].uid, '79234787875693568');
  assert.deepEqual([...uploads[0].blobData], [1, 2, 3]);
  assert.deepEqual(uploaded.spAcks, [{ slot: 2, signature: Array.from(storageSignature) }]);
  assert.match(completed.commitPayload.function, /::blob_metadata::commit_object$/);
  assert.equal(typeof completed.commitPayload.functionArguments[4], 'number');
  assert.deepEqual(completed.commitPayload.functionArguments[5][0], Array.from(storageSignature));
});

test('Shelby upload gateway rejects token replay and oversized chunks before upstream I/O', async () => {
  let calls = 0;
  const gateway = new ShelbyUploadGateway({
    apiKey: 'server-only-key',
    rpcBaseUrl: 'https://api.testnet.shelby.xyz/shelby',
    secret: SECRET,
    rpcClient: { putBlobChunksets: async () => {
      calls += 1;
      return { spAcks: [] };
    } },
    now: () => 1_000,
    maxPartBytes: 8,
  });
  const started = await gateway.start({
    account: `0x${'11'.repeat(32)}`,
    blobName: 'media/file.bin',
    totalBytes: 8,
    partSize: 8,
    registrationUid: '79234787875693568',
  });
  assert.equal(calls, 0);

  await assert.rejects(
    () => gateway.putPart({
      uploadId: 'other-upload', partIdx: 0, data: new Uint8Array([1]), uploadToken: started.uploadToken,
    }),
    (error) => error.code === 'invalid_upload_token',
  );
  await assert.rejects(
    () => gateway.putPart({
      uploadId: started.uploadId, partIdx: 0, data: new Uint8Array(9), uploadToken: started.uploadToken,
    }),
    (error) => error.code === 'upload_part_too_large',
  );
  assert.equal(calls, 0);
});
