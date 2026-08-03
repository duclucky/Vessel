import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8787),
  publicBase: process.env.PUBLIC_BASE || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT || 8787}`),
  storageBackend: process.env.STORAGE_BACKEND || 'mock', // mock | shelby
  network: process.env.SHELBY_NETWORK || 'testnet',
  shelbyApiKey: process.env.SHELBY_API_KEY || '',
  // Testnet Solana-DAA storage identity (server-held keypair; the account that owns the blobs).
  shelbySolanaSecretKey: process.env.SHELBY_SOLANA_SECRET_KEY || '',
  daaDomain: process.env.DAPP_DOMAIN || 'vessel.demo',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024), // 25 MB
  defaultStorageDays: Number(process.env.DEFAULT_STORAGE_DAYS || 30),
  ipfsGateway: process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/',
  // Optional: same asset pinned to IPFS for a fair latency comparison. If unset → ipfs = null.
  ipfsCompareCid: process.env.IPFS_COMPARE_CID || '',
  // USDC payments (customer pays the app; app sponsors Aptos fees).
  solanaRpc: process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
  treasurySecretKey: process.env.SOLANA_TREASURY_SECRET_KEY || '',
  usdcMint: process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  walletAptosEnabled: process.env.WALLET_APTOS_ENABLED !== 'false',
  walletSolanaEnabled: process.env.WALLET_SOLANA_ENABLED !== 'false',
  gasStationAccount: process.env.GAS_STATION_ACCOUNT || '', // PUBLIC fee-payer acct that sponsors gas+ShelbyUSD
  gasStationApiKey: process.env.GAS_STATION_API_KEY || '',  // SERVER-ONLY: never sent to the browser
  dynamicQuotesEnabled: process.env.DYNAMIC_QUOTES_ENABLED === 'true',
  settlementContractsEnabled: process.env.SETTLEMENT_CONTRACTS_ENABLED === 'true',
  settlementDeploymentsFile: process.env.SETTLEMENT_DEPLOYMENTS_FILE || '../../deployments/vessel-settlement.testnet.json',
  quoteSignerPrivateKeyBase64: process.env.QUOTE_SIGNER_PRIVATE_KEY_B64 || '',
  quoteSignerPublicKeyHex: process.env.QUOTE_SIGNER_PUBLIC_KEY_HEX || '',
  paySecret: process.env.PAY_SECRET || '', // SERVER-ONLY: HMAC secret for quote/payment tokens
  aptUsdReferenceMicros: BigInt(process.env.APT_USD_REFERENCE_MICROS || '5000000'),
  registerGasUnitsEstimate: BigInt(process.env.REGISTER_GAS_UNITS_ESTIMATE || '7000'),
  gasSafetyBps: BigInt(process.env.GAS_SAFETY_BPS || '12000'),
  aptosTreasuryAddress: process.env.APTOS_TREASURY_ADDRESS || process.env.GAS_STATION_ACCOUNT || '',
  telemetryWalletSalt: process.env.TELEMETRY_WALLET_SALT || process.env.PAY_SECRET || '',
};
