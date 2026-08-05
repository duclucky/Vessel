import {
  createNftMetadata,
  serializeNftMetadata,
  validateNftMetadata,
} from './metadata-schema.js';
import {
  formatItemName,
  metadataOutputPathForNumber,
} from './metadata-template-presets.js';
import {
  mergeTraitMaxValues,
  normalizeCsvTraitValue,
  parseCsvTraitColumn,
} from './metadata-traits.js';

export const METADATA_BATCH_MAX_BYTES = 1024 * 1024 * 1024;
export const METADATA_BATCH_MAX_ITEMS = 3000;

const IMAGE_EXTENSIONS = new Map([
  ['avif', 'image/avif'],
  ['gif', 'image/gif'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['svg', 'image/svg+xml'],
  ['webp', 'image/webp'],
]);

export class MetadataBatchError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'MetadataBatchError';
    this.code = code;
    Object.assign(this, details);
  }
}

function pathFor(file) {
  const raw = String(file?.vesselRelativePath || file?.webkitRelativePath || file?.name || '')
    .replaceAll('\\', '/');
  const safe = raw.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
  if (safe.length > 1) safe.shift();
  return safe.join('/');
}

function extensionOf(path) {
  const name = path.split('/').pop() || '';
  const position = name.lastIndexOf('.');
  return position > 0 ? name.slice(position + 1).toLowerCase() : '';
}

function withoutExtension(path) {
  const position = path.lastIndexOf('.');
  return position > path.lastIndexOf('/') ? path.slice(0, position) : path;
}

function normalizedStem(path) {
  return withoutExtension(path)
    .replace(/^(?:images|metadata)\//i, '')
    .toLowerCase();
}

function warning(code, path, message) {
  return Object.freeze({ code, path, message });
}

function isHidden(path) {
  return path.split('/').some((segment) => segment.startsWith('.'));
}

function comparePath(left, right) {
  const a = left.relativePath.toLowerCase();
  const b = right.relativePath.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

export function indexMetadataFolder(files, {
  maxBytes = METADATA_BATCH_MAX_BYTES,
  maxItems = METADATA_BATCH_MAX_ITEMS,
} = {}) {
  const images = [];
  const jsonByStem = new Map();
  const warnings = [];
  const imagePaths = new Set();

  for (const file of [...(files || [])]) {
    const relativePath = pathFor(file);
    if (!relativePath || isHidden(relativePath)) {
      warnings.push(warning('hidden_file_skipped', relativePath || String(file?.name || ''), 'Hidden file skipped'));
      continue;
    }
    if (!Number.isFinite(file?.size) || file.size <= 0) {
      warnings.push(warning('empty_file_skipped', relativePath, 'Empty file skipped'));
      continue;
    }
    const extension = extensionOf(relativePath);
    if (IMAGE_EXTENSIONS.has(extension) || String(file.type || '').toLowerCase().startsWith('image/')) {
      const normalizedPath = relativePath.toLowerCase();
      if (imagePaths.has(normalizedPath)) {
        throw new MetadataBatchError('Duplicate normalized image path', 'metadata_image_duplicate', { path: relativePath });
      }
      imagePaths.add(normalizedPath);
      images.push(Object.freeze({
        file,
        relativePath,
        stem: normalizedStem(relativePath),
        outputStem: withoutExtension(relativePath).replace(/^images\//i, ''),
        mimeType: String(file.type || '').toLowerCase() || IMAGE_EXTENSIONS.get(extension) || 'image/png',
      }));
      continue;
    }
    if (extension === 'json') {
      const stem = normalizedStem(relativePath);
      if (jsonByStem.has(stem)) {
        throw new MetadataBatchError('Duplicate matching JSON stem', 'metadata_json_duplicate', { path: relativePath });
      }
      jsonByStem.set(stem, Object.freeze({ file, relativePath, stem }));
      continue;
    }
    warnings.push(warning('unsupported_file_skipped', relativePath, 'Unsupported file skipped'));
  }

  images.sort(comparePath);
  if (!images.length) throw new MetadataBatchError('No supported images were selected', 'metadata_batch_empty');
  if (images.length > maxItems) {
    throw new MetadataBatchError('Collection exceeds the 3,000-image beta limit', 'metadata_batch_too_many_items', {
      itemCount: images.length,
      limit: maxItems,
    });
  }
  const totalBytes = images.reduce((sum, item) => sum + Number(item.file.size), 0);
  if (totalBytes > maxBytes) {
    throw new MetadataBatchError('Collection exceeds the 1 GB beta limit', 'metadata_batch_too_large', {
      totalBytes,
      limitBytes: maxBytes,
    });
  }

  return Object.freeze({ images: Object.freeze(images), jsonByStem, warnings, totalBytes });
}

function parseCsvMatrix(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const source = String(text || '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"' && value === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (quoted) throw new MetadataBatchError('CSV contains an unterminated quoted field', 'csv_quote_unterminated');
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ''));
}

function csvLookup(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

export function parseMetadataCsv(text) {
  const matrix = parseCsvMatrix(text);
  if (!matrix.length) throw new MetadataBatchError('CSV is empty', 'csv_empty');
  const headers = matrix[0].map((header) => header.trim());
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  const filenameIndex = normalizedHeaders.indexOf('filename');
  if (filenameIndex < 0) {
    throw new MetadataBatchError('CSV requires a filename column', 'csv_filename_required');
  }
  const seen = new Set();
  const rows = [];
  for (const [offset, values] of matrix.slice(1).entries()) {
    if (values.length > headers.length) {
      throw new MetadataBatchError('CSV row has more values than headers', 'csv_row_too_wide', { row: offset + 2 });
    }
    while (values.length < headers.length) values.push('');
    const filename = values[filenameIndex].trim();
    if (!filename) throw new MetadataBatchError('CSV row requires a filename', 'csv_filename_required', { row: offset + 2 });
    const key = csvLookup(filename);
    if (seen.has(key)) throw new MetadataBatchError('CSV contains a duplicate filename', 'csv_filename_duplicate', { filename });
    seen.add(key);
    const row = {
      filename,
      name: '',
      description: '',
      external_url: '',
      background_color: '',
      animation_url: '',
      attributes: [],
    };
    const maxColumns = new Map();
    for (let index = 0; index < headers.length; index += 1) {
      const header = normalizedHeaders[index];
      const originalHeader = headers[index];
      const cell = values[index].trim();
      if (['name', 'description', 'external_url', 'background_color', 'animation_url'].includes(header)) {
        row[header] = cell;
      }
      const traitColumn = parseCsvTraitColumn(originalHeader);
      if (traitColumn?.max) {
        const numericMax = Number(cell);
        if (cell !== '' && Number.isFinite(numericMax)) {
          maxColumns.set(traitColumn.trait_type.toLowerCase(), numericMax);
        }
        continue;
      }
      const attribute = normalizeCsvTraitValue(traitColumn, cell);
      if (attribute) row.attributes.push(attribute);
    }
    row.attributes = mergeTraitMaxValues(row.attributes, maxColumns);
    rows.push(row);
  }
  return rows;
}

function nonBlank(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function mergeAttributes(...groups) {
  const merged = [];
  const positions = new Map();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const attribute of group) {
      const traitType = String(attribute?.trait_type || '').trim();
      if (!traitType) {
        merged.push({ ...attribute, trait_type: '', value: attribute?.value });
        continue;
      }
      const next = { ...attribute, trait_type: traitType, value: attribute?.value };
      const key = traitType.toLowerCase();
      if (positions.has(key)) merged[positions.get(key)] = next;
      else {
        positions.set(key, merged.length);
        merged.push(next);
      }
    }
  }
  return merged;
}

function csvRowFor(image, rows) {
  const relative = csvLookup(image.relativePath);
  const basename = relative.split('/').pop();
  return rows.find((row) => {
    const key = csvLookup(row.filename);
    return key === relative || key === basename;
  }) || null;
}

function itemIssue(code, path, message) {
  return Object.freeze({ code, path, message });
}

export async function buildMetadataBatch({ files, csvRows = [], defaults = {}, uriForImage } = {}) {
  if (typeof uriForImage !== 'function') throw new TypeError('uriForImage is required');
  const indexed = indexMetadataFolder(files);
  const startNumber = Number.isSafeInteger(Number(defaults.startNumber)) && Number(defaults.startNumber) >= 0
    ? Number(defaults.startNumber)
    : 1;
  const outputPaths = new Set();
  for (const [index] of indexed.images.entries()) {
    const outputPath = metadataOutputPathForNumber(startNumber + index).toLowerCase();
    if (outputPaths.has(outputPath)) {
      throw new MetadataBatchError('Multiple images map to the same metadata output', 'metadata_output_duplicate', {
        outputPath,
      });
    }
    outputPaths.add(outputPath);
  }

  const warnings = [...indexed.warnings];
  const matchedJson = new Set();
  const matchedCsv = new Set();
  const items = [];
  const errors = [];
  for (const [index, image] of indexed.images.entries()) {
    const itemErrors = [];
    const jsonMatch = indexed.jsonByStem.get(image.stem);
    let imported = {};
    if (jsonMatch) {
      matchedJson.add(image.stem);
      try {
        imported = JSON.parse(await jsonMatch.file.text());
        if (!imported || Array.isArray(imported) || typeof imported !== 'object') throw new TypeError('JSON root must be an object');
      } catch (error) {
        itemErrors.push(itemIssue('json_malformed', jsonMatch.relativePath, String(error?.message || error)));
        imported = {};
      }
    }
    const csv = csvRowFor(image, csvRows);
    if (csv) matchedCsv.add(csvLookup(csv.filename));
    let imageUri = '';
    try {
      imageUri = await uriForImage(image.file, image.relativePath, image);
    } catch (error) {
      itemErrors.push(itemIssue('image_uri_generation_failed', image.relativePath, String(error?.message || error)));
    }
    const tokenNumber = startNumber + index;
    const collectionName = String(defaults.collectionName || defaults.namePrefix || '').trim();
    const itemNamePattern = String(defaults.itemNamePattern || '<Collection Name> #<Number>');
    const generatedName = collectionName ? formatItemName(itemNamePattern, collectionName, tokenNumber) : '';
    const metadata = createNftMetadata({
      preset: defaults.preset || 'marketplace',
      name: nonBlank(csv?.name, imported.name, generatedName),
      description: nonBlank(csv?.description, imported.description, String(defaults.description || '')),
      image: imageUri,
      externalUrl: nonBlank(csv?.external_url, imported.external_url, String(defaults.externalUrl || '')),
      animationUrl: nonBlank(csv?.animation_url, imported.animation_url, String(defaults.animationUrl || '')),
      backgroundColor: nonBlank(csv?.background_color, imported.background_color, String(defaults.backgroundColor || '')),
      attributes: mergeAttributes(defaults.attributes, imported.attributes, csv?.attributes),
      mimeType: image.mimeType,
      animationMimeType: String(defaults.animationMimeType || 'application/octet-stream'),
      category: defaults.category,
    });
    const validation = validateNftMetadata(metadata);
    itemErrors.push(...validation.errors.map((entry) => itemIssue(entry.code, entry.field, entry.code)));
    const outputPath = metadataOutputPathForNumber(tokenNumber);
    const status = itemErrors.length ? 'invalid' : 'valid';
    const item = Object.freeze({
      id: `metadata-${index}-${image.stem}`,
      sourcePath: image.relativePath,
      outputPath,
      file: image.file,
      metadata,
      serialized: status === 'valid' ? serializeNftMetadata(metadata) : '',
      status,
      errors: Object.freeze(itemErrors),
      warnings: Object.freeze([]),
    });
    items.push(item);
    errors.push(...itemErrors.map((entry) => Object.freeze({ ...entry, itemId: item.id })));
  }

  for (const [stem, entry] of indexed.jsonByStem) {
    if (!matchedJson.has(stem)) warnings.push(warning('json_unmatched', entry.relativePath, 'JSON file has no matching image'));
  }
  for (const row of csvRows) {
    if (!matchedCsv.has(csvLookup(row.filename))) warnings.push(warning('csv_unmatched', row.filename, 'CSV row has no matching image'));
  }

  return Object.freeze({
    items: Object.freeze(items),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    totalBytes: indexed.totalBytes,
  });
}
