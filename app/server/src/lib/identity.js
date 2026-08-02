import { verifyMessage, VoidSigner } from 'ethers';
import crypto from 'node:crypto';

// Best-effort DAA derivation: compute the Aptos storage account an ETH wallet controls,
// from the address alone (derivation needs no private key). Loaded lazily/defensively so
// the server still runs if the kit version drifts.
let _Shelby, _Network;
async function loadKit() {
  if (_Shelby !== undefined) return;
  try {
    const kit = await import('@shelby-protocol/ethereum-kit/node');
    _Shelby = kit.Shelby;
    _Network = kit.Network;
  } catch {
    _Shelby = null;
  }
}

const DOMAIN = process.env.DAPP_DOMAIN || 'vessel.demo';
const nonces = new Map(); // address(lower) -> { message, exp }

export function makeChallenge(address) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const ts = 1700000000 + Math.floor((globalThis.__vesselClock ?? Date.now()) / 1000); // stable-ish
  const message =
    `VESSEL_AUTH\nBind wallet ${address}\nto your Shelby storage identity.\n` +
    `Domain: ${DOMAIN}\nNonce: ${nonce}`;
  nonces.set(address.toLowerCase(), { message, exp: Date.now() + 10 * 60 * 1000 });
  return { message };
}

/** Verify the signature matches the address (and, if present, the issued challenge). */
export async function verifySignature(address, signature, message) {
  let recovered;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  if (recovered.toLowerCase() !== String(address).toLowerCase()) return { ok: false, reason: 'address_mismatch' };
  const issued = nonces.get(String(address).toLowerCase());
  if (issued && issued.message !== message) return { ok: false, reason: 'stale_challenge' };
  nonces.delete(String(address).toLowerCase());
  const storageAccount = await deriveStorageAccount(address);
  return { ok: true, chain: 'ethereum', address, storageAccount, domain: DOMAIN };
}

/** @returns {Promise<string|null>} derived Aptos storage account address, or null if unavailable. */
export async function deriveStorageAccount(address) {
  await loadKit();
  if (!_Shelby) return null;
  try {
    const shelby = new _Shelby({ network: _Network.SHELBYNET });
    const sa = shelby.createStorageAccount(new VoidSigner(address), DOMAIN);
    return sa.accountAddress.toString();
  } catch {
    return null;
  }
}
