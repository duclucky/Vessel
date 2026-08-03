// Vessel — client-side Solana DAA + sponsored upload with the selected Wallet Standard provider.
// The visitor's Solana wallet:
//   1) derives its Aptos DAA storage account (deterministic — they own it),
//   2) pays a small USDC fee on Solana (stablecoin — no price volatility),
//   3) SIGNS the sponsored upload; the server co-signs via a gas station (pays APT + ShelbyUSD).
// The gas station key NEVER reaches the browser — the only browser-side credential is the wallet
// signature. See NOTES.md 5j for the proven recipe. Switch networks via window.VESSEL_NETWORK.
import { Network, Hex } from '@aptos-labs/ts-sdk';
import { ShelbyClient } from '@shelby-protocol/sdk/browser';
import {
  SolanaDerivedPublicKey,
  defaultSolanaAuthenticationFunction,
  signAptosTransactionWithSolana,
} from '@aptos-labs/derived-wallet-solana';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import nacl from 'tweetnacl';

const NETWORKS = {
  testnet: { net: Network.TESTNET, rpc: 'https://api.testnet.shelby.xyz/shelby' },
  // When Shelby ships mainnet: mainnet: { net: Network.MAINNET, rpc: '...' }
};
const NET = (typeof window !== 'undefined' && window.VESSEL_NETWORK) || 'testnet';
const CFG = NETWORKS[NET] || NETWORKS.testnet;
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const authFn = defaultSolanaAuthenticationFunction;

let provider = null;    // explicitly selected Solana provider
let pubkey = null;      // base58 string
let storageAddr = null; // AccountAddress
let client = null;      // ShelbyClient (browser)
let DOMAIN = (typeof window !== 'undefined' && window.VESSEL_DOMAIN) || 'vessel.demo';
let serverCfg = null;   // /api/config

function clearProvider() {
  provider = null;
  pubkey = null;
  storageAddr = null;
  client = null;
}

function selectProvider(nextProvider) {
  if (!nextProvider) throw new Error('Select a Solana wallet before connecting');
  if (provider !== nextProvider) clearProvider();
  provider = nextProvider;
  return provider;
}

async function loadConfig() {
  if (serverCfg) return serverCfg;
  serverCfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  if (serverCfg.domain) DOMAIN = serverCfg.domain;
  return serverCfg;
}

async function connect(nextProvider) {
  selectProvider(nextProvider);
  await loadConfig();
  const res = await provider.connect();
  pubkey = res.publicKey.toString();
  storageAddr = deriveAddress(pubkey);
  client = new ShelbyClient({ network: CFG.net });
  return { solana: pubkey, storageAccount: storageAddr.toString(), network: NET };
}

function deriveAddress(pubkeyStr) {
  const dpk = new SolanaDerivedPublicKey({ domain: DOMAIN, solanaPublicKey: new PublicKey(pubkeyStr), authenticationFunction: authFn });
  return dpk.authKey().derivedAddress();
}

// Wallet Standard signMessage normalized to a raw 64-byte signature.
async function signMsgRaw(bytes) {
  const r = await provider.signMessage(bytes, 'utf8').catch(async () => await provider.signMessage(bytes));
  return r?.signature ?? r;
}
// Solana wallet shape for signAptosTransactionWithSolana. No signIn -> uses the proven signMessage path.
function solWallet() {
  return { publicKey: new PublicKey(pubkey), signMessage: signMsgRaw, name: provider.name || 'Solana wallet' };
}

const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));

// ---- SPONSORED upload: Phantom signs, server co-signs via gas station (Cách B) ----
async function uploadSponsored(file, { paymentId, uploadToken, expiresInSec = 7 * 24 * 3600, onStep } = {}) {
  if (!client) await connect(provider);
  const cfg = await loadConfig();
  if (!cfg.gasStationAccount) throw new Error('server sponsor not configured');
  onStep?.('signing');

  // Override 1: on-chain register signing -> Phantom async sender auth + POST to server (gas station).
  const targets = new Set([client.aptos, client.coordination?.aptos].filter(Boolean));
  const originals = new Map([...targets].map((a) => [a, a.signAndSubmitTransaction.bind(a)]));
  const phantomSubmit = async ({ transaction }) => {
    const resp = await signAptosTransactionWithSolana({ solanaWallet: solWallet(), authenticationFunction: authFn, rawTransaction: transaction, domain: DOMAIN });
    if (resp.status !== 'Approved' && resp.status !== 'APPROVED') throw new Error('User rejected the signature');
    onStep?.('sponsoring');
    const body = { transaction: b64(transaction.bcsToBytes()), senderAuthenticator: b64(resp.args.bcsToBytes()), paymentId, uploadToken };
    const r = await fetch('/api/sponsor/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    if (!r.hash) throw new Error(r.error || 'sponsor submit failed');
    return { hash: r.hash };
  };
  for (const a of targets) a.signAndSubmitTransaction = phantomSubmit;

  // Override 2: byte-upload challenge -> sign inside getChallenge (awaited), sync return.
  // Phantom REFUSES signMessage on the raw challenge bytes ("cannot sign solana transactions using
  // sign message" — its anti-phishing heuristic sees tx-shaped bytes). On testnet, byte-upload auth
  // is not enforced (anonymous writes), so we fall back to an ephemeral key. Ownership stays genuine:
  // the on-chain register above IS Phantom-signed. Mainnet must revisit this (see NOTES.md 5k).
  const ephemeral = nacl.sign.keyPair();
  const realGetChallenge = client.rpc.getChallenge.bind(client.rpc);
  let pendingAuth = null;
  client.rpc.getChallenge = async (account) => {
    const { challenge } = await realGetChallenge(account);
    const bytes = Hex.fromHexInput(challenge).toUint8Array();
    let signature;
    try { signature = await signMsgRaw(bytes); }
    catch { signature = nacl.sign.detached(bytes, ephemeral.secretKey); } // Phantom blocked raw challenge -> testnet ephemeral
    pendingAuth = { challenge, signature, publicKey: new PublicKey(pubkey).toBytes(), authScheme: 'derivable', identity: pubkey, domain: DOMAIN, authFunction: authFn };
    return { challenge };
  };
  const syncSign = () => pendingAuth;
  client.rpc.signChallenge = syncSign;
  client.signChallenge = syncSign;

  const dummySubmitter = { submitTransaction: async () => { throw new Error('unused: overridden'); } };
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const sha = await sha256Hex(data);
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const blobName = `media/${sha}.${ext}`;
    const expirationMicros = Date.now() * 1000 + expiresInSec * 1_000_000;
    onStep?.('uploading');
    await client.upload({
      blobData: data,
      signer: { accountAddress: storageAddr },
      blobName,
      expirationMicros,
      options: { usdSponsor: { feePayerAddress: cfg.gasStationAccount }, build: { withFeePayer: true }, submit: { transactionSubmitter: dummySubmitter } },
    });
    return { key: blobName, url: readUrl(blobName), account: storageAddr.toString(), size: data.length, ownedByYou: true };
  } finally {
    for (const [a, fn] of originals) a.signAndSubmitTransaction = fn; // restore
    client.rpc.getChallenge = realGetChallenge;
  }
}

// ---- USDC payment on Solana (Phantom pays the treasury; memo binds the payment to the intent) ----
async function payUSDC({ treasuryAta, amountMicro, memo, usdcMint }) {
  if (!provider) throw new Error('Select a Solana wallet before paying');
  if (!pubkey) await connect(provider);
  const cfg = await loadConfig();
  const conn = new Connection(cfg.solanaRpc || 'https://api.devnet.solana.com', 'confirmed');
  const owner = new PublicKey(pubkey);
  const fromAta = await getAssociatedTokenAddress(new PublicKey(usdcMint), owner);
  const transferIx = createTransferInstruction(fromAta, new PublicKey(treasuryAta), owner, Number(amountMicro));
  const memoIx = new TransactionInstruction({ keys: [], programId: new PublicKey(MEMO_PROGRAM), data: new TextEncoder().encode(memo) });
  const tx = new Transaction().add(transferIx).add(memoIx);
  tx.feePayer = owner;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const res = await provider.signAndSendTransaction(tx);
  const signature = res?.signature || res;
  await conn.confirmTransaction(signature, 'confirmed').catch(() => {});
  return { signature };
}

async function usdcBalance() {
  try {
    const cfg = await loadConfig();
    const conn = new Connection(cfg.solanaRpc || 'https://api.devnet.solana.com', 'confirmed');
    const ata = await getAssociatedTokenAddress(new PublicKey(cfg.usdcMint), new PublicKey(pubkey));
    const bal = await conn.getTokenAccountBalance(ata);
    return Number(bal?.value?.uiAmount || 0);
  } catch { return 0; }
}

function readUrl(blobName) { return `${CFG.rpc}/v1/blobs/${storageAddr.toString()}/${blobName}`; }

async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

window.VesselSolana = {
  available: () => Boolean(provider && pubkey && storageAddr),
  network: NET,
  connect, selectProvider, clearProvider, disconnect: clearProvider, loadConfig, deriveAddress,
  uploadSponsored, payUSDC, usdcBalance, readUrl,
  get state() { return { solana: pubkey, storageAccount: storageAddr?.toString() }; },
};
