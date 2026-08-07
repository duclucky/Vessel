export const DEFAULT_SHELBY_DEPLOYER = '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a';
export const DEFAULT_SHELBY_LOCATION = 'shelbynet-1';
const HEX_32 = /^(?:0x)?[0-9a-f]{64}$/i;

function hexToBytes32(value) {
  const hex = String(value || '').replace(/^0x/i, '');
  if (!HEX_32.test(hex)) {
    throw new Error('blobMerkleRoot must be a 32-byte hex string');
  }
  return Uint8Array.from(hex.match(/../g).map((byte) => parseInt(byte, 16)));
}

function encryptionToMoveEnumIndex(encryption = 'Unencrypted') {
  if (typeof encryption === 'number') return encryption;
  if (encryption === 'Unencrypted') return 0;
  throw new Error(`Unsupported Shelby blob encryption mode: ${encryption}`);
}

export function createShelbyRegisterBlobPayload({
  deployer = DEFAULT_SHELBY_DEPLOYER,
  blobName,
  selectedLocation = DEFAULT_SHELBY_LOCATION,
  locationHint = null,
  expirationMicros,
  blobMerkleRoot,
  numChunksets,
  blobSize,
  paymentTier = 0,
  encoding = 0,
  encryption = 'Unencrypted',
  useSponsoredUsdVariant = false,
}) {
  const functionName = useSponsoredUsdVariant
    ? 'register_blob_with_sponsor'
    : 'register_blob';
  return {
    function: `${deployer}::blob_metadata::${functionName}`,
    functionArguments: [
      blobName,
      selectedLocation,
      locationHint,
      expirationMicros,
      hexToBytes32(blobMerkleRoot),
      numChunksets,
      blobSize,
      paymentTier,
      encoding,
      encryptionToMoveEnumIndex(encryption),
    ],
  };
}
