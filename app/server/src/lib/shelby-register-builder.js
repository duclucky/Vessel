import {
  expectedTotalChunksets,
  ShelbyBlobClient,
} from '@shelby-protocol/sdk/node';

const ROOT = /^(?:0x)?[0-9a-f]{64}$/i;

const registerError = (message, code) => Object.assign(
  new Error(message),
  { code, status: 400, retriable: false },
);

export async function buildSponsoredRegisterTransaction({
  shelbyClient,
  gasStationAccount,
  signedQuote,
  blobMerkleRoot,
  maxGasAmount,
}) {
  const context = signedQuote?.context;
  if (!context?.storageAddress || !gasStationAccount) {
    throw registerError('Sponsored Shelby registration is not configured', 'sponsor_unavailable');
  }
  if (!ROOT.test(String(blobMerkleRoot || ''))) {
    throw registerError('Invalid Shelby blob commitment', 'invalid_blob_commitment');
  }
  const paymentTier = Number(signedQuote?.breakdown?.tierId);
  if (!Number.isSafeInteger(paymentTier) || paymentTier < 0) {
    throw registerError('Invalid Shelby payment tier', 'invalid_payment_tier');
  }
  const sponsoredGasLimit = Number(maxGasAmount);
  if (!Number.isSafeInteger(sponsoredGasLimit) || sponsoredGasLimit < 28) {
    throw registerError('Invalid sponsored gas limit', 'invalid_sponsored_gas_limit');
  }
  const payload = ShelbyBlobClient.createRegisterBlobPayload({
    account: context.storageAddress,
    blobName: context.blobName,
    blobSize: context.sizeBytes,
    blobMerkleRoot,
    numChunksets: expectedTotalChunksets(context.sizeBytes),
    expirationMicros: context.expirationMicros,
    selectedLocation: 'shelbynet-1',
    useSponsoredUsdVariant: true,
    encoding: context.encoding,
  });
  if (!Array.isArray(payload.functionArguments) || payload.functionArguments.length !== 10) {
    throw registerError('Unexpected Shelby register payload shape', 'invalid_register_payload');
  }
  return shelbyClient.aptos.transaction.build.multiAgent({
    sender: context.storageAddress,
    data: payload,
    secondarySignerAddresses: [gasStationAccount],
    withFeePayer: true,
    options: { maxGasAmount: sponsoredGasLimit },
  });
}

export async function buildDirectRegisterTransaction({
  shelbyClient,
  signedQuote,
  blobMerkleRoot,
  maxGasAmount,
}) {
  const context = signedQuote?.context;
  if (!context?.storageAddress) {
    throw registerError('Shelby DAA registration is not configured', 'daa_unavailable');
  }
  if (!ROOT.test(String(blobMerkleRoot || ''))) {
    throw registerError('Invalid Shelby blob commitment', 'invalid_blob_commitment');
  }
  const paymentTier = Number(signedQuote?.breakdown?.tierId);
  if (!Number.isSafeInteger(paymentTier) || paymentTier < 0) {
    throw registerError('Invalid Shelby payment tier', 'invalid_payment_tier');
  }
  const gasLimit = Number(maxGasAmount);
  if (!Number.isSafeInteger(gasLimit) || gasLimit < 28) {
    throw registerError('Invalid Shelby gas limit', 'invalid_sponsored_gas_limit');
  }
  const payload = ShelbyBlobClient.createRegisterBlobPayload({
    account: context.storageAddress,
    blobName: context.blobName,
    blobSize: context.sizeBytes,
    blobMerkleRoot,
    numChunksets: expectedTotalChunksets(context.sizeBytes),
    expirationMicros: context.expirationMicros,
    selectedLocation: 'shelbynet-1',
    useSponsoredUsdVariant: false,
    encoding: context.encoding,
  });
  if (!Array.isArray(payload.functionArguments) || payload.functionArguments.length !== 10) {
    throw registerError('Unexpected Shelby register payload shape', 'invalid_register_payload');
  }
  return shelbyClient.aptos.transaction.build.simple({
    sender: context.storageAddress,
    data: payload,
    options: { maxGasAmount: gasLimit },
  });
}
