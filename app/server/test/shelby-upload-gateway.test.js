import test from 'node:test';
import assert from 'node:assert/strict';
import { ShelbyUploadGateway } from '../src/lib/shelby-upload-gateway.js';

const SECRET = 'test-upload-secret-that-is-at-least-32-bytes';

test('Shelby upload gateway keeps the private API key upstream and scopes every chunk', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === 'POST' && url.endsWith('/v1/multipart-uploads')) {
      return new Response(JSON.stringify({ uploadId: 'upload-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 200 });
  };
  const gateway = new ShelbyUploadGateway({
    apiKey: 'server-only-key',
    rpcBaseUrl: 'https://api.testnet.shelby.xyz/shelby',
    secret: SECRET,
    fetchImpl,
    now: () => 1_000,
    maxPartBytes: 3 * 1024 * 1024,
  });

  const started = await gateway.start({
    account: `0x${'11'.repeat(32)}`,
    blobName: `media/${'22'.repeat(32)}.png`,
    totalBytes: 4_000_000,
    partSize: 3_000_000,
  });
  assert.equal(started.uploadId, 'upload-1');
  assert.equal(started.partSize, 3_000_000);
  assert.match(started.uploadToken, /^vupload\./);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer server-only-key');
  assert.equal(JSON.parse(requests[0].options.body).rawAccount, `0x${'11'.repeat(32)}`);

  await gateway.putPart({
    uploadId: 'upload-1',
    partIdx: 0,
    data: new Uint8Array([1, 2, 3]),
    uploadToken: started.uploadToken,
  });
  await gateway.complete({ uploadId: 'upload-1', uploadToken: started.uploadToken });

  assert.equal(requests[1].options.headers.Authorization, 'Bearer server-only-key');
  assert.deepEqual([...requests[1].options.body], [1, 2, 3]);
  assert.match(requests[1].url, /\/v1\/multipart-uploads\/upload-1\/parts\/0$/);
  assert.match(requests[2].url, /\/v1\/multipart-uploads\/upload-1\/complete$/);
});

test('Shelby upload gateway rejects token replay and oversized chunks before upstream I/O', async () => {
  let calls = 0;
  const gateway = new ShelbyUploadGateway({
    apiKey: 'server-only-key',
    rpcBaseUrl: 'https://api.testnet.shelby.xyz/shelby',
    secret: SECRET,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ uploadId: 'upload-1' }), { status: 200 });
    },
    now: () => 1_000,
    maxPartBytes: 8,
  });
  const started = await gateway.start({
    account: `0x${'11'.repeat(32)}`,
    blobName: 'media/file.bin',
    totalBytes: 8,
    partSize: 8,
  });
  assert.equal(calls, 1);

  await assert.rejects(
    () => gateway.putPart({
      uploadId: 'other-upload', partIdx: 0, data: new Uint8Array([1]), uploadToken: started.uploadToken,
    }),
    (error) => error.code === 'invalid_upload_token',
  );
  await assert.rejects(
    () => gateway.putPart({
      uploadId: 'upload-1', partIdx: 0, data: new Uint8Array(9), uploadToken: started.uploadToken,
    }),
    (error) => error.code === 'upload_part_too_large',
  );
  assert.equal(calls, 1);
});
