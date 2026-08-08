import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { compileVesselEvmSettlement } from './evm-settlement-build.mjs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SEPOLIA_CHAIN_ID = 11155111n;
const ACCEPTED_ASSET = 'ee'.repeat(32);

function requirePrivateKey() {
  const privateKey = process.env.EVM_DEPLOYER_PRIVATE_KEY || process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('Missing EVM_DEPLOYER_PRIVATE_KEY or SEPOLIA_DEPLOYER_PRIVATE_KEY in app/server/.env');
  }
  return privateKey;
}

async function main() {
  const rpcUrl = process.env.EVM_RPC || process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`EVM RPC must point to Sepolia ${SEPOLIA_CHAIN_ID}; received ${network.chainId}`);
  }

  const wallet = new Wallet(requirePrivateKey(), provider);
  const balance = await provider.getBalance(wallet.address);
  if (balance === 0n) {
    throw new Error(`EVM deployer ${wallet.address} has 0 Sepolia ETH. Faucet this address, then rerun.`);
  }

  const owner = process.env.EVM_MULTISIG_ADDRESS || wallet.address;
  const artifact = compileVesselEvmSettlement();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(owner);
  const tx = contract.deploymentTransaction();
  if (!tx?.hash) throw new Error('Deployment transaction hash was not returned');

  console.log(`Deploying VesselSettlement from ${wallet.address}`);
  console.log(`Owner/multisig: ${owner}`);
  console.log(`Transaction: ${tx.hash}`);
  await contract.waitForDeployment();
  const receipt = await tx.wait(1);
  const contractAddress = await contract.getAddress();

  const deployment = {
    chainId: Number(SEPOLIA_CHAIN_ID),
    contractAddress,
    vaultAddress: contractAddress,
    multisigAddress: owner,
    acceptedAsset: ACCEPTED_ASSET,
    deploymentTransaction: tx.hash,
    deploymentBlock: receipt?.blockNumber ?? null,
    deployerAddress: wallet.address,
    timelockSeconds: 0,
  };
  const outputDir = path.resolve(process.cwd(), 'deployments', 'evm');
  mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, 'vessel-settlement.sepolia.json');
  writeFileSync(outputFile, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`Contract: ${contractAddress}`);
  console.log(`Balance before deploy: ${formatEther(balance)} Sepolia ETH`);
  console.log(`Wrote ${path.relative(process.cwd(), outputFile)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

