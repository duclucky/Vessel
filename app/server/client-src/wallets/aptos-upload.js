import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import {
  ShelbyBlobClient,
  ShelbyClient,
  SHELBYUSD_FA_METADATA_ADDRESS,
  createDefaultErasureCodingProvider,
  expectedTotalChunksets,
  generateCommitments,
} from '@shelby-protocol/sdk/browser';

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

async function contentAddressedName(file, blobData, digest) {
  const hash = await digest(blobData);
  const sha = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const parts = String(file.name || '').split('.');
  const rawExtension = parts.length > 1 ? parts.pop() : 'bin';
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `media/${sha}.${extension}`;
}

export async function uploadNativeAptos(file, {
  session,
  adapter,
  expiresInSec = 7 * 24 * 3600,
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
  const provider = await deps.createProvider();

  onStep?.('encoding');
  const commitments = await deps.generateCommitments(provider, blobData);
  const blobName = await contentAddressedName(file, blobData, deps.digest || sha256);
  const expirationMicros = (deps.now?.() ?? Date.now()) * 1000 + expiresInSec * 1_000_000;
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

  onStep?.('signing');
  const submitted = await adapter.signAndSubmitTransaction({ data: payload });
  if (!submitted?.hash) throw nativeError('Wallet did not return a transaction hash', 'submit_failed');

  onStep?.('confirming');
  await deps.aptos.waitForTransaction({ transactionHash: submitted.hash });

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
    transactionHash: submitted.hash,
  };
}
