import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const publicConfigRoute = server.slice(
  server.indexOf("app.get('/api/config'"),
  server.indexOf('// ---- Sponsored on-chain submit'),
);

test('public config exposes server-gated wallet families without secrets', () => {
  assert.match(config, /walletAptosEnabled/);
  assert.match(config, /walletSolanaEnabled/);
  assert.match(server, /walletFamilies/);
  assert.match(server, /evm:\s*false/);
  assert.match(server, /solana:\s*config\.walletSolanaEnabled\s*&&\s*!!sponsor\s*&&\s*!!payments/);
  assert.doesNotMatch(publicConfigRoute, /gasStationApiKey:\s*config\.gasStationApiKey/);
  assert.doesNotMatch(publicConfigRoute, /paySecret:\s*config\.paySecret/);
});

test('wallet identity changes abort pending payment work and clear stale gates', () => {
  assert.match(app, /function invalidateWalletWork\(next\)/);
  assert.match(app, /pendingWalletWork\.abort\(\)/);
  assert.match(app, /activeUploadContext = null/);
  assert.match(app, /#pay-gate/);
  assert.match(app, /#aptos-funding-gate/);
});

test('dynamic quote configuration is explicit and contains no development signing fallback', () => {
  for (const key of [
    'dynamicQuotesEnabled',
    'paySecret',
    'aptUsdReferenceMicros',
    'registerGasUnitsEstimate',
    'gasSafetyBps',
    'aptosTreasuryAddress',
  ]) {
    assert.match(config, new RegExp(`${key}:`), key);
  }
  assert.match(config, /process\.env\.DYNAMIC_QUOTES_ENABLED === 'true'/);
  assert.match(config, /process\.env\.PAY_SECRET \|\| ''/);
  assert.doesNotMatch(config, /vessel-dev-secret/);
});
