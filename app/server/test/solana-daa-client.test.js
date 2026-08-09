import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../client-src/vessel-solana.js', import.meta.url), 'utf8');

test('DAA client requires an explicitly selected provider', () => {
  assert.match(source, /function selectProvider\(nextProvider\)/);
  assert.match(source, /async function connect\(nextProvider\)/);
  assert.match(source, /function clearProvider\(\)/);
  assert.doesNotMatch(source, /provider\s*=\s*getPhantom\(\)/);
});

test('DAA client no longer exposes funding URLs', () => {
  assert.doesNotMatch(source, /faucet/i);
  assert.doesNotMatch(source, /faucets/);
});

test('Solana DAA derives and signs with the same browser host as the official Shelby hook', () => {
  assert.match(source, /window\.location\.host/);
  assert.doesNotMatch(source, /if \(serverCfg\.domain\) DOMAIN = serverCfg\.domain/);
  assert.match(source, /Official Shelby storage identity does not match the signing domain/);
});

test('DAA upload binds the sponsor request to quote, authorization, hash, tier, and expiration', () => {
  assert.match(source, /quoteToken/);
  assert.match(source, /paidAuthorization/);
  assert.match(source, /expectedFileHash/);
  assert.match(source, /paymentTier/);
  assert.match(source, /uploadContext\.expirationMicros !== expirationMicros/);
  assert.doesNotMatch(source, /paymentId/);
  assert.doesNotMatch(source, /uploadToken/);
  assert.doesNotMatch(source, /7\s*\*\s*24\s*\*\s*3600/);
});

test('DAA registration and bytes use authenticated Vessel server routes', () => {
  assert.match(source, /\/api\/shelby\/register/);
  assert.match(source, /\/api\/shelby\/commit/);
  assert.match(source, /uploadBlobViaVesselGateway/);
  assert.match(source, /registrationUid/);
  assert.match(source, /blobMerkleRoot/);
  assert.match(source, /commitPayload/);
  assert.match(source, /SimpleTransaction\.deserialize/);
  assert.match(source, /transactionKind:\s*'simple'/);
  assert.match(source, /expectRegistrationEvidence:\s*false/);
  assert.match(source, /contractQuote/);
  assert.match(source, /contractSignature/);
  assert.doesNotMatch(source, /new ShelbyClient/);
  assert.doesNotMatch(source, /anonymous writes/i);
  assert.doesNotMatch(source, /ephemeral/);
});
