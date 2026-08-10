import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_MAX_BYTES,
  batchRelativePath,
  createBatchUploadManifest,
  createBatchQueue,
  runBatchQueue,
} from '../public/batch-upload.js';

function asset(name, size, type, relativePath = '') {
  return { name, size, type, webkitRelativePath: relativePath };
}

test('batch queue preserves folder paths and rejects unsupported or empty files', () => {
  const image = asset('1.png', 12, 'image/png', 'collection/images/1.png');
  const queue = createBatchQueue([
    image,
    asset('.DS_Store', 6, 'application/octet-stream', 'collection/.DS_Store'),
    asset('empty.png', 0, 'image/png', 'collection/images/empty.png'),
  ]);

  assert.equal(batchRelativePath(image), 'collection/images/1.png');
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].relativePath, 'collection/images/1.png');
  assert.deepEqual(queue.rejected.map((item) => item.reason), [
    'Unsupported file type',
    'Empty files cannot be uploaded',
  ]);
});

test('batch paths accept files returned by the native directory picker', () => {
  const image = asset('1.png', 12, 'image/png');
  image.vesselRelativePath = 'collection/images/1.png';

  assert.equal(batchRelativePath(image), 'collection/images/1.png');
});

test('batch queue rejects an accepted selection larger than the 1 GB beta limit', () => {
  assert.throws(
    () => createBatchQueue([
      asset('large.mp4', BATCH_MAX_BYTES + 1, 'video/mp4', 'collection/large.mp4'),
    ], { maxFileBytes: BATCH_MAX_BYTES + 1 }),
    (error) => error?.code === 'batch_too_large' && error?.limitBytes === BATCH_MAX_BYTES,
  );
});

test('batch queue reports aggregate byte progress across sequential state transitions', () => {
  const queue = createBatchQueue([
    asset('1.png', 25, 'image/png', 'collection/1.png'),
    asset('2.png', 75, 'image/png', 'collection/2.png'),
  ]);

  const first = queue.next();
  queue.markUploading(first.id);
  assert.equal(queue.summary().uploading, 1);
  queue.markSucceeded(first.id, { key: 'media/1.png' });

  assert.deepEqual(queue.summary(), {
    total: 2,
    queued: 1,
    uploading: 0,
    succeeded: 1,
    failed: 0,
    completed: 1,
    totalBytes: 100,
    completedBytes: 25,
    progressPercent: 25,
  });
  assert.equal(queue.next().relativePath, 'collection/2.png');
});

test('retryFailed resets only failed files and never repeats successful files', () => {
  const queue = createBatchQueue([
    asset('1.png', 25, 'image/png', 'collection/1.png'),
    asset('2.png', 75, 'image/png', 'collection/2.png'),
  ]);
  const first = queue.next();
  queue.markUploading(first.id);
  queue.markSucceeded(first.id, { key: 'media/1.png' });
  const second = queue.next();
  queue.markUploading(second.id);
  queue.markFailed(second.id, Object.assign(new Error('RPC unavailable'), { code: 'rpc_unavailable' }));

  assert.equal(queue.retryFailed(), 1);
  assert.equal(queue.items[0].status, 'succeeded');
  assert.equal(queue.items[1].status, 'queued');
  assert.equal(queue.next().id, second.id);
});

test('batch queue rejects files above the active per-file limit before payment', () => {
  const mb = 1024 * 1024;
  const queue = createBatchQueue([
    asset('cover.png', 12, 'image/png', 'collection/cover.png'),
    asset('oversize.mp4', 26 * mb, 'video/mp4', 'collection/oversize.mp4'),
  ], { maxFileBytes: 25 * mb });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.rejected[0].reason, 'File exceeds the 25 MB per-file limit');
});

test('batch runner awaits each wallet-owned upload before starting the next file', async () => {
  const queue = createBatchQueue([
    asset('1.png', 25, 'image/png', 'collection/1.png'),
    asset('2.png', 75, 'image/png', 'collection/2.png'),
  ]);
  const events = [];
  let active = 0;
  let maxActive = 0;

  const outcome = await runBatchQueue(queue, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${item.relativePath}`);
    await Promise.resolve();
    events.push(`finish:${item.relativePath}`);
    active -= 1;
    return { key: item.relativePath };
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(events, [
    'start:collection/1.png',
    'finish:collection/1.png',
    'start:collection/2.png',
    'finish:collection/2.png',
  ]);
  assert.equal(outcome.status, 'complete');
  assert.equal(queue.summary().succeeded, 2);
});

test('batch runner pauses after a failure and leaves later files queued', async () => {
  const queue = createBatchQueue([
    asset('1.png', 25, 'image/png', 'collection/1.png'),
    asset('2.png', 75, 'image/png', 'collection/2.png'),
  ]);

  const outcome = await runBatchQueue(queue, async () => {
    throw Object.assign(new Error('Wallet approval rejected'), { code: 'user_rejected' });
  });

  assert.equal(outcome.status, 'paused');
  assert.equal(queue.items[0].status, 'failed');
  assert.equal(queue.items[1].status, 'queued');
  assert.equal(queue.items[0].error.code, 'user_rejected');
});

test('batch queue never retries a file whose contract receipt is already pending', () => {
  const queue = createBatchQueue([
    asset('1.png', 25, 'image/png', 'collection/1.png'),
  ]);
  const item = queue.next();
  queue.markUploading(item.id);
  queue.markFailed(item.id, Object.assign(new Error('Receipt pending'), { code: 'receipt_pending' }));

  assert.equal(queue.items[0].error.retryable, false);
  assert.equal(queue.retryFailed(), 0);
  assert.equal(queue.items[0].status, 'failed');
});

test('batch upload manifest binds every folder item before one approval', async () => {
  const queue = createBatchQueue([
    asset('2.png', 75, 'image/png', 'collection/2.png'),
    asset('1.png', 25, 'image/png', 'collection/1.png'),
  ]);
  const hashes = {
    'collection/1.png': '11'.repeat(32),
    'collection/2.png': '22'.repeat(32),
  };

  const manifest = await createBatchUploadManifest(queue.items, {
    sha256FileHex: async (file) => hashes[batchRelativePath(file)],
    contentAddressedBlobName: (_file, hash) => `media/${hash}.png`,
  });

  assert.equal(manifest.items.length, 2);
  assert.equal(manifest.totalBytes, 100);
  assert.deepEqual(manifest.items.map((item) => item.relativePath), [
    'collection/1.png',
    'collection/2.png',
  ]);
  assert.equal(manifest.items[0].fileHash, '11'.repeat(32));
  assert.equal(manifest.items[1].blobName, `media/${'22'.repeat(32)}.png`);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.virtualFile.size, 100);
  assert.equal(manifest.virtualFile.type, 'application/vnd.vessel.batch-manifest+json');
});
