import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTrait,
  parseCsvTraitColumn,
  normalizeCsvTraitValue,
} from '../public/metadata-traits.js';
import {
  METADATA_PRESETS,
  formatItemName,
  metadataOutputPathForNumber,
} from '../public/metadata-template-presets.js';

test('metadata presets expose marketplace-compatible NFT modes', () => {
  assert.deepEqual(Object.keys(METADATA_PRESETS), [
    'marketplace',
    'image',
    'video',
    'audio',
    'html',
    'game',
  ]);
  assert.equal(METADATA_PRESETS.marketplace.category, 'image');
  assert.equal(METADATA_PRESETS.video.requiresAnimationUrl, true);
  assert.equal(METADATA_PRESETS.audio.requiresAnimationUrl, true);
  assert.equal(METADATA_PRESETS.html.category, 'html');
});

test('item names and JSON output paths use creator-friendly numbering', () => {
  assert.equal(formatItemName('<Collection Name> #<Number>', 'Vessel Genesis', 1), 'Vessel Genesis #1');
  assert.equal(formatItemName('<Collection Name> #<Number>', 'Vessel Genesis', 12), 'Vessel Genesis #12');
  assert.equal(metadataOutputPathForNumber(1), '1.json');
  assert.equal(metadataOutputPathForNumber(12), '12.json');
});

test('trait normalization supports text, number, date, boost, and generic string', () => {
  assert.deepEqual(normalizeTrait({ trait_type: 'Background', value: 'Blue' }), {
    trait_type: 'Background',
    value: 'Blue',
  });
  assert.deepEqual(normalizeTrait({
    display_type: 'number',
    trait_type: 'Power',
    value: '80',
    max_value: '100',
  }), {
    display_type: 'number',
    trait_type: 'Power',
    value: 80,
    max_value: 100,
  });
  assert.deepEqual(normalizeTrait({ display_type: 'date', trait_type: 'Birthday', value: '1546360800' }), {
    display_type: 'date',
    trait_type: 'Birthday',
    value: 1546360800,
  });
  assert.deepEqual(normalizeTrait({ display_type: 'boost_percentage', trait_type: 'Luck', value: '15' }), {
    display_type: 'boost_percentage',
    trait_type: 'Luck',
    value: 15,
  });
  assert.deepEqual(normalizeTrait({ value: 'Special Edition', generic: true }), {
    value: 'Special Edition',
  });
  assert.equal(normalizeTrait({ trait_type: '', value: '' }), null);
});

test('CSV trait headers map to normalized attributes', () => {
  assert.deepEqual(parseCsvTraitColumn('trait:Background'), {
    kind: 'text',
    trait_type: 'Background',
    max: false,
  });
  assert.deepEqual(parseCsvTraitColumn('number:Power'), {
    kind: 'number',
    trait_type: 'Power',
    max: false,
  });
  assert.deepEqual(parseCsvTraitColumn('number:Power:max'), {
    kind: 'number',
    trait_type: 'Power',
    max: true,
  });
  assert.deepEqual(parseCsvTraitColumn('date:Birthday'), {
    kind: 'date',
    trait_type: 'Birthday',
    max: false,
  });
  assert.deepEqual(normalizeCsvTraitValue(parseCsvTraitColumn('number:Power'), '80'), {
    display_type: 'number',
    trait_type: 'Power',
    value: 80,
  });
});
