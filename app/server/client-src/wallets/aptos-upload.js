import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import {
  ShelbyBlobClient,
  ShelbyClient,
  SHELBYUSD_FA_METADATA_ADDRESS,
  createDefaultErasureCodingProvider,
  expectedTotalChunksets,
  generateCommitments,
} from '@shelby-protocol/sdk/browser';
import { extractShelbyTransactionEvidence } from './transaction-evidence.js';

const nativeError = (message, code) => Object.assign(new Error(message), { code });
const sha256 = (data) => crypto.subtle.digest('SHA-256', data);

function defaultDeps() {
  const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
  const shelby = new ShelbyClient({ network: Network.TESTNET });
  return {
    aptos,
    shelby,
    shelbyUsdAsset: SHELBYUSD_FA_METADATA_ADDRESS,
    createProvider: createDefaultErasureCodingProvider,
    generateCommitments,
    expectedTotalChunksets,
    createRegisterPayload: (args) => ShelbyBlobClient.createRegisterBlobPayload(args),
    now: () => Date.now(),
    digest: sha256,
  };
}

export async function readNativeBalances(address, deps = defaultDeps()) {
  const [aptOctas, rows] = await Promise.all([
    deps.aptos.getAccountAPTAmount({ accountAddress: address }),
    deps.aptos.getCurrentFungibleAssetBalances({
      options: {
        where: {
          owner_address: { _eq: address },
          asset_type: { _eq: deps.shelbyUsdAsset },
        },
      },
    }),
  ]);
  return {
    aptOctas: Number(aptOctas || 0),
    shelbyUsdUnits: Number(rows?.[0]?.amount || 0),
  };
}

export function assertNativeBalances({ aptOctas, shelbyUsdUnits }) {
  if (aptOctas <= 0) {
    throw nativeError('APT is required for Aptos transaction gas', 'insufficient_apt');
  }
  if (shelbyUsdUnits <= 0) {
    throw nativeError('ShelbyUSD is required for storage', 'insufficient_shelby_usd');
  }
}

function contentAddressedName(file, sha) {
  const parts = String(file.name || '').split('.');
  const rawExtension = parts.length > 1 ? parts.pop() : 'bin';
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `media/${sha}.${extension}`;
}

export async function uploadNativeAptos(file, {
  session,
  adapter,
  expirationMicros,
  expectedFileHash,
  quoteToken,
  paidAuthorization,
  paymentTier,
  uploadContext,
  onStep,
  deps = defaultDeps(),
}) {
  if (session?.chain && (session.chain !== 'aptos' || session.mode !== 'native')) {
    throw nativeError('A native Aptos session is required', 'invalid_session');
  }
  if (!session?.sourceAddress || session.sourceAddress !== session.storageAddress) {
    throw nativeError('Aptos wallet and storage addresses must match', 'invalid_session');
  }

  assertNativeBalances(await readNativeBalances(session.sourceAddress, deps));
  const blobData = new Uint8Array(await file.arrayBuffer());
  const computedDigest = new Uint8Array(await (deps.digest || sha256)(blobData));
  const computedHash = [...computedDigest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const expected = String(expectedFileHash || '').toLowerCase();
  let hashDifference = computedHash.length ^ expected.length;
  const comparisonLength = Math.max(computedHash.length, expected.length);
  for (let index = 0; index < comparisonLength; index += 1) {
    hashDifference |= (computedHash.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  if (hashDifference !== 0) {
    throw nativeError('The selected file changed after quoting', 'file_changed');
  }
  if (!Number.isSafeInteger(expirationMicros) || expirationMicros <= 0) {
    throw nativeError('A quoted expiration is required', 'invalid_quote_context');
  }
  const blobName = contentAddressedName(file, computedHash);
  if (
    !Number.isSafeInteger(paymentTier)
    || paymentTier < 0
    || !quoteToken
    || !paidAuthorization
    || uploadContext?.chain !== 'aptos'
    || String(uploadContext.sourceAddress).toLowerCase() !== String(session.sourceAddress).toLowerCase()
    || String(uploadContext.storageAddress).toLowerCase() !== String(session.storageAddress).toLowerCase()
    || uploadContext.fileHash !== expected
    || uploadContext.blobName !== blobName
    || uploadContext.expirationMicros !== expirationMicros
    || Number(uploadContext.sizeBytes) !== Number(file.size)
  ) {
    throw nativeError('A paid quote authorization is required', 'invalid_paid_authorization');
  }
  const provider = await deps.createProvider();

  onStep?.('encoding');
  const commitments = await deps.generateCommitments(provider, blobData);
  const chunksetSize = provider.config.chunkSizeBytes * provider.config.erasure_k;
  const payload = deps.createRegisterPayload({
    account: session.storageAddress,
    blobName,
    blobMerkleRoot: commitments.blob_merkle_root,
    numChunksets: deps.expectedTotalChunksets(commitments.raw_data_size, chunksetSize),
    expirationMicros,
    blobSize: commitments.raw_data_size,
    encoding: provider.config.enumIndex,
  });
  if (!Array.isArray(payload.functionArguments) || payload.functionArguments.length !== 7) {
    throw nativeError('Unexpected Shelby register payload shape', 'invalid_register_payload');
  }
  payload.functionArguments[5] = paymentTier;

  onStep?.('signing');
  const submitted = await adapter.signAndSubmitTransaction({ data: payload });
  if (!submitted?.hash) throw nativeError('Wallet did not return a transaction hash', 'submit_failed');

  onStep?.('confirming');
  const transaction = await deps.aptos.waitForTransaction({ transactionHash: submitted.hash });
  const evidence = extractShelbyTransactionEvidence(transaction);

  onStep?.('uploading');
  await deps.shelby.rpc.putBlob({
    account: session.storageAddress,
    blobName,
    blobData,
  });

  return {
    key: blobName,
    url: `${deps.shelby.baseUrl}/v1/blobs/${session.storageAddress}/${blobName}`,
    account: session.storageAddress,
    size: blobData.length,
    contentType: file.type || 'application/octet-stream',
    ownedByYou: true,
    paymentMode: 'native-aptos',
    expirationMicros,
    ...evidence,
  };
}
