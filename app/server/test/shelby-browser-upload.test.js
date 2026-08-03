import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadBlobViaVesselGateway } from '../client-src/wallets/shelby-browser-upload.js';

test('browser upload sends bounded chunks through Vessel without receiving a Shelby API key', async () => {
  const requests = [];
  const request = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/shelby/uploads') {
      return new Response(JSON.stringify({
        uploadId: 'upload-1', uploadToken: 'vupload.scoped', partSize: 3,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await uploadBlobViaVesselGateway(new Uint8Array([1, 2, 3, 4, 5]), {
    quoteToken: 'vquote.signed',
    paidAuthorization: 'vpaid.signed',
    uploadContext: { storageAddress: `0x${'11'.repeat(32)}`, blobName: 'media/file.bin' },
    contractQuote: { quoteId: 'contract-quote' },
    contractSignature: 'signature',
    request,
  });

  assert.deepEqual(result, { uploadId: 'upload-1', uploadedBytes: 5 });
  assert.equal(requests.length, 4);
  assert.deepEqual([...requests[1].options.body], [1, 2, 3]);
  assert.deepEqual([...requests[2].options.body], [4, 5]);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer vupload.scoped');
  assert.equal(requests[3].url, '/api/shelby/uploads/upload-1/complete');
  assert.doesNotMatch(JSON.stringify(requests), /server-only|SHELBY_API_KEY/);
});

test('browser upload surfaces a failed Shelby part and never completes it', async () => {
  const urls = [];
  const request = async (url) => {
    urls.push(url);
    if (url === '/api/shelby/uploads') {
      return new Response(JSON.stringify({ uploadId: 'upload-1', uploadToken: 'vupload.scoped', partSize: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Shelby rejected the part', code: 'shelby_upload_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  };

  await assert.rejects(
    () => uploadBlobViaVesselGateway(new Uint8Array([1, 2, 3]), {
      quoteToken: 'vquote.signed',
      paidAuthorization: 'vpaid.signed',
      uploadContext: { storageAddress: `0x${'11'.repeat(32)}`, blobName: 'media/file.bin' },
      contractQuote: { quoteId: 'contract-quote' },
      contractSignature: 'signature',
      request,
    }),
    (error) => error.code === 'shelby_upload_failed',
  );
  assert.equal(urls.some((url) => url.endsWith('/complete')), false);
});
