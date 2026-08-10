import { buildStoredZip, buildStyledWorkbook, buildStyledWorkbookBytes } from './metadata-export.js';
import {
  buildAptosDigitalAssetRows,
  buildContractUri,
  buildErc1155Rows,
  buildErc721Rows,
  buildSolanaCoreRows,
  buildSolanaTokenMetadataRows,
  rowsToCsv,
} from './launch-kit.js';

function slug(value) {
  return String(value || 'vessel')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'vessel';
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validationRows(validation) {
  return [
    ['Severity', 'Target', 'Code', 'Item', 'Field', 'Message'],
    ...['errors', 'warnings', 'notes'].flatMap((kind) => (validation?.[kind] || []).map((issue) => [
      issue.severity,
      issue.target,
      issue.code,
      issue.itemIndex === null ? '' : String(issue.itemIndex + 1),
      issue.field,
      issue.message,
    ])),
  ];
}

function checklist(profile, collection, validation) {
  const errorCount = validation?.errors?.length || 0;
  const warningCount = validation?.warnings?.length || 0;
  return [
    `# ${profile.collectionName} Launch Checklist`,
    '',
    'Vessel prepares NFT launch handoff files. It does not mint NFTs or deploy contracts.',
    '',
    `- Collection: ${profile.collectionName}`,
    `- Items: ${collection?.itemCount || 0}`,
    '- Runtime: ShelbyNet testnet beta',
    `- Validation errors: ${errorCount}`,
    `- Validation warnings: ${warningCount}`,
    '',
    '## Before minting',
    '',
    '- Confirm every TokenURI opens in a browser.',
    '- Confirm every metadata JSON contains an image or animation URL that opens in a browser.',
    '- Confirm ShelbyNet testnet retention is acceptable for the demo.',
    '- Use ERC-721 tokenURI rows for ERC-721 contracts.',
    '- Use ERC-1155 hex rows when a contract uses {id}.json URI substitution.',
    '- Use Solana rows as a developer handoff for Metaplex Core or Token Metadata.',
    '- Use Aptos rows as a developer handoff for Aptos Digital Asset collection and token creation.',
    '',
  ].join('\n');
}

export function launchPackageFileName(profile) {
  return `${slug(profile?.collectionName)}-launch-kit.zip`;
}

export function buildLaunchOutputs(profile, items, validation, options = {}) {
  const collection = options.collection || {};
  const contractUri = buildContractUri(profile);
  const erc721Rows = buildErc721Rows(profile, items);
  const erc1155Rows = buildErc1155Rows(profile, items);
  const solanaCoreRows = buildSolanaCoreRows(profile, items);
  const solanaTokenMetadataRows = buildSolanaTokenMetadataRows(profile, items);
  const aptosRows = buildAptosDigitalAssetRows(profile, items);
  const reportRows = validationRows(validation);
  const manifest = {
    version: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    vesselOrigin: String(options.vesselOrigin || globalThis.location?.origin || ''),
    storageRuntime: options.storageRuntime || 'shelbynet',
    storageAddress: String(options.storageAddress || ''),
    collection: {
      id: String(collection.id || profile.collectionId || ''),
      name: String(profile.collectionName || collection.name || ''),
      symbol: String(profile.symbol || ''),
      description: String(profile.description || ''),
      itemCount: items.length,
      earliestExpiry: collection.earliestExpiry ? new Date(Number(collection.earliestExpiry) * 1000).toISOString() : '',
      verification: collection.verification === 'vault-cache' ? 'vault-cache' : 'shelby',
    },
    targets: Object.entries(profile.targets || {}).filter(([, enabled]) => enabled).map(([key]) => key),
    outputs: [
      { kind: 'opensea-contract-uri', path: 'opensea/contractURI.json', valid: validation?.targetStatus?.opensea?.valid !== false },
      { kind: 'evm-erc721', path: 'evm/erc721-tokenuris.csv', rowCount: erc721Rows.length, valid: validation?.targetStatus?.evmErc721?.valid !== false },
      { kind: 'evm-erc1155', path: 'evm/erc1155-tokenuris.csv', rowCount: erc1155Rows.length, valid: validation?.targetStatus?.evmErc1155?.valid !== false },
      { kind: 'solana-core', path: 'solana/metaplex-core-assets.csv', rowCount: solanaCoreRows.length, valid: validation?.targetStatus?.solanaCore?.valid !== false },
      { kind: 'solana-token-metadata', path: 'solana/token-metadata-assets.csv', rowCount: solanaTokenMetadataRows.length, valid: validation?.targetStatus?.solanaTokenMetadata?.valid !== false },
      { kind: 'aptos-digital-asset', path: 'aptos/digital-asset-tokens.csv', rowCount: aptosRows.length, valid: validation?.targetStatus?.aptosDigitalAsset?.valid !== false },
      { kind: 'validation-report', path: 'validation-report.xlsx', rowCount: reportRows.length - 1, valid: true },
    ],
  };
  const validationWorkbook = buildStyledWorkbook(reportRows, { name: 'Launch Validation' });
  const entries = [
    { path: 'vessel-launch-kit/manifest.json', content: json(manifest) },
    { path: 'vessel-launch-kit/launch-checklist.md', content: checklist(profile, collection, validation) },
    { path: 'vessel-launch-kit/validation-report.xlsx', content: buildStyledWorkbookBytes(reportRows, { name: 'Launch Validation' }) },
    { path: 'vessel-launch-kit/opensea/contractURI.json', content: json(contractUri) },
    { path: 'vessel-launch-kit/evm/erc721-tokenuris.csv', content: rowsToCsv(erc721Rows) },
    { path: 'vessel-launch-kit/evm/erc1155-tokenuris.csv', content: rowsToCsv(erc1155Rows) },
    { path: 'vessel-launch-kit/solana/metaplex-core-assets.csv', content: rowsToCsv(solanaCoreRows) },
    { path: 'vessel-launch-kit/solana/token-metadata-assets.csv', content: rowsToCsv(solanaTokenMetadataRows) },
    { path: 'vessel-launch-kit/aptos/digital-asset-tokens.csv', content: rowsToCsv(aptosRows) },
  ];
  return Object.freeze({
    manifest,
    contractUri,
    rows: Object.freeze({ erc721Rows, erc1155Rows, solanaCoreRows, solanaTokenMetadataRows, aptosRows }),
    entries: Object.freeze(entries),
    validationWorkbook,
    zip: buildStoredZip(entries),
  });
}
