export const SUPPORTED_METADATA_CATEGORIES = Object.freeze(['image', 'video', 'audio', 'html', 'vr']);

export const METADATA_PRESETS = Object.freeze({
  marketplace: Object.freeze({
    id: 'marketplace',
    label: 'Marketplace Compatible',
    category: 'image',
    requiresAnimationUrl: false,
    suggestedTraits: Object.freeze([]),
  }),
  image: Object.freeze({
    id: 'image',
    label: 'Image NFT',
    category: 'image',
    requiresAnimationUrl: false,
    suggestedTraits: Object.freeze([]),
  }),
  video: Object.freeze({
    id: 'video',
    label: 'Video NFT',
    category: 'video',
    requiresAnimationUrl: true,
    suggestedTraits: Object.freeze([]),
  }),
  audio: Object.freeze({
    id: 'audio',
    label: 'Audio NFT',
    category: 'audio',
    requiresAnimationUrl: true,
    suggestedTraits: Object.freeze([]),
  }),
  html: Object.freeze({
    id: 'html',
    label: 'HTML or Interactive NFT',
    category: 'html',
    requiresAnimationUrl: true,
    suggestedTraits: Object.freeze([]),
  }),
  game: Object.freeze({
    id: 'game',
    label: 'Game Item',
    category: 'image',
    requiresAnimationUrl: false,
    suggestedTraits: Object.freeze(['Class', 'Rarity', 'Level', 'Power', 'Season']),
  }),
});

export function metadataOutputPathForNumber(number) {
  const value = Number(number);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw Object.assign(new Error('Token number must be a non-negative integer'), {
      code: 'metadata_token_number_invalid',
    });
  }
  return `${value}.json`;
}

export function formatItemName(pattern, collectionName, tokenNumber) {
  const source = String(pattern || '<Collection Name> #<Number>');
  const name = String(collectionName || '').trim();
  const number = Number(tokenNumber);
  return source
    .replaceAll('<Collection Name>', name)
    .replaceAll('<Number>', Number.isFinite(number) ? String(number) : '');
}
