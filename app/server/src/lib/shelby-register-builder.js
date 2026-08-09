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
  const payload = ShelbyBlobClient.createRegisterBlobPayload({
    account: context.storageAddress,
    blobName: context.blobName,
    blobSize: context.sizeBytes,
    blobMerkleRoot,
    numChunksets: expectedTotalChunksets(context.sizeBytes),
    expirationMicros: context.expirationMicros,
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
  });
}
