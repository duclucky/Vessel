import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Wallet } from 'ethers';

const envPath = path.resolve(process.cwd(), '.env');
const env = readFileSync(envPath, 'utf8');

if (/^EVM_DEPLOYER_PRIVATE_KEY=/m.test(env)) {
  throw new Error('EVM_DEPLOYER_PRIVATE_KEY already exists in app/server/.env');
}

const wallet = Wallet.createRandom();
appendFileSync(envPath, [
  '',
  `EVM_DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`,
  `EVM_DEPLOYER_ADDRESS=${wallet.address}`,
  `EVM_MULTISIG_ADDRESS=${wallet.address}`,
  'EVM_RPC=https://ethereum-sepolia-rpc.publicnode.com',
  'WALLET_EVM_ENABLED=false',
  '',
].join('\n'));

console.log(`EVM deployer address: ${wallet.address}`);

