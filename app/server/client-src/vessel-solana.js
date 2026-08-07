// Vessel — Solana DAA ownership with server-authenticated Shelby access.
// Phantom signs the Aptos DAA registration. Vessel's backend keeps the Shelby and gas-station
// credentials private, validates the paid contract receipt, and relays bounded blob chunks.
import { Deserializer, MultiAgentTransaction } from '@aptos-labs/ts-sdk';
import {
  createDefaultErasureCodingProvider,
  generateCommitments,
} from '@shelby-protocol/sdk/browser';
import {
  SolanaDerivedPublicKey,
  defaultSolanaAuthenticationFunction,
  signAptosTransactionWithSolana,
} from '@aptos-labs/derived-wallet-solana';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { submitSolanaContractSettlement } from './wallets/solana-contract-settlement.js';
import { uploadBlobViaVesselGateway } from './wallets/shelby-browser-upload.js';
import { extractShelbyTransactionEvidence } from './wallets/transaction-evidence.js';

const NET = (typeof window !== 'undefined' && window.VESSEL_NETWORK) || 'testnet';
const authFn = defaultSolanaAuthenticationFunction;

let provider = null;
let pubkey = null;
let storageAddr = null;
let DOMAIN = (typeof window !== 'undefined' && window.VESSEL_DOMAIN) || 'vessel.demo';
let serverCfg = null;

function clearProvider() {
  provider = null;
  pubkey = null;
  storageAddr = null;
}

function selectProvider(nextProvider) {
  if (!nextProvider) throw new Error('Select a Solana wallet before connecting');
  if (provider !== nextProvider) clearProvider();
  provider = nextProvider;
  return provider;
}

async function loadConfig() {
  if (serverCfg) return serverCfg;
  serverCfg = await fetch('/api/config').then((response) => response.json()).catch(() => ({}));
  if (serverCfg.domain) DOMAIN = serverCfg.domain;
  return serverCfg;
}

async function connect(nextProvider) {
  selectProvider(nextProvider);
  await loadConfig();
  const result = await provider.connect();
  pubkey = result.publicKey.toString();
  storageAddr = deriveAddress(pubkey);
  return { solana: pubkey, storageAccount: storageAddr.toString(), network: NET };
}

function deriveAddress(pubkeyString) {
  const derivedKey = new SolanaDerivedPublicKey({
    domain: DOMAIN,
    solanaPublicKey: new PublicKey(pubkeyString),
    authenticationFunction: authFn,
  });
  return derivedKey.authKey().derivedAddress();
}

async function signMsgRaw(bytes) {
  const result = await provider.signMessage(bytes, 'utf8')
    .catch(async () => provider.signMessage(bytes));
  return result?.signature ?? result;
}

function solWallet() {
  return {
    publicKey: new PublicKey(pubkey),
    signMessage: signMsgRaw,
    name: provider.name || 'Solana wallet',
  };
}

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
    });
  }
  return json;
}

async function signAndSponsorAptosTransaction(transaction, {
  quoteToken,
  paidAuthorization,
  uploadContext,
  contractQuote,
  contractSignature,
  expectRegistrationEvidence = true,
}) {
  const signed = await signAptosTransactionWithSolana({
    solanaWallet: solWallet(),
    authenticationFunction: authFn,
    rawTransaction: transaction,
    domain: DOMAIN,
  });
  if (signed.status !== 'Approved' && signed.status !== 'APPROVED') {
    throw new Error('User rejected the signature');
  }
  return jsonRequest('/api/sponsor/submit', {
    transaction: b64(transaction.bcsToBytes()),
    senderAuthenticator: b64(signed.args.bcsToBytes()),
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    expectRegistrationEvidence,
  });
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
  if (!built.transaction) {
    throw new Error('Vessel did not return a Shelby commit transaction');
  }
  return MultiAgentTransaction.deserialize(new Deserializer(fromB64(built.transaction)));
}

async function registrationEvidenceFromHash(transactionHash) {
  if (!transactionHash) return {};
  const response = await fetch(`/api/shelby/transactions/${encodeURIComponent(transactionHash)}`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(json.error || 'Unable to recover Shelby registration evidence'), {
      code: json.code,
    });
  }
  return extractShelbyTransactionEvidence(json);
}

async function uploadSponsored(file, {
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
  if (!storageAddr || !pubkey) await connect(provider);
  const data = new Uint8Array(await file.arrayBuffer());
  const sha = await sha256Hex(data);
  const parts = String(file.name || '').split('.');
  const rawExtension = parts.length > 1 ? parts.pop() : 'bin';
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const blobName = `media/${sha}.${extension}`;
  if (
    uploadContext?.chain !== 'solana'
    || uploadContext.sourceAddress !== pubkey
    || String(uploadContext.storageAddress).toLowerCase() !== storageAddr.toString().toLowerCase()
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
    throw new Error('Paid upload context does not match the connected wallet and file');
  }
  const cfg = await loadConfig();
  if (!cfg.gasStationAccount) throw new Error('server sponsor not configured');

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
  if (!built.transaction) {
    throw new Error('Vessel did not return a Shelby registration transaction');
  }
  const transaction = MultiAgentTransaction.deserialize(
    new Deserializer(fromB64(built.transaction)),
  );

  onStep?.('signing');
  onStep?.('sponsoring');
  const registered = await signAndSponsorAptosTransaction(transaction, {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
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
    throw Object.assign(new Error('Shelby registration is still finalizing'), {
      code: 'registration_evidence_missing',
    });
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
  if (!uploaded?.commitPayload) throw new Error('Shelby commit payload is missing');
  onStep?.('committing');
  const commitTransaction = await buildSponsoredCommitTransaction({
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    commitPayload: uploaded.commitPayload,
  });
  const committed = await signAndSponsorAptosTransaction(commitTransaction, {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
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
    url: readUrl(blobName),
    account: storageAddr.toString(),
    size: data.length,
    ownedByYou: true,
    paymentMode: 'solana-usdc',
    expirationMicros,
    ...registrationEvidence,
  };
}

async function submitContractSettlement({ deployment, contractQuote, contractSignature }) {
  if (!provider) throw new Error('Select a Solana wallet before settling');
  if (!pubkey) await connect(provider);
  const cfg = await loadConfig();
  return submitSolanaContractSettlement({
    provider,
    connection: new Connection(cfg.solanaRpc || 'https://api.devnet.solana.com', 'confirmed'),
    deployment,
    contractQuote,
    contractSignature,
  });
}

async function usdcBalance() {
  try {
    const cfg = await loadConfig();
    const connection = new Connection(cfg.solanaRpc || 'https://api.devnet.solana.com', 'confirmed');
    const account = await getAssociatedTokenAddress(
      new PublicKey(cfg.usdcMint),
      new PublicKey(pubkey),
    );
    const balance = await connection.getTokenAccountBalance(account);
    return Number(balance?.value?.uiAmount || 0);
  } catch {
    return 0;
  }
}

async function resumeBlobWrite(file, {
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
  if (!storageAddr) throw new Error('Reconnect your Solana wallet before recovery');
  const data = new Uint8Array(await file.arrayBuffer());
  const sha = await sha256Hex(data);
  if (sha !== expectedFileHash) {
    throw Object.assign(
      new Error('The selected file does not match this recovery record'),
      { code: 'file_changed' },
    );
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
  if (!uploaded?.commitPayload) throw new Error('Shelby commit payload is missing');
  const commitTransaction = await buildSponsoredCommitTransaction({
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    commitPayload: uploaded.commitPayload,
  });
  const committed = await signAndSponsorAptosTransaction(commitTransaction, {
    quoteToken,
    paidAuthorization,
    uploadContext,
    contractQuote,
    contractSignature,
    expectRegistrationEvidence: false,
  });
  return {
    key: blobName,
    url: readUrl(blobName),
    size: data.length,
    commitTransactionHash: committed.transactionHash || committed.hash,
  };
}

function readUrl(blobName) {
  const path = String(blobName).split('/').map(encodeURIComponent).join('/');
  return `/api/shelby/blobs/${storageAddr.toString()}/${path}`;
}

async function sha256Hex(bytes) {
  const buffer = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

window.VesselSolana = {
  available: () => Boolean(provider && pubkey && storageAddr),
  network: NET,
  connect,
  selectProvider,
  clearProvider,
  disconnect: clearProvider,
  loadConfig,
  deriveAddress,
  uploadSponsored,
  resumeBlobWrite,
  submitContractSettlement,
  usdcBalance,
  readUrl,
  get state() {
    return { solana: pubkey, storageAccount: storageAddr?.toString() };
  },
};
