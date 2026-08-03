import {
  ShelbyBlobClient,
  SHELBYUSD_FA_METADATA_ADDRESS,
  createDefaultErasureCodingProvider,
  expectedTotalChunksets,
  generateCommitments,
} from '@shelby-protocol/sdk/browser';
import { extractShelbyTransactionEvidence } from './transaction-evidence.js';
import { uploadBlobViaVesselGateway } from './shelby-browser-upload.js';

const nativeError = (message, code) => Object.assign(new Error(message), { code });
const sha256 = (data) => crypto.subtle.digest('SHA-256', data);

function defaultDeps() {
  return {
    shelbyUsdAsset: SHELBYUSD_FA_METADATA_ADDRESS,
    createProvider: createDefaultErasureCodingProvider,
    generateCommitments,
    expectedTotalChunksets,
    createRegisterPayload: (args) => ShelbyBlobClient.createRegisterBlobPayload(args),
    now: () => Date.now(),
    digest: sha256,
    async readBalances(address) {
      const response = await fetch(`/api/shelby/accounts/${encodeURIComponent(address)}/balances`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw nativeError(json.error || 'Unable to read Aptos balances', json.code);
      return json;
    },
    async waitForTransaction(transactionHash) {
      const response = await fetch(`/api/shelby/transactions/${encodeURIComponent(transactionHash)}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw nativeError(json.error || 'Unable to confirm Aptos transaction', json.code);
      return json;
    },
    uploadBlob: uploadBlobViaVesselGateway,
  };
}

export async function readNativeBalances(address, deps = defaultDeps()) {
  if (typeof deps.readBalances === 'function') {
    const balances = await deps.readBalances(address);
    return {
      aptOctas: Number(balances?.aptOctas || 0),
      shelbyUsdUnits: Number(balances?.shelbyUsdUnits || 0),
    };
  }
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

async function fileHashHex(file, digest) {
  const data = new Uint8Array(await file.arrayBuffer());
  const hash = new Uint8Array(await digest(data));
  return {
    data,
    hex: [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

export async function resumeNativeBlobWrite(file, {
  session,
  expectedFileHash,
  blobName,
  quoteToken,
  paidAuthorization,
  uploadContext,
  contractQuote,
  contractSignature,
  deps = defaultDeps(),
}) {
  const { data, hex } = await fileHashHex(file, deps.digest || sha256);
  if (hex !== String(expectedFileHash || '').toLowerCase()) {
    throw nativeError('The selected file does not match this recovery record', 'file_changed');
  }
  if (contentAddressedName(file, hex) !== blobName) {
    throw nativeError('The recovered blob name does not match the file', 'file_changed');
  }
  if (typeof deps.uploadBlob === 'function') {
    await deps.uploadBlob(data, {
      quoteToken,
      paidAuthorization,
      uploadContext,
      contractQuote,
      contractSignature,
    });
  } else {
    await deps.shelby.rpc.putBlob({
      account: session.storageAddress,
      blobName,
      blobData: data,
    });
  }
  return { key: blobName, size: data.length };
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
  contractQuote,
  contractSignature,
  onStep,
  onCheckpoint,
  deps = defaultDeps(),
}) {
  if (session?.chain && (session.chain !== 'aptos' || session.mode !== 'native')) {
    throw nativeError('A native Aptos session is required', 'invalid_session');
  }
  if (!session?.sourceAddress || session.sourceAddress !== session.storageAddress) {
    throw nativeError('Aptos wallet and storage addresses must match', 'invalid_session');
  }

  assertNativeBalances(await readNativeBalances(session.sourceAddress, deps));
  const { data: blobData, hex: computedHash } = await fileHashHex(file, deps.digest || sha256);
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
    || !contractQuote
    || !contractSignature
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
  const transaction = typeof deps.waitForTransaction === 'function'
    ? await deps.waitForTransaction(submitted.hash)
    : await deps.aptos.waitForTransaction({ transactionHash: submitted.hash });
  const evidence = extractShelbyTransactionEvidence(transaction);
  onCheckpoint?.('registered', {
    registerTransactionHash: evidence.transactionHash,
    actualStorageUnits: evidence.actualStorageUnits,
    actualGasUsed: evidence.actualGasUsed,
  });

  onStep?.('uploading');
  onCheckpoint?.('uploading', { registerTransactionHash: evidence.transactionHash });
  if (typeof deps.uploadBlob === 'function') {
    await deps.uploadBlob(blobData, {
      quoteToken,
      paidAuthorization,
      uploadContext,
      contractQuote,
      contractSignature,
    });
  } else {
    await deps.shelby.rpc.putBlob({
      account: session.storageAddress,
      blobName,
      blobData,
    });
  }
  onCheckpoint?.('finalizing', { registerTransactionHash: evidence.transactionHash });

  return {
    key: blobName,
    url: `/api/shelby/blobs/${session.storageAddress}/${blobName.split('/').map(encodeURIComponent).join('/')}`,
    account: session.storageAddress,
    size: blobData.length,
    contentType: file.type || 'application/octet-stream',
    ownedByYou: true,
    paymentMode: 'native-aptos',
    expirationMicros,
    ...evidence,
  };
}
