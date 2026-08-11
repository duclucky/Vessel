const HTTPS_OR_DECENTRALIZED = /^(https:\/\/|ipfs:\/\/|ar:\/\/)/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const UNIX_MILLISECONDS_THRESHOLD = 100_000_000_000;

export const DEFAULT_LAUNCH_TARGETS = Object.freeze({
  evmErc721: true,
  evmErc1155: true,
  solanaCore: true,
  solanaTokenMetadata: true,
  aptosDigitalAsset: true,
});

function text(value) {
  return String(value ?? '').trim();
}

function absoluteUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  return HTTPS_OR_DECENTRALIZED.test(raw) ? raw : '';
}

function basename(value) {
  return text(value).replaceAll('\\', '/').split('/').filter(Boolean).pop() || '';
}

function withoutExtension(value) {
  return text(value).replace(/\.[^.]+$/, '');
}

function sourcePath(item) {
  return text(item?.sourcePath || item?.key || item?.path).replaceAll('\\', '/');
}

function sourceSort(left, right) {
  return collator.compare(sourcePath(left), sourcePath(right));
}

function expirationIso(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const milliseconds = timestamp > UNIX_MILLISECONDS_THRESHOLD ? timestamp : timestamp * 1000;
  return new Date(milliseconds).toISOString();
}

function manifestRowsForCollection(manifests, collection) {
  const collectionId = text(collection?.id).toLowerCase();
  const collectionName = text(collection?.name).toLowerCase();
  const found = (Array.isArray(manifests) ? manifests : []).find((manifest) => {
    const id = text(manifest?.id).toLowerCase();
    const name = text(manifest?.name).toLowerCase();
    return id === collectionId || name === collectionName;
  });
  return Array.isArray(found?.rows) ? found.rows : [];
}

function manifestRowByMediaUrl(rows) {
  const map = new Map();
  for (const row of rows) {
    const mediaUrl = text(row?.imageUrl);
    if (mediaUrl) map.set(mediaUrl, row);
  }
  return map;
}

function cleanTargets(targets) {
  return Object.freeze({
    ...DEFAULT_LAUNCH_TARGETS,
    ...(targets || {}),
  });
}

function inferDisplayName(item, index, collectionName, manifestRow) {
  const manifestName = text(manifestRow?.itemName);
  if (manifestName) return manifestName;
  const stem = withoutExtension(basename(sourcePath(item)));
  if (stem) return stem;
  return `${collectionName || 'Vessel Collection'} #${index + 1}`;
}

function inferAttributes(item, manifestRow) {
  const values = item?.attributes || item?.metadata?.attributes || manifestRow?.attributes;
  return Array.isArray(values)
    ? values.map((entry) => ({
      trait_type: text(entry?.trait_type || entry?.traitType || entry?.name),
      value: entry?.value,
      ...(entry?.display_type ? { display_type: entry.display_type } : {}),
      ...(entry?.max_value !== undefined ? { max_value: entry.max_value } : {}),
    })).filter((entry) => entry.trait_type && entry.value !== undefined)
    : [];
}

export function toErc1155Hex64(tokenId) {
  let bigint;
  try {
    bigint = BigInt(tokenId);
  } catch {
    throw new TypeError('ERC-1155 token ID must be an integer');
  }
  if (bigint < 0n) throw new TypeError('ERC-1155 token ID must be positive');
  const hex = bigint.toString(16);
  if (hex.length > 64) throw new TypeError('ERC-1155 token ID exceeds 256 bits');
  return hex.padStart(64, '0');
}

export function defaultLaunchProfile(collection, options = {}) {
  const firstImage = collection?.items?.find((item) => absoluteUrl(item?.url))?.url || '';
  return Object.freeze({
    collectionId: text(collection?.id),
    collectionName: text(collection?.name || collection?.id || 'Vessel Collection'),
    symbol: '',
    description: 'ShelbyNet beta NFT media prepared by Vessel. Storage is testnet data and can expire or be wiped.',
    creatorWallet: text(options.storageAddress || ''),
    royaltyPercent: null,
    externalLink: text(options.origin || globalThis.location?.origin || ''),
    avatarImageUrl: firstImage,
    bannerImageUrl: '',
    featuredImageUrl: firstImage,
    tokenIdStart: Number.isSafeInteger(Number(options.tokenIdStart)) ? Number(options.tokenIdStart) : 1,
    targets: cleanTargets(options.targets),
  });
}

export function buildLaunchItems(collection, manifests = [], options = {}) {
  const tokenIdStart = Number.isSafeInteger(Number(options.tokenIdStart)) ? Number(options.tokenIdStart) : 1;
  const rows = manifestRowsForCollection(manifests, collection);
  const byMediaUrl = manifestRowByMediaUrl(rows);
  const collectionName = text(collection?.name || collection?.id || 'Vessel Collection');
  return Object.freeze([...(collection?.items || [])].sort(sourceSort).map((item, index) => {
    const mediaUrl = absoluteUrl(item?.url);
    const row = byMediaUrl.get(mediaUrl);
    const tokenId = tokenIdStart + index;
    const tokenUri = absoluteUrl(item?.tokenUri || item?.metadataUrl || row?.metadataUrl);
    return Object.freeze({
      index,
      tokenId,
      tokenIdHex64: toErc1155Hex64(tokenId),
      sourcePath: sourcePath(item),
      displayName: inferDisplayName(item, index, collectionName, row),
      mediaUrl,
      tokenUri,
      metadataKey: text(item?.metadataKey || item?.sourceArtifactKey || row?.metadataPath),
      contentType: text(item?.contentType),
      sizeBytes: Number(item?.size || item?.sizeBytes || 0),
      expiresAt: expirationIso(item?.expiresAt),
      attributes: Object.freeze(inferAttributes(item, row)),
    });
  }));
}

export function buildContractUri(profile) {
  return {
    name: text(profile?.collectionName),
    description: text(profile?.description),
    image: absoluteUrl(profile?.avatarImageUrl || profile?.featuredImageUrl),
    banner_image: absoluteUrl(profile?.bannerImageUrl),
    featured_image: absoluteUrl(profile?.featuredImageUrl || profile?.avatarImageUrl),
    external_link: text(profile?.externalLink),
  };
}

export function buildErc721Rows(profile, items) {
  return items.map((item) => ({
    token_id: String(item.tokenId),
    name: item.displayName,
    token_uri: item.tokenUri,
    media_url: item.mediaUrl,
    source_path: item.sourcePath,
    metadata_status: item.tokenUri ? 'hosted' : 'missing',
    expires_at: item.expiresAt,
  }));
}

export function buildErc1155Rows(profile, items) {
  return items.map((item) => ({
    token_id_decimal: String(item.tokenId),
    token_id_hex64: item.tokenIdHex64,
    uri: item.tokenUri,
    uri_template_example: item.tokenUri ? item.tokenUri.replace(/\/[^/]*$/, '/{id}.json') : '',
    name: item.displayName,
    media_url: item.mediaUrl,
    source_path: item.sourcePath,
    metadata_status: item.tokenUri ? 'hosted' : 'missing',
    expires_at: item.expiresAt,
  }));
}

export function buildSolanaCoreRows(profile, items) {
  return items.map((item) => ({
    asset_name: item.displayName,
    collection_name: text(profile?.collectionName),
    uri: item.tokenUri,
    image: item.mediaUrl,
    category: item.contentType.startsWith('video/') ? 'video' : 'image',
    external_url: text(profile?.externalLink),
    royalty_percent: profile?.royaltyPercent ?? '',
    source_path: item.sourcePath,
    expires_at: item.expiresAt,
  }));
}

export function buildSolanaTokenMetadataRows(profile, items) {
  const royalty = profile?.royaltyPercent;
  const basisPoints = Number.isFinite(Number(royalty)) ? String(Math.round(Number(royalty) * 100)) : '';
  return items.map((item) => ({
    name: item.displayName,
    symbol: text(profile?.symbol),
    uri: item.tokenUri,
    seller_fee_basis_points: basisPoints,
    collection_name: text(profile?.collectionName),
    image: item.mediaUrl,
    source_path: item.sourcePath,
    expires_at: item.expiresAt,
  }));
}

export function buildAptosDigitalAssetRows(profile, items) {
  return items.map((item) => ({
    collection_name: text(profile?.collectionName),
    collection_description: text(profile?.description),
    collection_uri: absoluteUrl(profile?.featuredImageUrl || profile?.avatarImageUrl),
    token_name: item.displayName,
    token_description: `${item.displayName} media hosted on ShelbyNet beta through Vessel.`,
    token_uri: item.tokenUri,
    creator_wallet: text(profile?.creatorWallet),
    source_path: item.sourcePath,
    expires_at: item.expiresAt,
  }));
}

export function rowsToCsv(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = [...safeRows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set())];
  const encode = (value) => {
    const raw = String(value ?? '');
    return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  };
  return [
    headers.map(encode).join(','),
    ...safeRows.map((row) => headers.map((header) => encode(row?.[header])).join(',')),
  ].join('\r\n') + '\r\n';
}

export function hasSupportedMediaExtension(item) {
  return IMAGE_EXTENSION.test(sourcePath(item)) || String(item?.contentType || '').startsWith('image/');
}
