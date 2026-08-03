import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const wallets = fs.readFileSync(new URL('../client-src/vessel-wallets.js', import.meta.url), 'utf8');

test('Shelby API key stays server-side across register, multipart write, list, and read routes', () => {
  for (const route of [
    '/api/shelby/register',
    '/api/shelby/uploads',
    '/api/shelby/artifacts',
    '/api/shelby/blobs/:account/*',
  ]) {
    assert.equal(server.includes(route), true, route);
  }
  assert.match(server, /Authorization: `Bearer \$\{config\.shelbyApiKey\}`/);
  assert.match(server, /validatePaidUploadBody\(req\.body\)/);
  assert.match(server, /express\.raw\(\{ type: 'application\/octet-stream', limit: '3mb' \}\)/);
  assert.match(wallets, /\/api\/shelby\/artifacts\?account=/);
  assert.match(server, /contentType: mimeForKey\(row\.blobNameSuffix\)/);
  assert.doesNotMatch(wallets, /coordination\.getAccountBlobs/);
});

test('Shelby read proxy forwards a bounded byte range and preserves partial response metadata', () => {
  assert.match(server, /\^bytes=\\d\+-\\d\*\$/);
  assert.match(server, /upstreamHeaders\.Range = requestedRange/);
  assert.match(server, /res\.status\(upstream\.status\)/);
  assert.match(server, /'content-range'/);
  assert.match(server, /'accept-ranges'/);
});
