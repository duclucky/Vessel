import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNftMetadata,
  serializeNftMetadata,
  validateNftMetadata,
} from '../public/metadata-schema.js';

test('canonical metadata includes marketplace fields in stable order', () => {
  const metadata = createNftMetadata({
    name: '  Vessel Genesis #001  ',
    description: '  Wallet-owned artifact  ',
    image: 'https://example.com/001.png',
    externalUrl: 'https://vessel-sage.vercel.app',
    attributes: [{ trait_type: ' Background ', value: 'Nebula' }],
    mimeType: 'image/png',
  });

  assert.deepEqual(metadata, {
    name: 'Vessel Genesis #001',
    description: 'Wallet-owned artifact',
    image: 'https://example.com/001.png',
    external_url: 'https://vessel-sage.vercel.app',
    attributes: [{ trait_type: 'Background', value: 'Nebula' }],
    properties: {
      files: [{ uri: 'https://example.com/001.png', type: 'image/png' }],
      category: 'image',
    },
  });
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Object.isFrozen(metadata.attributes), true);
  assert.equal(validateNftMetadata(metadata).valid, true);

  const serialized = serializeNftMetadata(metadata);
  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(serialized.indexOf('"name"') < serialized.indexOf('"description"'), true);
  assert.equal(serialized.indexOf('"description"') < serialized.indexOf('"image"'), true);
  assert.equal(JSON.parse(serialized).image, 'https://example.com/001.png');
});

test('canonical metadata rejects blank fields, unsafe URIs, and malformed traits', () => {
  const result = validateNftMetadata({
    name: '',
    description: '',
    image: 'javascript:alert(1)',
    external_url: 'http://insecure.example',
    attributes: [{ trait_type: '', value: {} }],
    properties: { files: [], category: 'image' },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'name_required',
    'description_required',
    'image_uri_invalid',
    'external_uri_invalid',
    'attribute_trait_required',
    'attribute_value_invalid',
    'primary_file_required',
  ]);
});

test('canonical metadata accepts IPFS and Arweave media with finite numeric traits', () => {
  for (const image of ['ipfs://bafy/image.png', 'ar://transaction-id']) {
    const metadata = createNftMetadata({
      name: 'Cross-chain asset',
      description: 'Portable metadata',
      image,
      attributes: [{ trait_type: 'Level', value: 7 }],
      mimeType: 'image/png',
    });
    assert.equal(validateNftMetadata(metadata).valid, true);
  }

  const invalid = createNftMetadata({
    name: 'Invalid number',
    description: 'Infinity must not be serialized',
    image: 'https://example.com/a.png',
    attributes: [{ trait_type: 'Level', value: Number.POSITIVE_INFINITY }],
    mimeType: 'image/png',
  });
  assert.equal(validateNftMetadata(invalid).errors.some((error) => error.code === 'attribute_value_invalid'), true);
});
