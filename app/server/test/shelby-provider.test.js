import test from 'node:test';
import assert from 'node:assert/strict';

import { ShelbyProvider } from '../src/storage/shelby.js';

test('Shelby provider selects and caches an active write location for current SDK uploads', async () => {
  const registrations = [];
  const commits = [];
  let locationReads = 0;
  const provider = Object.assign(Object.create(ShelbyProvider.prototype), {
    client: {
      metadata: {
        async getLocationNames() {
          locationReads += 1;
          return ['shelbynet-1'];
        },
      },
      coordination: {
        deployer: '0xshelby',
        async registerBlob(input) {
          registrations.push(input);
          return { transaction: { hash: `register-${registrations.length}` } };
        },
        async commitObject(input) {
          commits.push(input);
          return { transaction: { hash: `commit-${commits.length}` } };
        },
      },
      aptos: {
        async waitForTransaction({ transactionHash }) {
          return { hash: transactionHash, success: true, events: [] };
        },
      },
      rpc: {
        async putBlobChunksets() {
          return { spAcks: [{ slot: 0, signature: new Uint8Array([1]) }] };
        },
      },
    },
    sdk: {
      async createProvider() {
        return { config: { erasure_n: 1 } };
      },
      async generateCommitments() {
        return { blob_merkle_root: '0xabc' };
      },
      createBlobKey({ blobName }) {
        return `@owner/${blobName}`;
      },
      registeredBlobUids(_events, _deployer, objectName) {
        return [{ objectName, uid: 7n }];
      },
      requiredAckCount() {
        return 1;
      },
      findObjectCommitRejection() {
        return undefined;
      },
    },
    account: { accountAddress: { toString: () => '0x1' } },
    publicBase: 'https://vessel.example',
    runtime: { name: 'shelbynet' },
    index: new Map(),
  });

  await provider.put('media/one.json', new Uint8Array([1]), {
    contentType: 'application/json',
    expiresInSec: 60,
  });
  await provider.put('media/two.json', new Uint8Array([2]), {
    contentType: 'application/json',
    expiresInSec: 60,
  });

  assert.equal(locationReads, 1);
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].options.selectedLocation, 'shelbynet-1');
  assert.equal(registrations[1].options.selectedLocation, 'shelbynet-1');
  assert.equal(commits.length, 2);
  assert.equal(Object.hasOwn(commits[0], 'options'), false);
  assert.equal(Object.hasOwn(commits[1], 'options'), false);
});
