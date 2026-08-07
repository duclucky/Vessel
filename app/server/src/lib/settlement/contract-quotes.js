import {
  createPrivateKey,
  createPublicKey,
  randomBytes as secureRandomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import bs58 from 'bs58';
import { normalizeUploadQuoteContext } from '../quotes.js';
import { quoteDigest } from './quote-v1.js';

const CHAIN = Object.freeze({ aptos: 1, solana: 2 });
const DEFAULT_NETWORK = Object.freeze({ aptos: 2, solana: 1 });
const HEX_32 = /^[0-9a-f]{64}$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function asPublicKey(key) {
  return key?.type === 'public' ? key : createPublicKey(key);
}

function rawPublicKey(publicKey) {
  const der = asPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return Buffer.from(der).subarray(-32);
}

function normalizeAsset(value, field) {
  const hex = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!HEX_32.test(hex)) throw new TypeError(`${field} must be a 32-byte hex value`);
  return hex;
}

function addressBytes32(value, chain) {
  if (chain === 'solana') {
    let decoded;
    try {
      decoded = Buffer.from(bs58.decode(String(value || '')));
    } catch {
      throw new TypeError('Solana payer must be a 32-byte public key');
    }
    if (decoded.length !== 32) throw new TypeError('Solana payer must be a 32-byte public key');
    return decoded.toString('hex');
  }

  const text = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{1,64}$/.test(text)) throw new TypeError('Aptos address is invalid');
  return text.padStart(64, '0');
}

function settlementAmount(chain, breakdown) {
  return chain === 'aptos'
    ? (BigInt(breakdown.serviceFeeAccountingMicro) * 100n).toString()
    : String(breakdown.totalAccountingMicro);
}

function quoteContextError() {
  return Object.assign(
    new Error('Contract quote does not match the signed upload context'),
    { code: 'quote_context_mismatch', status: 400, retriable: false },
  );
}

export function assertContractQuoteMatchesContext(contractQuote, signedQuote, deployments) {
  const context = normalizeUploadQuoteContext(signedQuote?.context);
  const breakdown = signedQuote?.breakdown || {};
  const chain = CHAIN[context.chain];
  const network = context.chain === 'aptos'
    ? Number(deployments?.aptos?.chainId || DEFAULT_NETWORK.aptos)
    : DEFAULT_NETWORK.solana;
  const acceptedAsset = context.chain === 'aptos'
    ? addressBytes32(deployments?.aptos?.acceptedAsset, 'aptos')
    : addressBytes32(deployments?.solana?.acceptedMint, 'solana');
  const comparisons = [
    [Number(contractQuote?.chain), chain],
    [Number(contractQuote?.network), network],
    [String(contractQuote?.payer || '').toLowerCase(), addressBytes32(context.sourceAddress, context.chain)],
    [String(contractQuote?.storageAddress || '').toLowerCase(), addressBytes32(context.storageAddress, 'aptos')],
    [String(contractQuote?.asset || '').toLowerCase(), acceptedAsset],
    [String(contractQuote?.amount || ''), settlementAmount(context.chain, breakdown)],
    [String(contractQuote?.fileHash || '').toLowerCase(), context.fileHash],
    [Number(contractQuote?.retentionDays), context.days],
    [String(contractQuote?.storageExpirationMicros || ''), String(context.expirationMicros)],
    [String(contractQuote?.configVersion || ''), String(deployments?.configVersion || '')],
  ];
  if (comparisons.some(([actual, expected]) => actual !== expected)) {
    throw quoteContextError();
  }
  return true;
}

function toSafeClock(value) {
  const result = BigInt(value);
  if (result <= 0n) throw new TypeError('Invalid quote clock');
  return result;
}

export function privateKeyFromPkcs8Base64(value) {
  const der = Buffer.from(String(value || ''), 'base64');
  if (der.length === 0) throw new TypeError('QUOTE_SIGNER_PRIVATE_KEY_B64 is required');
  return createPrivateKey({ key: der, type: 'pkcs8', format: 'der' });
}

export function publicKeyFromRawHex(value) {
  const raw = Buffer.from(normalizeAsset(value, 'Quote public key'), 'hex');
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    type: 'spki',
    format: 'der',
  });
}

export function verifyContractQuoteSignature(result) {
  try {
    const signature = Buffer.from(String(result?.contractSignature || ''), 'hex');
    return signature.length === 64 && cryptoVerify(
      null,
      quoteDigest(result.contractQuote),
      publicKeyFromRawHex(result.quotePublicKey),
      signature,
    );
  } catch {
    return false;
  }
}

export class ContractQuoteManager {
  constructor({
    privateKey,
    publicKey,
    priceUpload,
    aptosAssetHex,
    solanaMintHex,
    aptosNetwork = DEFAULT_NETWORK.aptos,
    configVersion,
    now = Date.now,
    randomBytes = secureRandomBytes,
  }) {
    if (!privateKey || !publicKey) throw new TypeError('Ed25519 quote key pair is required');
    if (typeof priceUpload !== 'function') throw new TypeError('priceUpload callback is required');
    if (typeof now !== 'function' || typeof randomBytes !== 'function') throw new TypeError('Invalid quote dependencies');

    const derived = rawPublicKey(createPublicKey(privateKey));
    const configured = rawPublicKey(publicKey);
    if (!derived.equals(configured)) throw new TypeError('Ed25519 quote key pair does not match');

    this.privateKey = privateKey;
    this.publicKey = asPublicKey(publicKey);
    this.publicKeyHex = configured.toString('hex');
    this.priceUpload = priceUpload;
    this.aptosAssetHex = normalizeAsset(aptosAssetHex, 'Aptos asset');
    this.solanaMintHex = normalizeAsset(solanaMintHex, 'Solana mint');
    this.aptosNetwork = Number(aptosNetwork);
    if (!Number.isSafeInteger(this.aptosNetwork) || this.aptosNetwork <= 0) {
      throw new RangeError('aptosNetwork must be a positive chain ID');
    }
    this.configVersion = BigInt(configVersion);
    if (this.configVersion <= 0n) throw new RangeError('configVersion must be positive');
    this.now = now;
    this.randomBytes = randomBytes;
  }

  static forTest({
    privateKey,
    publicKey,
    now = Date.now,
    pricing,
    randomBytes,
    aptosAssetHex = '44'.repeat(32),
    solanaMintHex = '66'.repeat(32),
    aptosNetwork = DEFAULT_NETWORK.aptos,
    configVersion = 1,
  }) {
    return new ContractQuoteManager({
      privateKey,
      publicKey,
      now,
      priceUpload: pricing,
      randomBytes,
      aptosAssetHex,
      solanaMintHex,
      aptosNetwork,
      configVersion,
    });
  }

  async issueUpload(input) {
    const uploadContext = normalizeUploadQuoteContext(input);
    const breakdown = Object.freeze({ ...(await this.priceUpload(uploadContext)) });
    return this.issueUploadFromBreakdown(uploadContext, breakdown);
  }

  async issueUploadFromBreakdown(input, quotedBreakdown) {
    const uploadContext = normalizeUploadQuoteContext(input);
    const breakdown = Object.freeze({ ...(quotedBreakdown || {}) });
    const issuedAtMs = toSafeClock(this.now());
    const quoteId = Buffer.from(this.randomBytes(32));
    if (quoteId.length !== 32) throw new TypeError('Quote ID generator must return 32 bytes');

    const contractQuote = Object.freeze({
      version: 1,
      chain: CHAIN[uploadContext.chain],
      network: uploadContext.chain === 'aptos' ? this.aptosNetwork : DEFAULT_NETWORK.solana,
      quoteId: quoteId.toString('hex'),
      payer: addressBytes32(uploadContext.sourceAddress, uploadContext.chain),
      storageAddress: addressBytes32(uploadContext.storageAddress, 'aptos'),
      asset: uploadContext.chain === 'aptos' ? this.aptosAssetHex : this.solanaMintHex,
      amount: settlementAmount(uploadContext.chain, breakdown),
      fileHash: uploadContext.fileHash,
      retentionDays: uploadContext.days,
      storageExpirationMicros: String(uploadContext.expirationMicros),
      quoteExpiresAtSecs: String(issuedAtMs / 1_000n + 300n),
      configVersion: this.configVersion.toString(),
    });
    const signature = cryptoSign(null, quoteDigest(contractQuote), this.privateKey);

    return Object.freeze({
      uploadContext,
      breakdown,
      contractQuote,
      contractSignature: signature.toString('hex'),
      quotePublicKey: this.publicKeyHex,
    });
  }

  verifySignature(result) {
    try {
      const signature = Buffer.from(String(result?.contractSignature || ''), 'hex');
      return signature.length === 64
        && cryptoVerify(null, quoteDigest(result.contractQuote), this.publicKey, signature);
    } catch {
      return false;
    }
  }
}
