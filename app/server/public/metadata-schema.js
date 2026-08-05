import {
  METADATA_PRESETS,
  SUPPORTED_METADATA_CATEGORIES,
} from './metadata-template-presets.js';
import { normalizeTrait } from './metadata-traits.js';

const SUPPORTED_URI = /^(?:https:\/\/|ipfs:\/\/|ar:\/\/)[^\s]+$/i;
const BACKGROUND_COLOR = /^[0-9a-f]{6}$/i;
const VALID_DISPLAY_TYPES = new Set(['number', 'date', 'boost_number', 'boost_percentage']);

function issue(code, field, severity = 'error') {
  return Object.freeze({ code, field, severity });
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

function normalizedMime(value, fallback) {
  return String(value || '').trim() || fallback;
}

function normalizedCategory(preset, explicitCategory) {
  const presetEntry = METADATA_PRESETS[preset] || METADATA_PRESETS.marketplace;
  const category = String(explicitCategory || presetEntry.category || 'image').trim().toLowerCase();
  return category || 'image';
}

function freezeMetadata(metadata) {
  for (const attribute of metadata.attributes) Object.freeze(attribute);
  Object.freeze(metadata.attributes);
  for (const file of metadata.properties.files) Object.freeze(file);
  Object.freeze(metadata.properties.files);
  if (metadata.properties.vessel) Object.freeze(metadata.properties.vessel);
  Object.freeze(metadata.properties);
  return Object.freeze(metadata);
}

function normalizedAttributes(attributes) {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((attribute) => normalizeTrait(attribute))
    .filter(Boolean);
}

function cleanOptionalUrl(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function createNftMetadata({
  preset = 'marketplace',
  name,
  description,
  image,
  externalUrl,
  animationUrl,
  attributes = [],
  mimeType = 'image/png',
  animationMimeType = '',
  backgroundColor,
  category,
  vesselProof,
} = {}) {
  const normalizedImage = String(image || '').trim();
  const normalizedAnimationUrl = cleanOptionalUrl(animationUrl);
  const normalizedExternalUrl = cleanOptionalUrl(externalUrl);
  const metadata = {
    name: String(name || '').trim(),
    description: String(description || '').trim(),
    image: normalizedImage,
  };
  if (normalizedAnimationUrl) metadata.animation_url = normalizedAnimationUrl;
  if (normalizedExternalUrl) metadata.external_url = normalizedExternalUrl;
  const normalizedBackground = String(backgroundColor || '').trim().replace(/^#/, '');
  if (normalizedBackground) metadata.background_color = normalizedBackground;
  metadata.attributes = normalizedAttributes(attributes);
  const files = [{ uri: normalizedImage, type: normalizedMime(mimeType, 'image/png') }];
  if (normalizedAnimationUrl) {
    files.push({
      uri: normalizedAnimationUrl,
      type: normalizedMime(animationMimeType, 'application/octet-stream'),
    });
  }
  metadata.properties = {
    files,
    category: normalizedCategory(preset, category),
  };
  if (vesselProof && typeof vesselProof === 'object' && !Array.isArray(vesselProof)) {
    metadata.properties.vessel = Object.freeze({
      storage_network: String(vesselProof.storage_network || '').trim(),
      storage_address: String(vesselProof.storage_address || '').trim(),
      media_url: String(vesselProof.media_url || '').trim(),
      receipt_chain: String(vesselProof.receipt_chain || '').trim(),
      receipt_hash: String(vesselProof.receipt_hash || '').trim(),
      expires_at: String(vesselProof.expires_at || '').trim(),
    });
  }
  return freezeMetadata(metadata);
}

export function validateNftMetadata(metadata) {
  const errors = [];
  const warnings = [];
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
  if (metadata?.animation_url != null && metadata.animation_url !== '' && !isSupportedUri(metadata.animation_url)) {
    errors.push(issue('animation_uri_invalid', 'animation_url'));
  }
  if (metadata?.background_color != null && metadata.background_color !== '' && !BACKGROUND_COLOR.test(metadata.background_color)) {
    errors.push(issue('background_color_invalid', 'background_color'));
  }
  if (!SUPPORTED_METADATA_CATEGORIES.includes(String(metadata?.properties?.category || '').toLowerCase())) {
    warnings.push(issue('category_unsupported', 'properties.category', 'warning'));
  }
  if (!Array.isArray(metadata?.attributes)) {
    errors.push(issue('attributes_invalid', 'attributes'));
  } else {
    if (!metadata.attributes.length) warnings.push(issue('metadata_no_traits', 'attributes', 'warning'));
    metadata.attributes.forEach((attribute, index) => {
      const traitType = attribute?.trait_type;
      const generic = traitType == null && typeof attribute?.value === 'string';
      if (!generic && (typeof traitType !== 'string' || !traitType.trim())) {
        errors.push(issue('attribute_trait_required', `attributes.${index}.trait_type`));
      }
      const displayType = attribute?.display_type;
      if (displayType != null && !VALID_DISPLAY_TYPES.has(String(displayType))) {
        errors.push(issue('attribute_display_type_invalid', `attributes.${index}.display_type`));
      }
      const value = attribute?.value;
      const numeric = displayType != null;
      if (numeric && !(typeof value === 'number' && Number.isFinite(value))) {
        errors.push(issue('attribute_value_invalid', `attributes.${index}.value`));
      }
      if (!numeric && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
        errors.push(issue('attribute_value_invalid', `attributes.${index}.value`));
      }
      if (attribute?.max_value != null && !(typeof attribute.max_value === 'number' && Number.isFinite(attribute.max_value))) {
        errors.push(issue('attribute_max_value_invalid', `attributes.${index}.max_value`));
      }
    });
  }

  const primary = metadata?.properties?.files?.[0];
  if (!primary || typeof primary.uri !== 'string' || !primary.uri || typeof primary.type !== 'string' || !primary.type) {
    errors.push(issue('primary_file_required', 'properties.files.0'));
  } else {
    if (primary.uri !== metadata.image) errors.push(issue('primary_file_uri_mismatch', 'properties.files.0.uri'));
  }
  for (const [index, file] of [...(metadata?.properties?.files || [])].entries()) {
    if (!isSupportedUri(file?.uri)) errors.push(issue('file_uri_invalid', `properties.files.${index}.uri`));
    if (typeof file?.type !== 'string' || !file.type.trim()) {
      errors.push(issue('file_type_required', `properties.files.${index}.type`));
    }
  }
  if (metadata?.properties?.vessel) {
    warnings.push(issue('vessel_proof_marketplace_ignored', 'properties.vessel', 'warning'));
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
}

export function serializeNftMetadata(metadata) {
  const validation = validateNftMetadata(metadata);
  if (!validation.valid) {
    throw Object.assign(new Error('Invalid NFT metadata'), {
      code: 'metadata_invalid',
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }
  return `${JSON.stringify(metadata, null, 2)}\n`;
}
