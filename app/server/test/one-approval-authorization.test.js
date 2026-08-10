import test from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { Account } from '@aptos-labs/ts-sdk';
import { Keypair } from '@solana/web3.js';
import { Wallet } from 'ethers';
import {
  oneApprovalBatchMessage,
  oneApprovalMessage,
} from '../public/one-approval-session.js';
import { createOneApprovalAuthorizationVerifier } from '../src/lib/one-approval-authorization.js';

const encoder = new TextEncoder();

const quote = Object.freeze({
  quoteId: 'quote-1',
  totalAccountingMicro: 151_514,
  expiresAtMs: 1_800_000_000_000,
});

const baseContext = Object.freeze({
  storageAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  fileHash: 'b'.repeat(64),
  blobName: 'media/artifact.png',
  sizeBytes: 321,
  days: 30,
  expirationMicros: 1_800_000_000_000_000,
});

test('verifies an Aptos wallet-standard signed upload session against its on-chain authentication key', async () => {
  const account = Account.generate();
  const context = { ...baseContext, chain: 'aptos', sourceAddress: account.accountAddress.toString() };
  const message = oneApprovalMessage({ intent: context, quote });
  const signedMessage = `APTOS\nmessage: ${message}\nnonce: vessel-upload-session`;
  const verifier = createOneApprovalAuthorizationVerifier({
    getAptosAuthenticationKey: async () => account.publicKey.authKey().toString(),
  });

  assert.equal(await verifier({
    context,
    quote,
    authorization: {
      chain: 'aptos',
      address: context.sourceAddress,
      message,
      signedMessage,
      signature: account.sign(encoder.encode(signedMessage)).toString(),
      publicKey: account.publicKey.toString(),
    },
  }), true);
});

test('verifies a Solana detached signature over the exact canonical upload session', async () => {
  const signer = Keypair.generate();
  const context = { ...baseContext, chain: 'solana', sourceAddress: signer.publicKey.toBase58() };
  const message = oneApprovalMessage({ intent: context, quote });
  const verifier = createOneApprovalAuthorizationVerifier();

  assert.equal(await verifier({
    context,
    quote,
    authorization: {
      chain: 'solana',
      address: context.sourceAddress,
      message,
      signedMessage: message,
      signature: Buffer.from(nacl.sign.detached(encoder.encode(message), signer.secretKey)).toString('base64'),
      publicKey: context.sourceAddress,
    },
  }), true);
});

test('verifies an EVM personal_sign signature over the exact canonical upload session', async () => {
  const signer = Wallet.createRandom();
  const context = { ...baseContext, chain: 'evm', sourceAddress: signer.address };
  const message = oneApprovalMessage({ intent: context, quote });
  const verifier = createOneApprovalAuthorizationVerifier();

  assert.equal(await verifier({
    context,
    quote,
    authorization: {
      chain: 'evm',
      address: signer.address,
      message,
      signedMessage: message,
      signature: await signer.signMessage(message),
    },
  }), true);
});

test('verifies the canonical batch message rather than a single-file marker substring', async () => {
  const signer = Wallet.createRandom();
  const context = { ...baseContext, chain: 'evm', sourceAddress: signer.address };
  const manifest = {
    manifestHash: context.fileHash,
    totalBytes: context.sizeBytes,
    items: [{ relativePath: 'artifact.png' }],
  };
  const message = oneApprovalBatchMessage({ intent: context, quote, manifest });
  const verifier = createOneApprovalAuthorizationVerifier();

  assert.equal(await verifier({
    context,
    quote,
    manifest,
    authorization: {
      chain: 'evm',
      address: signer.address,
      message,
      signedMessage: message,
      signature: await signer.signMessage(message),
    },
  }), true);
});

test('rejects non-empty forged signatures, mutated messages, and mismatched addresses', async () => {
  const signer = Keypair.generate();
  const context = { ...baseContext, chain: 'solana', sourceAddress: signer.publicKey.toBase58() };
  const message = oneApprovalMessage({ intent: context, quote });
  const verifier = createOneApprovalAuthorizationVerifier();
  const validSignature = Buffer.from(
    nacl.sign.detached(encoder.encode(message), signer.secretKey),
  ).toString('base64');

  assert.equal(await verifier({
    context,
    quote,
    authorization: {
      chain: 'solana',
      address: context.sourceAddress,
      message,
      signedMessage: message,
      signature: Buffer.from(new Uint8Array(64).fill(7)).toString('base64'),
      publicKey: context.sourceAddress,
    },
  }), false);
  assert.equal(await verifier({
    context,
    quote,
    authorization: {
      chain: 'solana',
      address: context.sourceAddress,
      message: `${message}\nExtra: attacker`,
      signedMessage: message,
      signature: validSignature,
      publicKey: context.sourceAddress,
    },
  }), false);
  assert.equal(await verifier({
    context,
    quote,
    authorization: {
      chain: 'solana',
      address: Keypair.generate().publicKey.toBase58(),
      message,
      signedMessage: message,
      signature: validSignature,
      publicKey: context.sourceAddress,
    },
  }), false);
});
