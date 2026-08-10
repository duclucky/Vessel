import {
  Ed25519PublicKey,
  Ed25519Signature,
} from '@aptos-labs/ts-sdk';
import bs58 from 'bs58';
import { verifyMessage } from 'ethers';
import nacl from 'tweetnacl';
import {
  oneApprovalBatchMessage,
  oneApprovalMessage,
  parseAptosSignedMessage,
} from '../../public/one-approval-session.js';

const encoder = new TextEncoder();
const HEX_32 = /^0x[0-9a-f]{64}$/i;
const HEX_64 = /^0x[0-9a-f]{128}$/i;
const BASE64_ED25519 = /^[A-Za-z0-9+/]{86}==$/;

const lower = (value) => String(value || '').trim().toLowerCase();

function expectedMessage({ context, quote, manifest }) {
  return manifest
    ? oneApprovalBatchMessage({ intent: context, quote, manifest })
    : oneApprovalMessage({ intent: context, quote });
}

async function verifyAptos({ authorization, context, message, getAptosAuthenticationKey }) {
  if (typeof getAptosAuthenticationKey !== 'function') return false;
  const signedMessage = String(authorization.signedMessage || '');
  const publicKeyHex = String(authorization.publicKey || '');
  const signatureHex = String(authorization.signature || '');
  if (
    !parseAptosSignedMessage({ signedMessage, canonicalMessage: message }).valid
    || !HEX_32.test(publicKeyHex)
    || !HEX_64.test(signatureHex)
  ) return false;

  const publicKey = new Ed25519PublicKey(publicKeyHex);
  const signature = new Ed25519Signature(signatureHex);
  if (!publicKey.verifySignature({ message: encoder.encode(signedMessage), signature })) return false;

  const onChainAuthenticationKey = lower(await getAptosAuthenticationKey(context.sourceAddress));
  return HEX_32.test(onChainAuthenticationKey)
    && lower(publicKey.authKey().toString()) === onChainAuthenticationKey;
}

function verifySolana({ authorization, context, message }) {
  const signedMessage = String(authorization.signedMessage || '');
  const publicKeyText = String(authorization.publicKey || '');
  const signatureText = String(authorization.signature || '');
  if (
    signedMessage !== message
    || publicKeyText !== String(context.sourceAddress)
    || !BASE64_ED25519.test(signatureText)
  ) return false;

  const publicKey = bs58.decode(publicKeyText);
  const signature = Buffer.from(signatureText, 'base64');
  return publicKey.length === 32
    && signature.length === 64
    && nacl.sign.detached.verify(encoder.encode(message), signature, publicKey);
}

function verifyEvm({ authorization, context, message }) {
  const signedMessage = String(authorization.signedMessage || '');
  if (signedMessage !== message) return false;
  return lower(verifyMessage(signedMessage, String(authorization.signature || '')))
    === lower(context.sourceAddress);
}

export function createOneApprovalAuthorizationVerifier({
  getAptosAuthenticationKey,
} = {}) {
  return async function verifyOneApprovalAuthorization({
    authorization,
    context,
    quote,
    manifest = null,
  }) {
    try {
      const message = expectedMessage({ context, quote, manifest });
      const chain = lower(context?.chain);
      if (
        !authorization
        || lower(authorization.chain) !== chain
        || lower(authorization.address) !== lower(context?.sourceAddress)
        || String(authorization.message || '') !== message
      ) return false;

      if (chain === 'aptos') {
        return verifyAptos({ authorization, context, message, getAptosAuthenticationKey });
      }
      if (chain === 'solana') return verifySolana({ authorization, context, message });
      if (chain === 'evm') return verifyEvm({ authorization, context, message });
      return false;
    } catch {
      return false;
    }
  };
}

