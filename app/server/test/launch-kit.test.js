import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAptosDigitalAssetRows,
  buildContractUri,
  buildErc1155Rows,
  buildErc721Rows,
  buildLaunchItems,
  buildSolanaCoreRows,
  buildSolanaTokenMetadataRows,
  defaultLaunchProfile,
  rowsToCsv,
  toErc1155Hex64,
} from '../public/launch-kit.js';

function collectionFixture() {
  return {
    id: 'genesis',
    name: 'Genesis',
    itemCount: 2,
    totalBytes: 3000,
    earliestExpiry: 1_786_000_000,
    verification: 'shelby',
    items: [
      {
        key: 'media/genesis/alpha.png',
        url: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.png',
        sourcePath: 'Genesis/alpha.png',
        contentType: 'image/png',
        size: 1000,
        expiresAt: 1_786_000_000,
        metadataUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.json',
      },
      {
        key: 'media/genesis/beta.svg',
        url: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/beta.svg',
        sourcePath: 'Genesis/beta.svg',
        contentType: 'image/svg+xml',
        size: 2000,
        expiresAt: 1_786_000_000,
        tokenUri: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/beta.json',
      },
    ],
  };
}

function manifestFixture() {
  return [{
    id: 'genesis',
    name: 'Genesis',
    rows: [
      {
        itemName: 'Genesis #1',
        sourcePath: 'Genesis/alpha.png',
        imageUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.png',
        metadataPath: 'metadata/alpha.json',
        metadataUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.json',
      },
      {
        itemName: 'Genesis #2',
        sourcePath: 'Genesis/beta.svg',
        imageUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/beta.svg',
        metadataPath: 'metadata/beta.json',
        metadataUrl: 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/beta.json',
      },
    ],
  }];
}

test('ERC-1155 token IDs are lowercase 64-character hex strings', () => {
  assert.equal(
    toErc1155Hex64(255),
    '00000000000000000000000000000000000000000000000000000000000000ff',
  );
});

test('launch items preserve folder filenames and hosted TokenURI relationships', () => {
  const items = buildLaunchItems(collectionFixture(), manifestFixture(), { tokenIdStart: 7 });
  assert.equal(items.length, 2);
  assert.equal(items[0].tokenId, 7);
  assert.equal(items[0].displayName, 'Genesis #1');
  assert.equal(items[0].sourcePath, 'Genesis/alpha.png');
  assert.equal(items[0].mediaUrl, 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.png');
  assert.equal(items[0].tokenUri, 'https://vessel-sage.vercel.app/api/shelby/blobs/0xabc/media/genesis/alpha.json');
  assert.equal(items[1].displayName, 'Genesis #2');
});

test('chain output generators create expected handoff rows', () => {
  const collection = collectionFixture();
  const profile = {
    ...defaultLaunchProfile(collection, { storageAddress: '0xabc' }),
    collectionName: 'Genesis',
    symbol: 'GEN',
    description: 'A Shelby-hosted beta NFT media collection.',
    creatorWallet: '0xabc',
    royaltyPercent: 5,
    externalLink: 'https://vessel-sage.vercel.app',
    avatarImageUrl: collection.items[0].url,
    bannerImageUrl: collection.items[1].url,
    featuredImageUrl: collection.items[0].url,
  };
  const items = buildLaunchItems(collection, manifestFixture(), { tokenIdStart: 1 });

  assert.deepEqual(buildContractUri(profile), {
    name: 'Genesis',
    description: 'A Shelby-hosted beta NFT media collection.',
    image: collection.items[0].url,
    banner_image: collection.items[1].url,
    featured_image: collection.items[0].url,
    external_link: 'https://vessel-sage.vercel.app',
  });
  assert.equal(buildErc721Rows(profile, items)[0].token_id, '1');
  assert.equal(buildErc1155Rows(profile, items)[0].token_id_hex64.endsWith('01'), true);
  assert.equal(buildSolanaCoreRows(profile, items)[0].asset_name, 'Genesis #1');
  assert.equal(buildSolanaTokenMetadataRows(profile, items)[0].seller_fee_basis_points, '500');
  assert.equal(buildAptosDigitalAssetRows(profile, items)[0].collection_name, 'Genesis');
});

test('rowsToCsv quotes commas and line breaks', () => {
  const csv = rowsToCsv([{ name: 'Genesis, One', description: 'Line 1\nLine 2' }]);
  assert.equal(csv, 'name,description\r\n"Genesis, One","Line 1\nLine 2"\r\n');
});
