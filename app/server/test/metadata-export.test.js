import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCollectionManifest,
  buildMetadataZip,
  downloadBlob,
  metadataJsonFile,
} from '../public/metadata-export.js';

const metadata = {
  name: 'Vessel #001',
  description: 'Wallet-owned metadata',
  image: 'https://example.com/001.png',
  attributes: [],
  properties: {
    files: [{ uri: 'https://example.com/001.png', type: 'image/png' }],
    category: 'image',
  },
};

function readStoredZip(bytes) {
  const entries = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    assert.equal(method, 0, 'ZIP entry must use stored compression');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(name, decoder.decode(bytes.subarray(dataStart, dataStart + compressedSize)));
    offset = dataStart + compressedSize;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50, 'central directory signature');
  return entries;
}

test('single metadata export creates a UTF-8 JSON file', async () => {
  const file = metadataJsonFile(metadata, '001.json');

  assert.equal(file.type, 'application/json');
  assert.equal(file.name, '001.json');
  assert.equal(await file.text(), `${JSON.stringify(metadata, null, 2)}\n`);
});

test('collection manifest maps images to hosted metadata TokenURIs as CSV and copy text', async () => {
  const manifest = buildCollectionManifest([
    {
      sourcePath: 'genesis/images/1.png',
      outputPath: 'metadata/1.json',
      metadata: {
        name: 'Genesis #1',
        image: 'https://vessel.example/api/shelby/blobs/0xabc/media/1.png',
      },
    },
    {
      sourcePath: 'genesis/images/2.png',
      outputPath: 'metadata/2.json',
      metadata: {
        name: 'Genesis, #2',
        image: 'https://vessel.example/api/shelby/blobs/0xabc/media/2.png',
      },
    },
  ], [
    { sourcePath: 'metadata/2.json', url: 'https://vessel.example/api/shelby/blobs/0xabc/metadata/2.json' },
    { sourcePath: 'metadata/1.json', tokenUri: 'https://vessel.example/api/shelby/blobs/0xabc/metadata/1.json' },
  ], { collectionName: 'Genesis' });

  assert.equal(manifest.collectionName, 'Genesis');
  assert.deepEqual(manifest.tokenUris, [
    'https://vessel.example/api/shelby/blobs/0xabc/metadata/1.json',
    'https://vessel.example/api/shelby/blobs/0xabc/metadata/2.json',
  ]);
  assert.equal(manifest.copyText, `${manifest.tokenUris.join('\n')}\n`);
  assert.equal(await manifest.csv.text(), [
    'collection,item_name,source_path,image_url,metadata_path,metadata_url',
    'Genesis,Genesis #1,genesis/images/1.png,https://vessel.example/api/shelby/blobs/0xabc/media/1.png,metadata/1.json,https://vessel.example/api/shelby/blobs/0xabc/metadata/1.json',
    'Genesis,"Genesis, #2",genesis/images/2.png,https://vessel.example/api/shelby/blobs/0xabc/media/2.png,metadata/2.json,https://vessel.example/api/shelby/blobs/0xabc/metadata/2.json',
    '',
  ].join('\n'));
});

test('batch ZIP contains deterministic JSON paths and a redacted report', async () => {
  const zip = await buildMetadataZip([
    { outputPath: 'metadata/002.json', serialized: '{"name":"Two"}\n' },
    { outputPath: 'metadata/001.json', serialized: '{"name":"One"}\n' },
  ], {
    warnings: [{
      code: 'file_skipped',
      path: 'C:\\Users\\Alice\\collection\\.DS_Store',
      message: 'Skipped C:\\Users\\Alice\\collection\\.DS_Store',
      authorization: 'paid-secret',
    }],
    signature: 'wallet-signature',
    apiKey: 'AG-secret',
  });

  assert.equal(zip.type, 'application/zip');
  const entries = readStoredZip(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual([...entries.keys()], [
    'metadata/001.json',
    'metadata/002.json',
    'metadata-report.json',
  ]);
  assert.equal(entries.get('metadata/001.json'), '{"name":"One"}\n');
  const report = entries.get('metadata-report.json');
  assert.doesNotMatch(report, /signature|authorization|apiKey|AG-secret|C:\\|C:\//i);
  assert.deepEqual(JSON.parse(report), {
    generated: 2,
    warningCount: 1,
    warnings: [{
      code: 'file_skipped',
      path: '.DS_Store',
      message: 'Skipped .DS_Store',
    }],
  });
});

test('ZIP export rejects unsafe or duplicate entry paths', async () => {
  for (const outputPath of ['/absolute.json', '../escape.json', 'C:\\escape.json']) {
    await assert.rejects(
      () => buildMetadataZip([{ outputPath, serialized: '{}\n' }], {}),
      (error) => error.code === 'zip_path_invalid',
    );
  }
  await assert.rejects(
    () => buildMetadataZip([
      { outputPath: 'metadata/one.json', serialized: '{}\n' },
      { outputPath: 'metadata/ONE.json', serialized: '{}\n' },
    ], {}),
    (error) => error.code === 'zip_path_duplicate',
  );
});

test('downloadBlob clicks a temporary link and revokes the object URL', async () => {
  const events = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:vessel-test';
  URL.revokeObjectURL = (url) => events.push(`revoke:${url}`);
  const link = {
    hidden: false,
    click() { events.push('click'); },
    remove() { events.push('remove'); },
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, 'a');
      return link;
    },
    body: { appendChild(node) { assert.equal(node, link); events.push('append'); } },
  };

  try {
    downloadBlob(new Blob(['x']), 'metadata.json', document);
    assert.equal(link.href, 'blob:vessel-test');
    assert.equal(link.download, 'metadata.json');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(events, [
      'append',
      'click',
      'remove',
      'revoke:blob:vessel-test',
    ]);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
