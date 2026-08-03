// Stable browser entrypoint. All payment authorization comes from a finalized
// Vessel contract/program receipt; direct wallet-to-wallet transfers are not supported.
export { settleContractQuote } from './contract-settlement-client.js';
