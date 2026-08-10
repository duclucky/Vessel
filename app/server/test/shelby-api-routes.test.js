import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const wallets = fs.readFileSync(new URL('../client-src/vessel-wallets.js', import.meta.url), 'utf8');

test('Shelby API key stays server-side across register, multipart write, list, and read routes', () => {
  for (const route of [
    '/api/shelby/register',
    '/api/shelby/commit',
    '/api/shelby/uploads',
    '/api/shelby/artifacts',
    '/api/shelby/blobs/:account/*',
  ]) {
    assert.equal(server.includes(route), true, route);
  }
  assert.match(server, /Authorization: `Bearer \$\{config\.shelbyRpcApiKey\}`/);
  assert.match(server, /validatePaidUploadBody\(req\.body\)/);
  assert.match(server, /ensureShelbyDaaFunding\(\{[\s\S]*address:\s*signedQuote\.context\.storageAddress/);
  assert.match(server, /build\.simple\(\{\s*sender:\s*signedQuote\.context\.storageAddress[\s\S]*data:\s*req\.body\?\.commitPayload/s);
  assert.doesNotMatch(server, /data:\s*req\.body\?\.commitPayload[\s\S]{0,160}withFeePayer:\s*true/);
  assert.match(server, /build\.simple\(\{[\s\S]*options:\s*directDaaTransactionOptions\(sponsoredMaxGasAmount\(\)\)[\s\S]*transactionKind:\s*'simple'/);
  assert.match(server, /submitMode:\s*'direct'/);
  assert.match(server, /transactionKind:\s*'simple'/);
  assert.doesNotMatch(server, /data:\s*req\.body\?\.commitPayload[\s\S]{0,160}secondarySignerAddresses/);
  assert.match(server, /express\.raw\(\{ type: 'application\/octet-stream', limit: '3mb' \}\)/);
  assert.match(wallets, /\/api\/shelby\/artifacts\?account=/);
  assert.match(server, /contentType: mimeForKey\(row\.blobNameSuffix\)/);
  assert.doesNotMatch(wallets, /coordination\.getAccountBlobs/);
});

test('Shelby API routes use the configured runtime instead of hard-coded Aptos Testnet', () => {
  assert.match(server, /publicNetworkDescriptor\(config\.shelbyRuntime\)/);
  assert.match(server, /network:\s*config\.shelbyRuntime\.aptosNetwork/);
  assert.match(server, /apiKey:\s*config\.shelbyRpcApiKey/);
  assert.doesNotMatch(server, /network:\s*Network\.TESTNET/);
});

test('Shelby API routes normalize Aptos-style @ account parameters', () => {
  assert.match(server, /function normalizeShelbyAccountParam/);
  assert.match(server, /normalizeShelbyAccountParam\(req\.query\.account\)/);
  assert.match(server, /normalizeShelbyAccountParam\(req\.params\.account\)/);
});

test('one-approval routes await strict wallet verification before the first blob write', () => {
  assert.match(server, /createOneApprovalAuthorizationVerifier/);
  const singleRoute = server.slice(
    server.indexOf("app.post('/api/one-approval/uploads'"),
    server.indexOf('// ---- One-approval batch upload ----'),
  );
  const batchRoute = server.slice(
    server.indexOf("app.post('/api/one-approval/batch-uploads'"),
    server.indexOf('// ---- Quotes'),
  );
  for (const route of [singleRoute, batchRoute]) {
    assert.match(route, /await verifyOneApprovalAuthorization/);
    assert.ok(
      route.indexOf('await verifyOneApprovalAuthorization') < route.indexOf('await store.put'),
      'wallet verification must happen before storage mutation',
    );
  }
});

test('Shelby read proxy forwards a bounded byte range and preserves partial response metadata', () => {
  assert.match(server, /\^bytes=\\d\+-\\d\*\$/);
  assert.match(server, /upstreamHeaders\.Range = requestedRange/);
  assert.match(server, /res\.status\(upstream\.status\)/);
  assert.match(server, /'content-range'/);
  assert.match(server, /'accept-ranges'/);
});

test('Shelby read proxy restores the image MIME when upstream returns generic bytes', () => {
  assert.match(server, /upstreamContentType === 'application\/octet-stream'/);
  assert.match(server, /mimeForKey\(blobName\)/);
  assert.match(server, /res\.setHeader\('content-type', responseContentType\)/);
});
