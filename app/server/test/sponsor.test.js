import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectAptosSubmitter, SponsorManager, resolveGasStationNetwork } from '../src/lib/sponsor.js';

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
  let seenKind;
  const sponsor = new SponsorManager({
    gasStationClient: { signAndSubmitTransaction: async () => ({ hash: '0xhash' }) },
    deserialize: (_txn, _auth, transactionKind) => {
      seenKind = transactionKind;
      return decoded('0xpaid');
    },
  });

  assert.deepEqual(
    await sponsor.submit('txn', 'auth', { expectedSender: '0xPAID', transactionKind: 'simple' }),
    { hash: '0xhash' },
  );
  assert.equal(seenKind, 'simple');
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

test('direct submitter submits a signed simple DAA transaction without gas station', async () => {
  const calls = [];
  const submitter = new DirectAptosSubmitter({
    aptos: {
      transaction: {
        submit: {
          simple: async (input) => {
            calls.push(input);
            return { hash: '0xdirect' };
          },
        },
      },
    },
    deserialize: () => decoded('0xpaid'),
  });

  assert.deepEqual(
    await submitter.submit('txn', 'auth', { expectedSender: '0xPAID' }),
    { hash: '0xdirect' },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].transaction.rawTransaction.sender.toString(), '0xpaid');
  assert.deepEqual(calls[0].senderAuthenticator, { kind: 'auth' });
});
