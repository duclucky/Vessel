import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectDirectoryFiles,
  supportsDirectoryPicker,
} from '../public/directory-picker.js';

function fileHandle(name, file = { name, size: 1, type: 'image/png' }) {
  return {
    kind: 'file',
    name,
    async getFile() { return file; },
  };
}

function directoryHandle(name, entries) {
  return {
    kind: 'directory',
    name,
    async *values() { yield* entries; },
  };
}

test('collectDirectoryFiles recursively preserves collection-relative paths', async () => {
  const cover = { name: 'cover.png', size: 1, type: 'image/png' };
  const metadata = { name: '1.json', size: 1, type: 'application/json' };
  const root = directoryHandle('collection', [
    fileHandle('cover.png', cover),
    directoryHandle('metadata', [fileHandle('1.json', metadata)]),
  ]);

  const files = await collectDirectoryFiles(root);

  assert.deepEqual(files, [cover, metadata]);
  assert.equal(cover.vesselRelativePath, 'collection/cover.png');
  assert.equal(metadata.vesselRelativePath, 'collection/metadata/1.json');
});

test('supportsDirectoryPicker detects the native browser capability', () => {
  assert.equal(supportsDirectoryPicker({ showDirectoryPicker() {} }), true);
  assert.equal(supportsDirectoryPicker({}), false);
  assert.equal(supportsDirectoryPicker(null), false);
});
