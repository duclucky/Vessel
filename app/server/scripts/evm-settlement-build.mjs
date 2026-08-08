import { readFileSync } from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const CONTRACT_ROOT = path.resolve(process.cwd(), '..', '..', 'contracts', 'evm', 'vessel-settlement');
const CONTRACT_PATH = path.join(CONTRACT_ROOT, 'contracts', 'VesselSettlement.sol');
const CONTRACT_NAME = 'VesselSettlement';

export function compileVesselEvmSettlement({ contractPath = CONTRACT_PATH } = {}) {
  const source = readFileSync(contractPath, 'utf8');
  const input = {
    language: 'Solidity',
    sources: {
      'VesselSettlement.sol': {
        content: source,
      },
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors || [];
  const fatal = errors.filter((entry) => entry.severity === 'error');
  if (fatal.length) {
    throw new Error(fatal.map((entry) => entry.formattedMessage || entry.message).join('\n'));
  }
  const contract = output.contracts?.['VesselSettlement.sol']?.[CONTRACT_NAME];
  if (!contract?.abi || !contract?.evm?.bytecode?.object) {
    throw new Error('VesselSettlement compile output is missing ABI or bytecode');
  }
  return Object.freeze({
    contractName: CONTRACT_NAME,
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  });
}

