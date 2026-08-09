import { Deserializer, MultiAgentTransaction, SimpleTransaction } from '@aptos-labs/ts-sdk';
import {
  createDefaultErasureCodingProvider,
  generateCommitments,
} from '@shelby-protocol/sdk/browser';
import { uploadBlobViaVesselGateway } from './shelby-browser-upload.js';
import { extractShelbyTransactionEvidence } from './transaction-evidence.js';

const evmUploadError = (message, code) => Object.assign(new Error(message), { code });
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function jsonRequest(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(json.error || `Request failed (${response.status})`), {
      code: json.code,
      retriable: json.retriable,
    });
  }
  return json;
}

async function sha256Hex(bytes) {
  const buffer = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function contentAddressedName(file, sha) {
  const parts = String(file.name || '').split('.');
  const rawExtension = parts.length > 1 ? parts.pop() : 'bin';
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `media/${sha}.${extension}`;
}

function readUrl(storageAddress, blobName) {
  const path = String(blobName).split('/').map(encodeURIComponent).join('/');
  return `/api/shelby/blobs/${storageAddress}/${path}`;
}

async function signAndSponsorAptosTransaction(adapter, transaction, {
  quoteToken,
  paidAuthorization,
  uploadContext,
  contractQuote,
  contractSignature,
  transactionKind,
  submitMode,
  expectRegistrationEvidence = true,
}) {
  const authenticator = await adapter.signAptosTransaction(transaction);
  return jsonRequest('/api/sponsor/submit', {
    transaction: b64(transaction.bcsToBytes()),
    senderAuthenticator: b64(authenticator.bcsToBytes()),
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    transactionKind,
    submitMode,
    expectRegistrationEvidence,
  });
}

function deserializeServerTransaction(built) {
  const bytes = new Deserializer(fromB64(built.transaction));
  return built.transactionKind === 'simple'
    ? SimpleTransaction.deserialize(bytes)
    : MultiAgentTransaction.deserialize(bytes);
}

async function buildSponsoredCommitTransaction({
  quoteToken,
  paidAuthorization,
  uploadContext,
  contractQuote,
  contractSignature,
  commitPayload,
}) {
  const built = await jsonRequest('/api/shelby/commit', {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    commitPayload,
  });
  if (!built.transaction) throw evmUploadError('Vessel did not return a Shelby commit transaction', 'commit_transaction_missing');
  return SimpleTransaction.deserialize(new Deserializer(fromB64(built.transaction)));
}

async function registrationEvidenceFromHash(transactionHash) {
  if (!transactionHash) return {};
  const response = await fetch(`/api/shelby/transactions/${encodeURIComponent(transactionHash)}`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(json.error || 'Unable to recover Shelby registration evidence'), {
      code: json.code,
      retriable: json.retriable,
    });
  }
  return extractShelbyTransactionEvidence(json);
}

function assertPaidContext({
  session,
  file,
  sha,
  blobName,
  expirationMicros,
  expectedFileHash,
  paymentTier,
  uploadContext,
  quoteToken,
  paidAuthorization,
  contractQuote,
  contractSignature,
}) {
  if (
    session?.chain !== 'evm'
    || session?.mode !== 'daa'
    || uploadContext?.chain !== 'evm'
    || String(uploadContext.sourceAddress).toLowerCase() !== String(session.sourceAddress).toLowerCase()
    || String(uploadContext.storageAddress).toLowerCase() !== String(session.storageAddress).toLowerCase()
    || Number(uploadContext.sizeBytes) !== Number(file.size)
    || uploadContext.fileHash !== expectedFileHash
    || sha !== expectedFileHash
    || uploadContext.blobName !== blobName
    || uploadContext.expirationMicros !== expirationMicros
    || !Number.isSafeInteger(expirationMicros)
    || !Number.isSafeInteger(paymentTier)
    || paymentTier < 0
    || !quoteToken
    || !paidAuthorization
    || !contractQuote
    || !contractSignature
  ) {
    throw evmUploadError('Paid upload context does not match the connected EVM wallet and file', 'invalid_paid_authorization');
  }
}

export async function uploadSponsoredEvm(file, {
  session,
  adapter,
  quoteToken,
  paidAuthorization,
  expirationMicros,
  expectedFileHash,
  paymentTier,
  uploadContext,
  contractQuote,
  contractSignature,
  onStep,
  onCheckpoint,
} = {}) {
  if (!adapter?.signAptosTransaction) throw evmUploadError('Reconnect an EVM DAA wallet before uploading', 'provider_unavailable');
  const data = new Uint8Array(await file.arrayBuffer());
  const sha = await sha256Hex(data);
  const blobName = contentAddressedName(file, sha);
  assertPaidContext({
    session,
    file,
    sha,
    blobName,
    expirationMicros,
    expectedFileHash,
    paymentTier,
    uploadContext,
    quoteToken,
    paidAuthorization,
    contractQuote,
    contractSignature,
  });

  onStep?.('encoding');
  const erasureProvider = await createDefaultErasureCodingProvider();
  const commitments = await generateCommitments(erasureProvider, data);
  const built = await jsonRequest('/api/shelby/register', {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    blobMerkleRoot: commitments.blob_merkle_root,
  });
  if (!built.transaction) throw evmUploadError('Vessel did not return a Shelby registration transaction', 'register_transaction_missing');
  const transaction = deserializeServerTransaction(built);

  onStep?.('signing');
  onStep?.('submitting');
  const registered = await signAndSponsorAptosTransaction(adapter, transaction, {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    transactionKind: built.transactionKind,
    submitMode: built.submitMode,
  });
  const registrationEvidence = {
    transactionHash: registered.transactionHash || registered.hash,
    actualStorageUnits: registered.actualStorageUnits,
    actualGasUsed: registered.actualGasUsed,
    registrationUid: registered.registrationUid,
    blobMerkleRoot: commitments.blob_merkle_root,
  };
  if (
    !registrationEvidence.transactionHash
    || registrationEvidence.actualStorageUnits == null
    || registrationEvidence.actualGasUsed == null
    || !registrationEvidence.registrationUid
  ) {
    throw evmUploadError('Shelby registration is still finalizing', 'registration_evidence_missing');
  }
  onCheckpoint?.('registered', registrationEvidence);

  onStep?.('uploading');
  onCheckpoint?.('uploading', {
    registerTransactionHash: registrationEvidence.transactionHash,
    registrationUid: registrationEvidence.registrationUid,
    blobMerkleRoot: commitments.blob_merkle_root,
  });
  const uploaded = await uploadBlobViaVesselGateway(data, {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    registrationUid: registrationEvidence.registrationUid,
    blobMerkleRoot: commitments.blob_merkle_root,
  });
  if (!uploaded?.commitPayload) throw evmUploadError('Shelby commit payload is missing', 'commit_payload_missing');
  onStep?.('committing');
  const commitTransaction = await buildSponsoredCommitTransaction({
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    commitPayload: uploaded.commitPayload,
  });
  const committed = await signAndSponsorAptosTransaction(adapter, commitTransaction, {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    transactionKind: 'simple',
    submitMode: 'direct',
    expectRegistrationEvidence: false,
  });
  onCheckpoint?.('committed', {
    commitTransactionHash: committed.transactionHash || committed.hash,
  });
  onCheckpoint?.('finalizing', {
    registerTransactionHash: registrationEvidence.transactionHash,
  });
  return {
    key: blobName,
    url: readUrl(session.storageAddress, blobName),
    account: session.storageAddress,
    size: data.length,
    ownedByYou: true,
    paymentMode: 'evm-sepolia',
    expirationMicros,
    ...registrationEvidence,
  };
}

export async function resumeEvmBlobWrite(file, {
  session,
  adapter,
  expectedFileHash,
  blobName,
  quoteToken,
  paidAuthorization,
  uploadContext,
  contractQuote,
  contractSignature,
  registrationUid,
  registerTransactionHash,
  blobMerkleRoot,
} = {}) {
  if (!adapter?.signAptosTransaction) throw evmUploadError('Reconnect an EVM DAA wallet before recovery', 'provider_unavailable');
  const data = new Uint8Array(await file.arrayBuffer());
  const sha = await sha256Hex(data);
  if (sha !== expectedFileHash || contentAddressedName(file, sha) !== blobName) {
    throw evmUploadError('The selected file does not match this recovery record', 'file_changed');
  }
  const erasureProvider = await createDefaultErasureCodingProvider();
  const commitments = await generateCommitments(erasureProvider, data);
  const recoveredEvidence = registrationUid
    ? { registrationUid }
    : await registrationEvidenceFromHash(registerTransactionHash);
  const root = blobMerkleRoot || commitments.blob_merkle_root;
  const uploaded = await uploadBlobViaVesselGateway(data, {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    registrationUid: recoveredEvidence.registrationUid,
    blobMerkleRoot: root,
  });
  if (!uploaded?.commitPayload) throw evmUploadError('Shelby commit payload is missing', 'commit_payload_missing');
  const commitTransaction = await buildSponsoredCommitTransaction({
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    commitPayload: uploaded.commitPayload,
  });
  const committed = await signAndSponsorAptosTransaction(adapter, commitTransaction, {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    transactionKind: 'simple',
    submitMode: 'direct',
    expectRegistrationEvidence: false,
  });
  return {
    key: blobName,
    url: readUrl(session.storageAddress, blobName),
    size: data.length,
    commitTransactionHash: committed.transactionHash || committed.hash,
  };
}
