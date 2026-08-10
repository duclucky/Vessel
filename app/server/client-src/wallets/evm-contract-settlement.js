import { BrowserProvider, Contract } from 'ethers';

const SEPOLIA_CHAIN_ID = 11155111n;
const ABI = [
  'function settle((uint8 version,uint8 chain,uint32 network,bytes32 quoteId,bytes32 payer,bytes32 storageAddress,bytes32 asset,uint64 amount,bytes32 fileHash,uint16 retentionDays,uint64 storageExpirationMicros,uint64 quoteExpiresAtSecs,uint64 configVersion) quote, bytes signature) payable',
];

const settlementError = (message, code = 'invalid_contract_settlement') => Object.assign(
  new Error(message),
  { code, retriable: false },
);

const bytes32 = (value) => `0x${String(value || '').trim().toLowerCase().replace(/^@/, '').replace(/^0x/, '')}`;
const quoteTuple = (quote) => ({
  version: Number(quote.version),
  chain: Number(quote.chain),
  network: Number(quote.network),
  quoteId: bytes32(quote.quoteId),
  payer: bytes32(quote.payer),
  storageAddress: bytes32(quote.storageAddress),
  asset: bytes32(quote.asset),
  amount: BigInt(quote.amount),
  fileHash: bytes32(quote.fileHash),
  retentionDays: Number(quote.retentionDays),
  storageExpirationMicros: BigInt(quote.storageExpirationMicros),
  quoteExpiresAtSecs: BigInt(quote.quoteExpiresAtSecs),
  configVersion: BigInt(quote.configVersion),
});

export async function submitEvmContractSettlement({
  provider,
  deployment,
  contractQuote,
  contractSignature,
}) {
  if (!provider?.request) throw settlementError('Reconnect the selected EVM wallet', 'settlement_unavailable');
  if (Number(contractQuote?.chain) !== 3 || Number(contractQuote?.network) !== Number(deployment?.chainId)) {
    throw settlementError('The quote does not target Ethereum Sepolia', 'settlement_context_mismatch');
  }
  if (!deployment?.contractAddress) {
    throw settlementError('Vessel Sepolia settlement contract is not deployed', 'settlement_unavailable');
  }
  const browserProvider = new BrowserProvider(provider);
  const network = await browserProvider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
    } catch (error) {
      throw settlementError('Switch your EVM wallet to Sepolia', 'switch_unsupported', error);
    }
  }
  const signer = await browserProvider.getSigner();
  const contract = new Contract(deployment.contractAddress, ABI, signer);
  const tx = await contract.settle(quoteTuple(contractQuote), bytes32(contractSignature), {
    value: BigInt(contractQuote.amount),
  });
  if (!tx?.hash) throw settlementError('EVM wallet did not return a transaction hash', 'settlement_submission_failed');
  return { transactionId: tx.hash };
}
