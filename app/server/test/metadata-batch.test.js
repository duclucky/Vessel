import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METADATA_BATCH_MAX_BYTES,
  METADATA_BATCH_MAX_ITEMS,
  buildMetadataBatch,
  indexMetadataFolder,
  parseMetadataCsv,
} from '../public/metadata-batch.js';

function asset(name, relativePath, type, body = 'x', size = null) {
  const file = new File([body], name, { type });
  Object.defineProperty(file, 'vesselRelativePath', { value: relativePath, configurable: true });
  if (size == null) return file;
  return {
    name,
    type,
    size,
    vesselRelativePath: relativePath,
    async text() { return String(body); },
  };
}

const defaults = {
  namePrefix: 'Vessel Genesis',
  description: 'Wallet-owned collection',
  externalUrl: 'https://vessel-sage.vercel.app',
  attributes: [{ trait_type: 'Series', value: 'Genesis' }],
  startNumber: 1,
};

test('batch pairs images and JSON by normalized relative stem', async () => {
  const files = [
    asset('001.png', 'collection/images/001.png', 'image/png'),
    asset('001.json', 'collection/metadata/001.json', 'application/json', JSON.stringify({
      name: 'Imported #1',
      description: 'Imported description',
      image: 'https://stale.example/old.png',
      attributes: [{ trait_type: 'Sky', value: 'Blue' }],
    })),
  ];
  const result = await buildMetadataBatch({
    files,
    defaults,
    uriForImage: async () => 'https://example.com/001.png',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].metadata.name, 'Imported #1');
  assert.equal(result.items[0].metadata.description, 'Imported description');
  assert.equal(result.items[0].metadata.image, 'https://example.com/001.png');
  assert.deepEqual(result.items[0].metadata.attributes, [
    { trait_type: 'Series', value: 'Genesis' },
    { trait_type: 'Sky', value: 'Blue' },
  ]);
  assert.equal(result.items[0].outputPath, 'metadata/001.json');
  assert.equal(result.items[0].status, 'valid');
  assert.equal(JSON.parse(result.items[0].serialized).properties.files[0].uri, 'https://example.com/001.png');
});

test('CSV item fields and traits override matching JSON and collection defaults', async () => {
  const rows = parseMetadataCsv([
    'filename,name,description,trait:Background',
    '001.png,CSV Name,CSV Description,Nebula',
  ].join('\n'));
  const result = await buildMetadataBatch({
    files: [
      asset('001.png', 'collection/images/001.png', 'image/png'),
      asset('001.json', 'collection/metadata/001.json', 'application/json', JSON.stringify({
        name: 'JSON Name',
        description: 'JSON Description',
        attributes: [{ trait_type: 'Background', value: 'Blue' }],
      })),
    ],
    csvRows: rows,
    defaults,
    uriForImage: async () => 'ipfs://collection/001.png',
  });

  assert.equal(result.items[0].metadata.name, 'CSV Name');
  assert.equal(result.items[0].metadata.description, 'CSV Description');
  assert.deepEqual(result.items[0].metadata.attributes, [
    { trait_type: 'Series', value: 'Genesis' },
    { trait_type: 'Background', value: 'Nebula' },
  ]);
});

test('images-only batch generates easy defaults with stable numbering', async () => {
  const result = await buildMetadataBatch({
    files: [
      asset('alpha.png', 'collection/alpha.png', 'image/png'),
      asset('beta.webp', 'collection/beta.webp', 'image/webp'),
    ],
    defaults: { ...defaults, startNumber: 7 },
    uriForImage: async (_file, relativePath) => `https://example.com/${relativePath}`,
  });

  assert.deepEqual(result.items.map((item) => item.metadata.name), [
    'Vessel Genesis #007',
    'Vessel Genesis #008',
  ]);
  assert.deepEqual(result.items.map((item) => item.outputPath), [
    'metadata/alpha.json',
    'metadata/beta.json',
  ]);
  assert.deepEqual(result.items.map((item) => item.metadata.properties.files[0].type), [
    'image/png',
    'image/webp',
  ]);
});

test('CSV parser supports quoted commas, escaped quotes, CRLF, and blank optional cells', () => {
  const rows = parseMetadataCsv([
    'filename,name,description,external_url,trait:Mood',
    '001.png,"One, First","Says ""hello""",,Calm',
  ].join('\r\n'));

  assert.deepEqual(rows, [{
    filename: '001.png',
    name: 'One, First',
    description: 'Says "hello"',
    external_url: '',
    attributes: [{ trait_type: 'Mood', value: 'Calm' }],
  }]);
});

test('CSV parser rejects missing identifiers, duplicate filenames, and overflowing rows', () => {
  assert.throws(
    () => parseMetadataCsv('name\nOne\n'),
    (error) => error.code === 'csv_filename_required',
  );
  assert.throws(
    () => parseMetadataCsv('filename,name\n001.png,One\n001.png,Two\n'),
    (error) => error.code === 'csv_filename_duplicate',
  );
  assert.throws(
    () => parseMetadataCsv('filename,name\n001.png,One,Extra\n'),
    (error) => error.code === 'csv_row_too_wide',
  );
});

test('folder index reports skipped files and unmatched JSON without blocking valid images', async () => {
  const files = [
    asset('001.png', 'collection/images/001.png', 'image/png'),
    asset('orphan.json', 'collection/metadata/orphan.json', 'application/json', '{}'),
    asset('.DS_Store', 'collection/.DS_Store', 'application/octet-stream'),
    asset('notes.txt', 'collection/notes.txt', 'text/plain'),
  ];
  const indexed = indexMetadataFolder(files);
  assert.equal(indexed.images.length, 1);
  assert.equal(indexed.jsonByStem.size, 1);

  const result = await buildMetadataBatch({
    files,
    defaults,
    uriForImage: async () => 'https://example.com/001.png',
  });
  assert.deepEqual(result.warnings.map((warning) => warning.code), [
    'hidden_file_skipped',
    'unsupported_file_skipped',
    'json_unmatched',
  ]);
});

test('malformed matching JSON marks only its image invalid', async () => {
  const result = await buildMetadataBatch({
    files: [
      asset('001.png', 'collection/images/001.png', 'image/png'),
      asset('002.png', 'collection/images/002.png', 'image/png'),
      asset('001.json', 'collection/metadata/001.json', 'application/json', '{broken'),
    ],
    defaults,
    uriForImage: async (_file, relativePath) => `https://example.com/${relativePath}`,
  });

  assert.deepEqual(result.items.map((item) => item.status), ['invalid', 'valid']);
  assert.equal(result.items[0].errors[0].code, 'json_malformed');
  assert.equal(result.errors.length, 1);
});

test('missing collection defaults produce actionable item errors', async () => {
  const result = await buildMetadataBatch({
    files: [asset('001.png', 'collection/001.png', 'image/png')],
    defaults: {},
    uriForImage: async () => 'https://example.com/001.png',
  });

  assert.equal(result.items[0].status, 'invalid');
  assert.deepEqual(result.items[0].errors.map((error) => error.code), [
    'name_required',
    'description_required',
  ]);
});

test('duplicate output stems and beta limits fail before generation', async () => {
  await assert.rejects(
    () => buildMetadataBatch({
      files: [
        asset('001.png', 'collection/images/001.png', 'image/png'),
        asset('001.webp', 'collection/images/001.webp', 'image/webp'),
      ],
      defaults,
      uriForImage: async () => 'https://example.com/image',
    }),
    (error) => error.code === 'metadata_output_duplicate',
  );

  assert.throws(
    () => indexMetadataFolder([
      asset('huge.png', 'collection/huge.png', 'image/png', 'x', METADATA_BATCH_MAX_BYTES + 1),
    ]),
    (error) => error.code === 'metadata_batch_too_large',
  );

  const tooMany = Array.from({ length: METADATA_BATCH_MAX_ITEMS + 1 }, (_, index) => (
    asset(`${index}.png`, `collection/${index}.png`, 'image/png', 'x', 1)
  ));
  assert.throws(
    () => indexMetadataFolder(tooMany),
    (error) => error.code === 'metadata_batch_too_many_items',
  );
});
