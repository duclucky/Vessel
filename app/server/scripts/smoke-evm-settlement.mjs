import path from 'node:path';
import dotenv from 'dotenv';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { compileVesselEvmSettlement } from './evm-settlement-build.mjs';
import {
  ContractQuoteManager,
  privateKeyFromPkcs8Base64,
  publicKeyFromRawHex,
} from '../src/lib/settlement/contract-quotes.js';
import { EvmSettlementAdapter } from '../src/lib/settlement/evm-adapter.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function quoteTuple(quote) {
  return [
    quote.version,
    quote.chain,
    quote.network,
    `0x${quote.quoteId}`,
    `0x${quote.payer}`,
    `0x${quote.storageAddress}`,
    `0x${quote.asset}`,
    quote.amount,
    `0x${quote.fileHash}`,
    quote.retentionDays,
    quote.storageExpirationMicros,
    quote.quoteExpiresAtSecs,
    quote.configVersion,
  ];
}

async function main() {
  const deployment = (await import('../deployments/vessel-settlement.shelbynet.json', {
    with: { type: 'json' },
  })).default;
  if (!deployment.evm?.contractAddress) throw new Error('EVM deployment missing from Shelbynet manifest');

  const provider = new JsonRpcProvider(process.env.EVM_RPC || process.env.SEPOLIA_RPC);
  const wallet = new Wallet(required('EVM_DEPLOYER_PRIVATE_KEY'), provider);
  const manager = new ContractQuoteManager({
    privateKey: privateKeyFromPkcs8Base64(required('QUOTE_SIGNER_PRIVATE_KEY_B64')),
    publicKey: publicKeyFromRawHex(required('QUOTE_SIGNER_PUBLIC_KEY_HEX')),
    priceUpload: async () => ({
      serviceFeeAccountingMicro: '1',
      totalAccountingMicro: '1',
    }),
    aptosAssetHex: deployment.aptos.acceptedAsset,
    solanaMintHex: '11'.repeat(32),
    evmAssetHex: deployment.evm.acceptedAsset,
    aptosNetwork: deployment.aptos.chainId,
    evmNetwork: deployment.evm.chainId,
    configVersion: deployment.configVersion,
  });

  const sourceAddress = await wallet.getAddress();
  const quoteResult = await manager.issueUpload({
    operation: 'upload',
    chain: 'evm',
    sourceNetwork: 'sepolia',
    storageNetwork: 'shelbynet',
    sourceAddress,
    storageAddress: `0x${'33'.repeat(32)}`,
    fileHash: '55'.repeat(32),
    blobName: `media/${'55'.repeat(32)}.png`,
    sizeBytes: 1,
    contentType: 'image/png',
    encoding: 0,
    days: 1,
    expirationMicros: Date.now() * 1000 + 86_400_000_000,
  });

  const contract = new Contract(
    deployment.evm.contractAddress,
    compileVesselEvmSettlement().abi,
    wallet,
  );
  const tx = await contract.settle(
    quoteTuple(quoteResult.contractQuote),
    `0x${quoteResult.contractSignature}`,
    { value: BigInt(quoteResult.contractQuote.amount) },
  );
  console.log(`Smoke transaction: ${tx.hash}`);
  await tx.wait(1);

  const receipt = await new EvmSettlementAdapter({
    rpcUrl: process.env.EVM_RPC || process.env.SEPOLIA_RPC,
    contractAddress: deployment.evm.contractAddress,
    network: deployment.evm.chainId,
  }).verify({
    quote: quoteResult,
    transactionId: tx.hash,
  });
  console.log(`Verified EVM receipt: ${receipt.transactionId}`);
  console.log(`Quote ID: ${receipt.quoteId}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

