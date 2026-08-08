import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultSettlementDeploymentsFile,
  parseShelbyWritesEnabled,
  resolveProjectFile,
} from '../src/config.js';

const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const publicConfigRoute = server.slice(
  server.indexOf("app.get('/api/config'"),
  server.indexOf('// ---- Sponsored on-chain submit'),
);

test('deployment manifest paths resolve from the app root, not the serverless cwd', () => {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(
    resolveProjectFile('deployments/vessel-settlement.testnet.json'),
    path.join(appRoot, 'deployments', 'vessel-settlement.testnet.json'),
  );
  assert.equal(defaultSettlementDeploymentsFile, path.join(
    appRoot,
    'deployments',
    'vessel-settlement.testnet.json',
  ));
  assert.equal(fs.existsSync(defaultSettlementDeploymentsFile), true);
});

test('default settlement manifest path follows the configured Shelby runtime', () => {
  assert.match(config, /defaultSettlementDeploymentsFileForNetwork/);
  assert.match(config, /vessel-settlement\.\$\{runtime\.name\}\.json/);
  assert.match(config, /defaultSettlementDeploymentsFileForNetwork\(shelbyRuntime\)/);
});

test('public config exposes server-gated wallet families without secrets', () => {
  assert.match(config, /walletAptosEnabled/);
  assert.match(config, /walletSolanaEnabled/);
  assert.match(server, /walletFamilies/);
  assert.match(publicConfigRoute, /shelbyWritesEnabled:\s*config\.shelbyWritesEnabled/);
  assert.match(config, /walletEvmEnabled/);
  assert.match(server, /evm:\s*config\.walletEvmEnabled\s*&&\s*!!sponsor\s*&&\s*!!paidAuthorizations\s*&&\s*!!settlementDeployments\.evm/);
  assert.match(server, /solana:\s*config\.walletSolanaEnabled\s*&&\s*!!sponsor\s*&&\s*!!paidAuthorizations\s*&&\s*settlementDeployments\.enabled/);
  assert.doesNotMatch(publicConfigRoute, /gasStationApiKey:\s*config\.gasStationApiKey/);
  assert.doesNotMatch(publicConfigRoute, /paySecret:\s*config\.paySecret/);
});

test('Shelby write availability uses strict production configuration', () => {
  assert.equal(parseShelbyWritesEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(parseShelbyWritesEnabled({
    NODE_ENV: 'production',
    SHELBY_WRITES_ENABLED: 'false',
  }), false);
  assert.equal(parseShelbyWritesEnabled({
    NODE_ENV: 'production',
    SHELBY_WRITES_ENABLED: 'true',
  }), true);
  assert.throws(
    () => parseShelbyWritesEnabled({ NODE_ENV: 'production' }),
    (error) => error.code === 'shelby_writes_config_required',
  );
  assert.throws(
    () => parseShelbyWritesEnabled({ SHELBY_WRITES_ENABLED: 'TRUE' }),
    (error) => error.code === 'shelby_writes_config_invalid',
  );
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
    'settlementContractsEnabled',
    'settlementDeploymentsFile',
    'quoteSignerPrivateKeyBase64',
    'quoteSignerPublicKeyHex',
    'paySecret',
    'aptUsdReferenceMicros',
    'registerGasUnitsEstimate',
    'gasSafetyBps',
    'defaultStorageDays',
  ]) {
    assert.match(config, new RegExp(`${key}:`), key);
  }
  assert.match(config, /process\.env\.DYNAMIC_QUOTES_ENABLED === 'true'/);
  assert.match(config, /process\.env\.SETTLEMENT_CONTRACTS_ENABLED === 'true'/);
  assert.match(config, /process\.env\.QUOTE_SIGNER_PRIVATE_KEY_B64 \|\| ''/);
  assert.match(config, /process\.env\.QUOTE_SIGNER_PUBLIC_KEY_HEX \|\| ''/);
  assert.match(config, /process\.env\.PAY_SECRET \|\| ''/);
  for (const legacyKey of [
    ['treasury', 'Secret', 'Key'].join(''),
    ['aptos', 'Treasury', 'Address'].join(''),
    ['SOLANA', 'TREASURY', 'SECRET', 'KEY'].join('_'),
    ['APTOS', 'TREASURY', 'ADDRESS'].join('_'),
  ]) {
    assert.equal(config.includes(legacyKey), false, legacyKey);
  }
  assert.doesNotMatch(config, /vessel-dev-secret/);
});
