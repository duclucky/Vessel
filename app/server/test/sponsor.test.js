import test from 'node:test';
import assert from 'node:assert/strict';
import { SponsorManager, resolveGasStationNetwork } from '../src/lib/sponsor.js';

const decoded = (value) => ({
  transaction: { rawTransaction: { sender: { toString: () => value } } },
  senderAuthenticator: { kind: 'auth' },
});

test('sponsor rejects a transaction whose sender differs from the paid DAA', async () => {
  let submitted = false;
  const sponsor = new SponsorManager({
    gasStationClient: {
      signAndSubmitTransaction: async () => { submitted = true; return { hash: '0xhash' }; },
    },
    deserialize: () => decoded('0xattacker'),
  });

  await assert.rejects(
    () => sponsor.submit('txn', 'auth', { expectedSender: '0xpaid' }),
    (error) => error.code === 'sender_mismatch' && error.status === 403,
  );
  assert.equal(submitted, false);
});

test('sponsor submits when transaction sender equals the paid DAA', async () => {
  const sponsor = new SponsorManager({
    gasStationClient: { signAndSubmitTransaction: async () => ({ hash: '0xhash' }) },
    deserialize: () => decoded('0xpaid'),
  });

  assert.deepEqual(
    await sponsor.submit('txn', 'auth', { expectedSender: '0xPAID' }),
    { hash: '0xhash' },
  );
});

test('sponsor requires a non-empty expected sender', async () => {
  const sponsor = new SponsorManager({
    gasStationClient: { signAndSubmitTransaction: async () => ({ hash: '0xhash' }) },
    deserialize: () => decoded('0xpaid'),
  });

  await assert.rejects(
    () => sponsor.submit('txn', 'auth', { expectedSender: '' }),
    (error) => error.code === 'sender_required' && error.status === 400,
  );
});

test('sponsor resolves ShelbyNet for gas station submissions', () => {
  assert.equal(resolveGasStationNetwork('shelbynet'), 'shelbynet');
  assert.equal(resolveGasStationNetwork('testnet'), 'testnet');
});
