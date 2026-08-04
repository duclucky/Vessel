const SUPPORTED_URI = /^(?:https:\/\/|ipfs:\/\/|ar:\/\/)[^\s]+$/i;

function issue(code, field) {
  return Object.freeze({ code, field });
}

function isSupportedUri(value) {
  if (typeof value !== 'string' || !SUPPORTED_URI.test(value)) return false;
  if (!value.toLowerCase().startsWith('https://')) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function freezeMetadata(metadata) {
  for (const attribute of metadata.attributes) Object.freeze(attribute);
  Object.freeze(metadata.attributes);
  for (const file of metadata.properties.files) Object.freeze(file);
  Object.freeze(metadata.properties.files);
  Object.freeze(metadata.properties);
  return Object.freeze(metadata);
}

export function createNftMetadata({
  name,
  description,
  image,
  externalUrl,
  attributes = [],
  mimeType = 'image/png',
} = {}) {
  const normalizedImage = String(image || '').trim();
  const metadata = {
    name: String(name || '').trim(),
    description: String(description || '').trim(),
    image: normalizedImage,
  };
  const normalizedExternalUrl = String(externalUrl || '').trim();
  if (normalizedExternalUrl) metadata.external_url = normalizedExternalUrl;
  metadata.attributes = Array.isArray(attributes)
    ? attributes.map(({ trait_type, value } = {}) => ({
      trait_type: String(trait_type || '').trim(),
      value,
    }))
    : [];
  metadata.properties = {
    files: [{ uri: normalizedImage, type: String(mimeType || '').trim() || 'image/png' }],
    category: 'image',
  };
  return freezeMetadata(metadata);
}

export function validateNftMetadata(metadata) {
  const errors = [];
  if (typeof metadata?.name !== 'string' || !metadata.name.trim()) {
    errors.push(issue('name_required', 'name'));
  }
  if (typeof metadata?.description !== 'string' || !metadata.description.trim()) {
    errors.push(issue('description_required', 'description'));
  }
  if (!isSupportedUri(metadata?.image)) {
    errors.push(issue('image_uri_invalid', 'image'));
  }
  if (metadata?.external_url != null && metadata.external_url !== '' && !isSupportedUri(metadata.external_url)) {
    errors.push(issue('external_uri_invalid', 'external_url'));
  }
  if (!Array.isArray(metadata?.attributes)) {
    errors.push(issue('attributes_invalid', 'attributes'));
  } else {
    metadata.attributes.forEach((attribute, index) => {
      if (typeof attribute?.trait_type !== 'string' || !attribute.trait_type.trim()) {
        errors.push(issue('attribute_trait_required', `attributes.${index}.trait_type`));
      }
      const value = attribute?.value;
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
        errors.push(issue('attribute_value_invalid', `attributes.${index}.value`));
      }
    });
  }

  const primary = metadata?.properties?.files?.[0];
  if (!primary || typeof primary.uri !== 'string' || !primary.uri || typeof primary.type !== 'string' || !primary.type) {
    errors.push(issue('primary_file_required', 'properties.files.0'));
  } else {
    if (primary.uri !== metadata.image) errors.push(issue('primary_file_uri_mismatch', 'properties.files.0.uri'));
    if (metadata?.properties?.category !== 'image') errors.push(issue('category_invalid', 'properties.category'));
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function serializeNftMetadata(metadata) {
  const validation = validateNftMetadata(metadata);
  if (!validation.valid) {
    throw Object.assign(new Error('Invalid NFT metadata'), {
      code: 'metadata_invalid',
      errors: validation.errors,
    });
  }
  return `${JSON.stringify(metadata, null, 2)}\n`;
}
