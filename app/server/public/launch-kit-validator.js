const URL_PATTERN = /^(https:\/\/|ipfs:\/\/|ar:\/\/)/i;
const TARGETS = Object.freeze(['evmErc721', 'evmErc1155', 'solanaCore', 'solanaTokenMetadata', 'aptosDigitalAsset', 'opensea']);

function text(value) {
  return String(value ?? '').trim();
}

function issue(severity, code, target, message, details = {}) {
  return Object.freeze({
    severity,
    code,
    target,
    itemIndex: Number.isInteger(details.itemIndex) ? details.itemIndex : null,
    field: text(details.field),
    message,
  });
}

function validUrl(value) {
  return URL_PATTERN.test(text(value));
}

function daysUntil(epochSeconds, nowMs) {
  const value = Number(epochSeconds);
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return (value * 1000 - nowMs) / 86_400_000;
}

function markInvalid(status, target) {
  if (target === 'all') {
    for (const key of TARGETS) {
      status[key] = { valid: false, errorCount: status[key].errorCount + 1 };
    }
    return;
  }
  const key = TARGETS.includes(target) ? target : 'opensea';
  status[key] = { valid: false, errorCount: status[key].errorCount + 1 };
}

function targetStatus(errors) {
  const status = Object.fromEntries(TARGETS.map((target) => [target, { valid: true, errorCount: 0 }]));
  for (const entry of errors) markInvalid(status, entry.target);
  return Object.freeze(status);
}

export function validateLaunchKit({ collection, profile, items, nowMs = Date.now() } = {}) {
  const errors = [];
  const warnings = [];
  const notes = [
    issue('note', 'shelbynet_testnet_beta', 'all', 'ShelbyNet is a testnet beta and data can expire or be wiped.'),
    issue('note', 'vessel_does_not_mint', 'all', 'Vessel prepares launch handoff files and does not mint NFTs.'),
    issue('note', 'marketplace_cache', 'all', 'Marketplaces can cache metadata and may require refresh after changes.'),
    issue('note', 'erc4906_available', 'evmErc721', 'EVM contracts that intentionally update metadata can emit ERC-4906 events.'),
  ];
  const safeItems = Array.isArray(items) ? items : [];

  if (!collection) errors.push(issue('error', 'collection_missing', 'all', 'Select a Shelby Vault collection before export.'));
  if (safeItems.length === 0) errors.push(issue('error', 'collection_empty', 'all', 'The selected collection has no media artifacts.'));
  if (!text(profile?.collectionName)) errors.push(issue('error', 'collection_name_missing', 'all', 'Collection name is required.'));
  if (!text(profile?.description)) errors.push(issue('error', 'description_missing', 'all', 'Collection description is required.'));
  if (!validUrl(profile?.avatarImageUrl || profile?.featuredImageUrl)) {
    errors.push(issue('error', 'contract_uri_image_missing', 'opensea', 'OpenSea contractURI requires an HTTPS, IPFS, or Arweave image URL.', { field: 'avatarImageUrl' }));
  }

  const tokenIds = new Set();
  const aptosNames = new Set();
  for (const item of safeItems) {
    if (tokenIds.has(item.tokenId)) {
      errors.push(issue('error', 'token_id_collision', 'evmErc1155', `Token ID ${item.tokenId} is duplicated.`, { itemIndex: item.index, field: 'tokenId' }));
    }
    tokenIds.add(item.tokenId);
    const aptosName = text(item.displayName).toLowerCase();
    if (aptosNames.has(aptosName)) {
      errors.push(issue('error', 'aptos_token_name_collision', 'aptosDigitalAsset', `Aptos token name "${item.displayName}" is duplicated.`, { itemIndex: item.index, field: 'displayName' }));
    }
    aptosNames.add(aptosName);
    if (!validUrl(item.mediaUrl)) {
      errors.push(issue('error', 'media_url_invalid', 'all', `Media URL is missing or unsupported for ${item.sourcePath}.`, { itemIndex: item.index, field: 'mediaUrl' }));
    }
    if (!validUrl(item.tokenUri)) {
      errors.push(issue('error', 'token_uri_missing', 'all', `Hosted TokenURI metadata is required for ${item.sourcePath}.`, { itemIndex: item.index, field: 'tokenUri' }));
    }
    if (!item.attributes?.length) {
      warnings.push(issue('warning', 'attributes_missing', 'all', `${item.sourcePath} has no NFT traits.`, { itemIndex: item.index, field: 'attributes' }));
    }
    if (Number(item.sizeBytes) > 50 * 1024 * 1024) {
      warnings.push(issue('warning', 'media_large', 'all', `${item.sourcePath} is larger than 50 MB.`, { itemIndex: item.index, field: 'sizeBytes' }));
    }
  }

  if (collection?.verification === 'vault-cache') {
    warnings.push(issue('warning', 'collection_cache_only', 'all', 'This collection was reconstructed from browser-local Vault cache.'));
  }
  if (daysUntil(collection?.earliestExpiry, nowMs) < 7) {
    warnings.push(issue('warning', 'expiration_under_7_days', 'all', 'At least one Shelby artifact expires in under 7 days.'));
  }
  if (profile?.royaltyPercent === null || profile?.royaltyPercent === '' || profile?.royaltyPercent === undefined) {
    warnings.push(issue('warning', 'royalty_blank', 'solanaTokenMetadata', 'Royalty percent is blank, so seller fee basis points will be blank.'));
  } else if (Number(profile.royaltyPercent) > 10) {
    warnings.push(issue('warning', 'royalty_high', 'all', 'Royalty percent is greater than 10%.'));
  }
  if (text(profile?.description).length > 0 && text(profile?.description).length < 20) {
    warnings.push(issue('warning', 'description_short', 'all', 'Collection description is short for marketplace display.'));
  }

  return Object.freeze({
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    notes: Object.freeze(notes),
    targetStatus: targetStatus(errors),
  });
}
