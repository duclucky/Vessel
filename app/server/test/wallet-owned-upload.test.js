import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletOwnedUploadService } from '../public/wallet-owned-upload.js';

const HASH = 'ab'.repeat(32);
const STORAGE = `0x${'33'.repeat(32)}`;
const file = Object.freeze({
  name: '001.json',
  type: 'application/json',
  size: 42,
  arrayBuffer: async () => new Uint8Array(42).buffer,
});

const sessionFor = (chain = 'aptos') => Object.freeze({
  chain,
  mode: chain === 'aptos' ? 'native' : 'daa',
  sourceAddress: chain === 'aptos'
    ? `0x${'22'.repeat(32)}`
    : chain === 'evm' ? '0x1234567890abcdef1234567890abcdef12345678' : 'solana-wallet',
  storageAddress: STORAGE,
  walletName: chain === 'aptos' ? 'Petra' : chain === 'evm' ? 'MetaMask' : 'Phantom',
});

function fixture({
  chain = 'aptos',
  writes = true,
  pendingOnce = false,
  shelbyNetwork,
  oneApprovalBeta,
  balances = { aptOctas: 1_000_000, shelbyUsdUnits: 1_000_000 },
} = {}) {
  let session = sessionFor(chain);
  const requests = [];
  const recoveryCalls = [];
  let settlementCalls = 0;
  let walletUploadCalls = 0;
  let authorizationCalls = 0;
  let oneApprovalUploadCalls = 0;
  let pending = pendingOnce;
  const quote = Object.freeze({
    quoteId: 'quote-1',
    quoteToken: 'signed-quote',
    days: 30,
    serverTimeMs: 1_800_000_000_000,
    expiresAtMs: 1_800_000_060_000,
    expirationMicros: 1_802_592_000_000_000,
    encoding: 0,
    tierId: 1,
    nativeServiceFeeShelbyUsdUnits: '150100',
    totalAccountingMicro: '10000',
    storageAccountingMicro: '6000',
    gasAccountingMicro: '3000',
    serviceFeeAccountingMicro: '1000',
    solanaAmountMicro: '10000',
    fileHash: HASH,
    contractQuote: { quoteId: 'quote-1' },
    contractSignature: 'signature',
    quotePublicKey: 'public-key',
    settlementDeployment: {
      chain: chain === 'aptos'
        ? { moduleAddress: `0x${'44'.repeat(32)}` }
        : chain === 'evm' ? { contractAddress: '0x1234567890abcdef1234567890abcdef12345678' } : { programId: 'program' },
      configVersion: '1',
      quotePublicKey: 'public-key',
    },
  });
  const controller = {
    getState: () => ({ status: 'ready', session }),
    getAptosSettlementClient: () => ({ chain: 'aptos' }),
    getSolanaSettlementClient: () => ({ chain: 'solana' }),
    getEvmSettlementClient: () => ({ chain: 'evm' }),
    upload: async (_file, options) => {
      walletUploadCalls += 1;
      options.onCheckpoint('registered', { registerTransactionHash: 'register-tx' });
      return {
        key: `media/${HASH}.json`,
        url: `https://example.test/api/shelby/blobs/${STORAGE}/media/${HASH}.json`,
        size: file.size,
        transactionHash: 'register-tx',
        paymentMode: chain === 'evm' ? 'evm-sepolia' : chain === 'solana' ? 'solana-usdc' : 'native-aptos',
      };
    },
  };
  const recovery = {
    save: (value) => recoveryCalls.push(['save', value.stage]),
    advance: (_id, stage) => recoveryCalls.push(['advance', stage]),
    complete: () => recoveryCalls.push(['complete']),
  };
  const request = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === '/api/config') return {
      shelbyWritesEnabled: writes,
      maxUploadBytes: 25 * 1024 * 1024,
      shelbyNetwork,
      sponsored: true,
      settlementContracts: {
        enabled: true,
        quotePublicKey: 'public-key',
        configVersion: '1',
        [chain]: quote.settlementDeployment.chain,
      },
      oneApprovalBeta,
    };
    if (path === '/api/quotes/upload') return quote;
    if (path === '/api/quotes/validate') return { quote, requiresConfirmation: false };
    if (path.startsWith('/api/shelby/accounts/')) return balances;
    throw new Error(`Unexpected request: ${path}`);
  };
  const service = createWalletOwnedUploadService({
    request,
    controller,
    getSolana: () => ({ available: () => true, usdcBalance: async () => 1 }),
    recovery,
    settleContractQuote: async ({ onSubmitted, transactionId }) => {
      settlementCalls += 1;
      const id = transactionId || `${chain}-settlement-tx`;
      if (!transactionId) onSubmitted?.({ transactionId: id });
      if (pending) {
        pending = false;
        throw Object.assign(new Error('Receipt pending'), { code: 'receipt_pending' });
      }
      return { paidAuthorization: 'paid-auth', receipt: { transactionId: id } };
    },
    authorizeUploadSession: async ({ message, intent, manifest }) => {
      authorizationCalls += 1;
      assert.match(message, /VESSEL_(BATCH_)?UPLOAD_SESSION/);
      assert.equal(intent.fileHash, manifest ? manifest.manifestHash : HASH);
      return {
        message,
        signature: 'wallet-session-signature',
        address: session.sourceAddress,
        chain: session.chain,
      };
    },
    submitOneApprovalUpload: async ({ authorization, intent, manifest }) => {
      oneApprovalUploadCalls += 1;
      assert.equal(authorization.signature, 'wallet-session-signature');
      assert.equal(intent.fileHash, manifest ? manifest.manifestHash : HASH);
      if (manifest) {
        return {
          items: manifest.items.map((item) => ({
            key: item.blobName,
            url: `https://example.test/api/media/${item.blobName}`,
            size: item.sizeBytes,
            contentType: item.contentType,
            sourcePath: item.relativePath,
          })),
          account: `0x${'55'.repeat(32)}`,
          authorizationId: 'one-approval-batch-auth-1',
        };
      }
      return {
        key: `media/${HASH}.json`,
        url: `https://example.test/api/media/media/${HASH}.json`,
        size: file.size,
        contentType: file.type,
        account: `0x${'55'.repeat(32)}`,
        authorizationId: 'one-approval-auth-1',
      };
    },
    createUploadIntent: (input) => Object.freeze({
      operation: 'upload',
      chain: input.session.chain,
      sourceAddress: input.session.sourceAddress,
      storageAddress: input.session.storageAddress,
      fileHash: input.fileHash,
      blobName: input.blobName,
      sizeBytes: input.file.size,
      contentType: input.file.type,
      encoding: input.encoding,
      days: input.days,
      expirationMicros: quote.expirationMicros,
    }),
    sha256FileHex: async () => HASH,
    contentAddressedBlobName: () => `media/${HASH}.json`,
    now: () => 1_800_000_001_000,
  });
  return {
    service,
    requests,
    recoveryCalls,
    quote,
    get settlementCalls() { return settlementCalls; },
    get walletUploadCalls() { return walletUploadCalls; },
    get authorizationCalls() { return authorizationCalls; },
    get oneApprovalUploadCalls() { return oneApprovalUploadCalls; },
    changeSession(next) { session = next; },
  };
}

test('service blocks before quote when Shelby writes are paused', async () => {
  const flow = fixture({ writes: false });
  await assert.rejects(
    () => flow.service.quote(file, { days: 30 }),
    (error) => error.code === 'shelby_writes_paused',
  );
  assert.equal(flow.requests.some((entry) => entry.path === '/api/quotes/upload'), false);
});

test('service settles, registers, and writes one immutable Aptos file context', async () => {
  const flow = fixture();
  const quoted = await flow.service.quote(file, { days: 30 });
  const validated = await flow.service.validate(quoted);
  const result = await flow.service.upload(validated);

  assert.equal(Object.isFrozen(quoted), true);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.ownedByYou, true);
  assert.equal(result.account, STORAGE);
  assert.equal(result.storageCostAccountingMicro, '6000');
  assert.equal(result.gasAccountingMicro, '3000');
  assert.equal(result.serviceFeeAccountingMicro, '1000');
  assert.equal(result.totalAccountingMicro, '10000');
  assert.equal(flow.settlementCalls, 1);
  assert.equal(flow.walletUploadCalls, 1);
  assert.deepEqual(flow.recoveryCalls.at(-1), ['complete']);
});

test('one-approval beta uploads through a bounded session authorization instead of three wallet transactions', async () => {
  const flow = fixture({
    oneApprovalBeta: { enabled: true, chains: ['aptos', 'solana', 'evm'] },
  });
  const result = await flow.service.upload(
    await flow.service.validate(await flow.service.quote(file, { days: 30 })),
  );

  assert.equal(result.authorizedByYou, true);
  assert.equal(result.ownedByYou, false);
  assert.equal(result.paymentMode, 'one-approval-beta');
  assert.equal(result.account, `0x${'55'.repeat(32)}`);
  assert.equal(result.quotedAccountingMicro, '10000');
  assert.equal(result.storageCostAccountingMicro, '6000');
  assert.equal(result.gasAccountingMicro, '3000');
  assert.equal(result.serviceFeeAccountingMicro, '1000');
  assert.equal(flow.authorizationCalls, 1);
  assert.equal(flow.oneApprovalUploadCalls, 1);
  assert.equal(flow.settlementCalls, 0);
  assert.equal(flow.walletUploadCalls, 0);
});

test('one-approval beta batch signs one manifest session for multiple files', async () => {
  const flow = fixture({
    oneApprovalBeta: { enabled: true, chains: ['aptos', 'solana', 'evm'] },
  });
  const secondFile = Object.freeze({
    name: '002.json',
    type: 'application/json',
    size: 58,
    arrayBuffer: async () => new Uint8Array(58).buffer,
  });
  const batch = await flow.service.quoteBatch([
    { file, relativePath: 'collection/001.json', fileHash: HASH, blobName: `media/${HASH}.json`, size: file.size },
    { file: secondFile, relativePath: 'collection/002.json', fileHash: 'cd'.repeat(32), blobName: `media/${'cd'.repeat(32)}.json`, size: secondFile.size },
  ], { days: 30 });
  const result = await flow.service.uploadBatch(await flow.service.validate(batch));

  assert.equal(result.authorizedByYou, true);
  assert.equal(result.paymentMode, 'one-approval-beta-batch');
  assert.equal(result.items.length, 2);
  assert.equal(flow.authorizationCalls, 1);
  assert.equal(flow.oneApprovalUploadCalls, 1);
  assert.equal(flow.settlementCalls, 0);
  assert.equal(flow.walletUploadCalls, 0);
  const quoteBody = flow.requests.find((entry) => entry.path === '/api/quotes/upload').options.body;
  assert.equal(quoteBody.sizeBytes, 100);
  assert.equal(quoteBody.contentType, 'application/vnd.vessel.batch-manifest+json');
});

test('failed one-approval server upload retries through one approval instead of direct wallet transactions', async () => {
  const flow = fixture({
    oneApprovalBeta: { enabled: true, chains: ['aptos', 'solana', 'evm'] },
  });
  const session = sessionFor('aptos');
  const record = Object.freeze({
    id: flow.quote.quoteId,
    quoteId: flow.quote.quoteId,
    quoteToken: flow.quote.quoteToken,
    stage: 'paid',
    paymentSignature: 'previous-wallet-session-signature',
    paymentTier: flow.quote.tierId,
    quotedAccountingMicro: flow.quote.totalAccountingMicro,
    storageCostAccountingMicro: flow.quote.storageAccountingMicro,
    gasAccountingMicro: flow.quote.gasAccountingMicro,
    serviceFeeAccountingMicro: flow.quote.serviceFeeAccountingMicro,
    contractQuote: flow.quote.contractQuote,
    contractSignature: flow.quote.contractSignature,
    quotePublicKey: flow.quote.quotePublicKey,
    settlementDeployment: flow.quote.settlementDeployment,
    context: Object.freeze({
      operation: 'upload',
      chain: session.chain,
      sourceAddress: session.sourceAddress,
      storageAddress: session.storageAddress,
      fileHash: HASH,
      blobName: `media/${HASH}.json`,
      sizeBytes: file.size,
      contentType: file.type,
      encoding: 0,
      days: flow.quote.days,
      expirationMicros: flow.quote.expirationMicros,
    }),
  });

  const result = await flow.service.resume(file, record);

  assert.equal(result.paymentMode, 'one-approval-beta');
  assert.equal(flow.authorizationCalls, 1);
  assert.equal(flow.oneApprovalUploadCalls, 1);
  assert.equal(flow.settlementCalls, 0);
  assert.equal(flow.walletUploadCalls, 0);
});

test('Aptos contract upload checks ShelbyUSD before opening Petra', async () => {
  const flow = fixture({ balances: { aptOctas: 1_000_000, shelbyUsdUnits: 0 } });
  const validated = await flow.service.validate(await flow.service.quote(file, { days: 30 }));
  await assert.rejects(
    () => flow.service.upload(validated),
    (error) => error.code === 'insufficient_shelby_usd'
      && /ShelbyUSD/.test(error.message)
      && Number(error.required) === 150100
      && Number(error.balance) === 0,
  );
  assert.equal(flow.settlementCalls, 0);
  assert.equal(flow.requests.some((entry) => entry.path.startsWith('/api/shelby/accounts/')), true);
});

test('quote context follows the active ShelbyNet runtime instead of Aptos Testnet labels', async () => {
  const flow = fixture({
    shelbyNetwork: {
      active: 'shelbynet',
      storageNetwork: 'shelbynet',
      aptos: { name: 'shelbynet', chainId: 118 },
    },
  });

  const quoted = await flow.service.quote(file, { days: 30 });
  const body = flow.requests.find((entry) => entry.path === '/api/quotes/upload').options.body;

  assert.equal(body.sourceNetwork, 'shelbynet');
  assert.equal(body.storageNetwork, 'shelbynet');
  assert.equal(quoted.intent.sourceNetwork, 'shelbynet');
  assert.equal(quoted.intent.storageNetwork, 'shelbynet');
});

test('wallet changes invalidate a quote before validation', async () => {
  const flow = fixture();
  const quoted = await flow.service.quote(file, { days: 30 });
  flow.changeSession({ ...sessionFor('aptos'), sourceAddress: `0x${'99'.repeat(32)}` });
  await assert.rejects(
    () => flow.service.validate(quoted),
    (error) => error.code === 'wallet_changed',
  );
  assert.equal(flow.settlementCalls, 0);
});

test('Solana DAA routes through the Solana settlement client and wallet-owned uploader', async () => {
  const flow = fixture({ chain: 'solana' });
  const result = await flow.service.upload(
    await flow.service.validate(await flow.service.quote(file, { days: 30 })),
  );
  assert.equal(result.account, STORAGE);
  assert.equal(result.paidUsdc, 0.01);
  assert.equal(flow.settlementCalls, 1);
  assert.equal(flow.walletUploadCalls, 1);
});

test('Ethereum DAA uses Sepolia settlement and cross-chain ShelbyNet upload', async () => {
  const flow = fixture({ chain: 'evm' });

  const quoted = await flow.service.quote(file, { days: 30 });
  const body = flow.requests.find((entry) => entry.path === '/api/quotes/upload').options.body;
  const result = await flow.service.upload(await flow.service.validate(quoted));

  assert.equal(body.chain, 'evm');
  assert.equal(body.sourceNetwork, 'sepolia');
  assert.equal(result.account, STORAGE);
  assert.equal(result.paymentMode, 'evm-sepolia');
  assert.equal(flow.settlementCalls, 1);
  assert.equal(flow.walletUploadCalls, 1);
});

test('resume checks an existing pending receipt without submitting another settlement', async () => {
  const flow = fixture({ pendingOnce: true });
  const validated = await flow.service.validate(await flow.service.quote(file, { days: 30 }));
  await assert.rejects(() => flow.service.upload(validated), (error) => error.code === 'receipt_pending');
  const record = {
    id: flow.quote.quoteId,
    quoteId: flow.quote.quoteId,
    quoteToken: flow.quote.quoteToken,
    stage: 'settlement_submitted',
    settlementTransactionId: 'aptos-settlement-tx',
    context: validated.intent,
    contractQuote: flow.quote.contractQuote,
    contractSignature: flow.quote.contractSignature,
    quotePublicKey: flow.quote.quotePublicKey,
    settlementDeployment: flow.quote.settlementDeployment,
    quotedAccountingMicro: flow.quote.totalAccountingMicro,
    storageCostAccountingMicro: flow.quote.storageAccountingMicro,
    gasAccountingMicro: flow.quote.gasAccountingMicro,
    serviceFeeAccountingMicro: flow.quote.serviceFeeAccountingMicro,
    totalAccountingMicro: flow.quote.totalAccountingMicro,
    paymentTier: flow.quote.tierId,
  };
  const result = await flow.service.resume(file, record);
  assert.equal(result.ownedByYou, true);
  assert.equal(result.storageCostAccountingMicro, '6000');
  assert.equal(result.gasAccountingMicro, '3000');
  assert.equal(result.serviceFeeAccountingMicro, '1000');
  assert.equal(flow.settlementCalls, 2);
  assert.equal(flow.walletUploadCalls, 1);
});
