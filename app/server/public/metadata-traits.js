const NUMERIC_DISPLAY_TYPES = new Set(['number', 'date', 'boost_number', 'boost_percentage']);

function clean(value) {
  return String(value ?? '').trim();
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = clean(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function normalizeTrait(input = {}) {
  const traitType = clean(input.trait_type);
  const displayType = clean(input.display_type);
  const generic = Boolean(input.generic) || (!traitType && !displayType);
  const rawValue = input.value;
  if (rawValue == null || clean(rawValue) === '') return null;

  if (generic) return Object.freeze({ value: clean(rawValue) });

  if (!traitType) {
    return Object.freeze({ trait_type: '', value: rawValue });
  }

  if (!displayType) {
    return Object.freeze({ trait_type: traitType, value: typeof rawValue === 'number' ? rawValue : clean(rawValue) });
  }

  const number = finiteNumber(rawValue);
  const output = {
    display_type: displayType,
    trait_type: traitType,
    value: NUMERIC_DISPLAY_TYPES.has(displayType) ? number : clean(rawValue),
  };
  if (input.max_value != null && clean(input.max_value) !== '') output.max_value = finiteNumber(input.max_value);
  return Object.freeze(output);
}

export function parseCsvTraitColumn(header) {
  const source = clean(header);
  const parts = source.split(':').map(clean);
  const [kind, ...rest] = parts;
  if (!['trait', 'number', 'date', 'boost_number', 'boost_percentage'].includes(kind)) return null;
  const max = rest.at(-1)?.toLowerCase() === 'max';
  const traitParts = max ? rest.slice(0, -1) : rest;
  const traitType = traitParts.join(':').trim();
  if (!traitType) return null;
  return Object.freeze({
    kind: kind === 'trait' ? 'text' : kind,
    trait_type: traitType,
    max,
  });
}

export function normalizeCsvTraitValue(column, rawValue) {
  if (!column || column.max) return null;
  const value = clean(rawValue);
  if (!value) return null;
  const displayType = column.kind === 'text' ? '' : column.kind;
  return normalizeTrait({
    trait_type: column.trait_type,
    display_type: displayType,
    value,
  });
}

export function mergeTraitMaxValues(traits, maxColumns = new Map()) {
  return traits.map((trait) => {
    const key = String(trait.trait_type || '').toLowerCase();
    if (!key || !maxColumns.has(key)) return trait;
    return Object.freeze({ ...trait, max_value: maxColumns.get(key) });
  });
}
