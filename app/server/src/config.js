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
  ipfsGateway: process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/',
  // Optional: same asset pinned to IPFS for a fair latency comparison. If unset → ipfs = null.
  ipfsCompareCid: process.env.IPFS_COMPARE_CID || '',
  // USDC payments (customer pays the app; app sponsors Aptos fees).
  solanaRpc: process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
  treasurySecretKey: process.env.SOLANA_TREASURY_SECRET_KEY || '',
  usdcMint: process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  priceBaseUsdc: Number(process.env.PRICE_BASE_USDC || 0.01),
  pricePerMbUsdc: Number(process.env.PRICE_PER_MB_USDC || 0.01),
  gasStationAccount: process.env.GAS_STATION_ACCOUNT || '', // PUBLIC fee-payer acct that sponsors gas+ShelbyUSD
  gasStationApiKey: process.env.GAS_STATION_API_KEY || '',  // SERVER-ONLY: never sent to the browser
  paySecret: process.env.PAY_SECRET || 'vessel-dev-secret', // SERVER-ONLY: HMAC secret for payment tokens
};
