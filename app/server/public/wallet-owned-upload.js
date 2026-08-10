import { createBatchUploadManifest } from './batch-upload.js';
import { normalizeAptosLikeAddress } from './address-utils.js';
import { oneApprovalBatchMessage, oneApprovalMessage } from './one-approval-session.js';

const noopRecovery = Object.freeze({
  save() {},
  advance() {},
  complete() {},
});

function uploadError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function walletKey(state) {
  const session = state?.status === 'ready' ? state.session : null;
  return session
    ? `${session.chain}:${session.sourceAddress}:${normalizeAptosLikeAddress(session.storageAddress)}`.toLowerCase()
    : '';
}

function normalizeSession(session) {
  return Object.freeze({
    ...session,
    storageAddress: normalizeAptosLikeAddress(session?.storageAddress),
  });
}

function deploymentFor(chain, quote, config) {
  const quoted = quote?.settlementDeployment;
  if (quoted?.chain) {
    return Object.freeze({
      ...quoted.chain,
      quotePublicKey: quoted.quotePublicKey,
      configVersion: quoted.configVersion,
    });
  }
  const deployments = config?.settlementContracts;
  if (!deployments?.enabled || !deployments[chain]) return null;
  return Object.freeze({
    ...deployments[chain],
    quotePublicKey: deployments.quotePublicKey,
    configVersion: deployments.configVersion,
  });
}

function recoveryQuote(record) {
  return Object.freeze({
    ...record.context,
    quoteId: record.quoteId || record.id,
    quoteToken: record.quoteToken,
    tierId: record.paymentTier,
    totalAccountingMicro: record.quotedAccountingMicro,
    storageAccountingMicro: record.storageCostAccountingMicro,
    gasAccountingMicro: record.gasAccountingMicro,
    serviceFeeAccountingMicro: record.serviceFeeAccountingMicro,
    solanaAmountMicro: record.quotedAccountingMicro,
    contractQuote: record.contractQuote,
    contractSignature: record.contractSignature,
    quotePublicKey: record.quotePublicKey,
    settlementDeployment: record.settlementDeployment,
  });
}

function sourceNetworkFor(session, config) {
  if (session.chain === 'aptos') {
    return config?.shelbyNetwork?.storageNetwork
      || config?.shelbyNetwork?.active
      || session.sourceNetwork
      || 'aptos-testnet';
  }
  if (session.chain === 'evm') return 'sepolia';
  return 'solana-devnet';
}

function storageNetworkFor(config) {
  return config?.shelbyNetwork?.storageNetwork
    || config?.shelbyNetwork?.active
    || 'shelby-testnet';
}

function positiveUnits(value) {
  const text = String(value ?? '0').trim();
  if (!/^\d+$/.test(text)) return 0n;
  return BigInt(text);
}

function oneApprovalEnabled(config, chain) {
  const beta = config?.oneApprovalBeta;
  if (!beta?.enabled) return false;
  const chains = Array.isArray(beta.chains) ? beta.chains.map((item) => String(item).toLowerCase()) : [];
  return chains.length === 0 || chains.includes(String(chain || '').toLowerCase());
}

async function assertAptosSettlementBalance({ request, session, quote, signal }) {
  const required = positiveUnits(
    quote?.nativeServiceFeeShelbyUsdUnits
      || quote?.contractQuote?.amount
      || 0,
  );
  if (required <= 0n) return;
  const balances = await request(`/api/shelby/accounts/${encodeURIComponent(session.sourceAddress)}/balances`, { signal });
  const balance = positiveUnits(balances?.shelbyUsdUnits);
  if (balance < required) {
    throw uploadError('Add testnet ShelbyUSD to continue', 'insufficient_shelby_usd', {
      required: required.toString(),
      balance: balance.toString(),
    });
  }
}

export function createWalletOwnedUploadService({
  request,
  controller,
  getSolana = () => null,
  recovery = noopRecovery,
  settleContractQuote,
  authorizeUploadSession,
  submitOneApprovalUpload,
  createUploadIntent,
  sha256FileHex,
  contentAddressedBlobName,
  now = Date.now,
} = {}) {
  for (const [name, dependency] of Object.entries({
    request,
    controller,
    settleContractQuote,
    createUploadIntent,
    sha256FileHex,
    contentAddressedBlobName,
  })) {
    if (typeof dependency !== 'function' && name !== 'controller') {
      throw new TypeError(`${name} dependency is required`);
    }
    if (name === 'controller' && !dependency) throw new TypeError('controller dependency is required');
  }

  const getController = () => (typeof controller === 'function' ? controller() : controller);
  const state = () => getController()?.getState?.() || {};
  const defaultAuthorizeUploadSession = (input) => {
    const signer = authorizeUploadSession || getController()?.authorizeUploadSession;
    if (typeof signer !== 'function') {
      throw uploadError('This wallet cannot create a one-approval upload session', 'one_approval_unavailable');
    }
    return signer(input);
  };
  const defaultSubmitOneApprovalUpload = ({ file: uploadFile, intent, quote, authorization, signal }) => {
    if (typeof submitOneApprovalUpload === 'function') {
      return submitOneApprovalUpload({ file: uploadFile, intent, quote, authorization, signal });
    }
    const form = new FormData();
    form.append('file', uploadFile);
    form.append('quoteToken', quote.quoteToken);
    form.append('uploadContext', JSON.stringify(intent));
    form.append('authorization', JSON.stringify(authorization));
    return request('/api/one-approval/uploads', {
      method: 'POST',
      signal,
      form,
    });
  };
  const defaultSubmitOneApprovalBatchUpload = ({ manifest, intent, quote, authorization, signal }) => {
    if (typeof submitOneApprovalUpload === 'function') {
      return submitOneApprovalUpload({ manifest, intent, quote, authorization, signal });
    }
    const form = new FormData();
    for (const item of manifest.items) {
      form.append('files', item.file, item.relativePath);
    }
    form.append('quoteToken', quote.quoteToken);
    form.append('uploadContext', JSON.stringify(intent));
    form.append('manifest', JSON.stringify({
      version: manifest.version,
      kind: manifest.kind,
      manifestHash: manifest.manifestHash,
      totalBytes: manifest.totalBytes,
      items: manifest.items.map((item) => ({
        relativePath: item.relativePath,
        fileHash: item.fileHash,
        blobName: item.blobName,
        sizeBytes: item.sizeBytes,
        contentType: item.contentType,
      })),
    }));
    form.append('authorization', JSON.stringify(authorization));
    return request('/api/one-approval/batch-uploads', {
      method: 'POST',
      signal,
      form,
    });
  };

  function requireSession() {
    const current = state();
    if (current.status !== 'ready' || !current.session) {
      throw uploadError('Connect a supported testnet wallet to continue', 'wallet_required');
    }
    return current;
  }

  function assertWallet(expectedKey) {
    const current = requireSession();
    if (walletKey(current) !== expectedKey) {
      throw uploadError('The connected wallet changed. Request a new quote.', 'wallet_changed');
    }
    return current;
  }

  async function loadConfig(signal) {
    const config = await request('/api/config', { signal });
    if (config?.shelbyWritesEnabled === false) {
      throw uploadError(
        'ShelbyNet beta writes are temporarily paused',
        'shelby_writes_paused',
        { retriable: true },
      );
    }
    return config || {};
  }

  async function quote(file, { days, signal } = {}) {
    if (!file) throw uploadError('Choose a file before uploading', 'file_required');
    const walletState = requireSession();
    const config = await loadConfig(signal);
    const maxBytes = config.maxUploadBytes || 25 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw uploadError(`File exceeds ${(maxBytes / 1048576) | 0}MB demo limit`, 'file_too_large');
    }
    const fileHash = await sha256FileHex(file);
    const blobName = contentAddressedBlobName(file, fileHash);
    const session = normalizeSession(walletState.session);
    const sourceNetwork = sourceNetworkFor(session, config);
    const storageNetwork = storageNetworkFor(config);
    const signedQuote = await request('/api/quotes/upload', {
      method: 'POST',
      signal,
      body: {
        operation: 'upload',
        chain: session.chain,
        sourceNetwork,
        storageNetwork,
        sourceAddress: session.sourceAddress,
        storageAddress: session.storageAddress,
        fileHash,
        blobName,
        sizeBytes: file.size,
        contentType: file.type || 'application/octet-stream',
        encoding: 0,
        days,
      },
    });
    assertWallet(walletKey(walletState));
    const uploadIntent = createUploadIntent({
      file,
      fileHash,
      blobName,
      session,
      days: signedQuote.days,
      serverTimeMs: signedQuote.serverTimeMs,
      encoding: signedQuote.encoding,
    });
    const intent = Object.freeze({ ...uploadIntent, sourceNetwork, storageNetwork });
    if (intent.expirationMicros !== signedQuote.expirationMicros) {
      throw uploadError('Quote expiration did not match the selected retention', 'quote_context_mismatch');
    }
    const result = Object.freeze({
      file,
      intent,
      quote: Object.freeze({ ...signedQuote }),
      config: Object.freeze({ ...config }),
      walletKey: walletKey(walletState),
    });
    recovery.save({
      id: signedQuote.quoteId,
      stage: 'quoted',
      walletIdentity: session,
      quoteId: signedQuote.quoteId,
      quoteToken: signedQuote.quoteToken,
      context: intent,
      paymentTier: signedQuote.tierId,
      quotedAccountingMicro: signedQuote.totalAccountingMicro,
      storageCostAccountingMicro: signedQuote.storageAccountingMicro,
      gasAccountingMicro: signedQuote.gasAccountingMicro,
      serviceFeeAccountingMicro: signedQuote.serviceFeeAccountingMicro,
      totalAccountingMicro: signedQuote.totalAccountingMicro,
      contractQuote: signedQuote.contractQuote,
      contractSignature: signedQuote.contractSignature,
      quotePublicKey: signedQuote.quotePublicKey,
      settlementDeployment: signedQuote.settlementDeployment,
    });
    return result;
  }

  async function quoteBatch(items, { days, signal } = {}) {
    const walletState = requireSession();
    const config = await loadConfig(signal);
    const session = normalizeSession(walletState.session);
    if (!oneApprovalEnabled(config, session.chain)) {
      throw uploadError('One-approval batch upload is unavailable for this wallet', 'one_approval_batch_unavailable');
    }
    const maxBytes = config.maxUploadBytes || 25 * 1024 * 1024;
    const manifest = await createBatchUploadManifest(items, {
      sha256FileHex,
      contentAddressedBlobName,
    });
    const oversized = manifest.items.find((item) => item.sizeBytes > maxBytes);
    if (oversized) {
      throw uploadError(`File exceeds ${(maxBytes / 1048576) | 0}MB demo limit`, 'file_too_large', {
        relativePath: oversized.relativePath,
      });
    }
    const sourceNetwork = sourceNetworkFor(session, config);
    const storageNetwork = storageNetworkFor(config);
    const signedQuote = await request('/api/quotes/upload', {
      method: 'POST',
      signal,
      body: {
        operation: 'upload',
        chain: session.chain,
        sourceNetwork,
        storageNetwork,
        sourceAddress: session.sourceAddress,
        storageAddress: session.storageAddress,
        fileHash: manifest.manifestHash,
        blobName: `batch/${manifest.manifestHash}.manifest.json`,
        sizeBytes: manifest.totalBytes,
        contentType: manifest.virtualFile.type,
        encoding: 0,
        days,
      },
    });
    assertWallet(walletKey(walletState));
    const uploadIntent = createUploadIntent({
      file: manifest.virtualFile,
      fileHash: manifest.manifestHash,
      blobName: `batch/${manifest.manifestHash}.manifest.json`,
      session,
      days: signedQuote.days,
      serverTimeMs: signedQuote.serverTimeMs,
      encoding: signedQuote.encoding,
    });
    const intent = Object.freeze({ ...uploadIntent, sourceNetwork, storageNetwork });
    const result = Object.freeze({
      file: manifest.virtualFile,
      manifest,
      intent,
      quote: Object.freeze({ ...signedQuote }),
      config: Object.freeze({ ...config }),
      walletKey: walletKey(walletState),
      batch: true,
    });
    recovery.save({
      id: signedQuote.quoteId,
      stage: 'quoted',
      walletIdentity: session,
      quoteId: signedQuote.quoteId,
      quoteToken: signedQuote.quoteToken,
      context: intent,
      paymentTier: signedQuote.tierId,
      quotedAccountingMicro: signedQuote.totalAccountingMicro,
      storageCostAccountingMicro: signedQuote.storageAccountingMicro,
      gasAccountingMicro: signedQuote.gasAccountingMicro,
      serviceFeeAccountingMicro: signedQuote.serviceFeeAccountingMicro,
      totalAccountingMicro: signedQuote.totalAccountingMicro,
      contractQuote: signedQuote.contractQuote,
      contractSignature: signedQuote.contractSignature,
      quotePublicKey: signedQuote.quotePublicKey,
      settlementDeployment: signedQuote.settlementDeployment,
    });
    return result;
  }

  async function validate(quoted, { signal } = {}) {
    if (!quoted?.intent || !quoted?.quote || !quoted?.file) {
      throw uploadError('A valid upload quote is required', 'quote_required');
    }
    assertWallet(quoted.walletKey);
    if (now() >= Number(quoted.quote.expiresAtMs)) {
      throw uploadError('Quote expired. Request a new quote.', 'quote_expired');
    }
    const currentHash = quoted.manifest
      ? (await createBatchUploadManifest(quoted.manifest.items, {
        sha256FileHex,
        contentAddressedBlobName,
      })).manifestHash
      : await sha256FileHex(quoted.file);
    if (currentHash !== quoted.intent.fileHash) {
      throw uploadError(
        quoted.manifest ? 'The selected folder changed after quoting' : 'The selected file changed after quoting',
        quoted.manifest ? 'batch_manifest_changed' : 'file_hash_changed',
      );
    }
    const validation = await request('/api/quotes/validate', {
      method: 'POST',
      signal,
      body: { ...quoted.intent, quoteToken: quoted.quote.quoteToken },
    });
    assertWallet(quoted.walletKey);
    recovery.complete(quoted.quote.quoteId);
    recovery.save({
      id: validation.quote.quoteId,
      stage: 'quoted',
      walletIdentity: state().session,
      quoteId: validation.quote.quoteId,
      quoteToken: validation.quote.quoteToken,
      context: quoted.intent,
      paymentTier: validation.quote.tierId,
      quotedAccountingMicro: validation.quote.totalAccountingMicro,
      storageCostAccountingMicro: validation.quote.storageAccountingMicro,
      gasAccountingMicro: validation.quote.gasAccountingMicro,
      serviceFeeAccountingMicro: validation.quote.serviceFeeAccountingMicro,
      totalAccountingMicro: validation.quote.totalAccountingMicro,
      contractQuote: validation.quote.contractQuote,
      contractSignature: validation.quote.contractSignature,
      quotePublicKey: validation.quote.quotePublicKey,
      settlementDeployment: validation.quote.settlementDeployment,
    });
    return Object.freeze({
      ...quoted,
      quote: Object.freeze({ ...validation.quote }),
      requiresConfirmation: Boolean(validation.requiresConfirmation),
    });
  }

  async function upload(validated, callbacks = {}) {
    if (!validated?.intent || !validated?.quote || !validated?.file) {
      throw uploadError('Validate the upload quote before uploading', 'quote_validation_required');
    }
    if (validated.requiresConfirmation) {
      throw uploadError('Review the updated price before continuing', 'price_confirmation_required');
    }
    const walletState = assertWallet(validated.walletKey);
    const session = normalizeSession(walletState.session);
    const controllerInstance = getController();
    const fileHash = await sha256FileHex(validated.file);
    if (fileHash !== validated.intent.fileHash) {
      throw uploadError('The selected file changed after quoting', 'file_hash_changed');
    }
    const config = validated.config || await loadConfig(callbacks.signal);
    let settlement = validated.settlement;

    if (!settlement && oneApprovalEnabled(config, session.chain)) {
      callbacks.onStep?.('sessionApproval');
      const message = oneApprovalMessage({ intent: validated.intent, quote: validated.quote });
      const authorization = await defaultAuthorizeUploadSession({
        message,
        intent: validated.intent,
        quote: validated.quote,
        session,
      });
      recovery.advance(validated.quote.quoteId, 'paid', {
        paymentSignature: authorization?.signature || authorization?.transactionId || authorization?.id,
      });
      callbacks.onStep?.('uploading');
      const result = await defaultSubmitOneApprovalUpload({
        file: validated.file,
        intent: validated.intent,
        quote: validated.quote,
        authorization: Object.freeze({
          ...authorization,
          message,
          chain: authorization?.chain || session.chain,
          address: authorization?.address || session.sourceAddress,
          storageAddress: session.storageAddress,
        }),
        signal: callbacks.signal,
      });
      recovery.complete(validated.quote.quoteId);
      return Object.freeze({
        ...result,
        contentType: validated.file.type || result.contentType,
        ownedByYou: false,
        authorizedByYou: true,
        paymentMode: 'one-approval-beta',
        sourceAddress: session.sourceAddress,
        storageAddress: session.storageAddress,
        quotedAccountingMicro: validated.quote.totalAccountingMicro,
        storageCostAccountingMicro: validated.quote.storageAccountingMicro,
        gasAccountingMicro: validated.quote.gasAccountingMicro,
        serviceFeeAccountingMicro: validated.quote.serviceFeeAccountingMicro,
        totalAccountingMicro: validated.quote.totalAccountingMicro,
        lastReconciledAt: now(),
      });
    }

    if (!settlement) {
      if (session.chain === 'solana') {
        const solana = getSolana?.();
        if (!solana?.available?.()) throw uploadError('Reconnect your Solana wallet', 'wallet_required');
        const required = Number(validated.quote.solanaAmountMicro || 0) / 1_000_000;
        const balance = await solana.usdcBalance();
        if (balance < required) {
          throw uploadError('Add testnet USDC to continue', 'insufficient_usdc', { required, balance });
        }
      }
      if (session.chain === 'aptos') {
        await assertAptosSettlementBalance({
          request,
          session,
          quote: validated.quote,
          signal: callbacks.signal,
        });
      }
      callbacks.onStep?.(validated.settlementTransactionId ? 'settlementPending' : 'settlementApproval');
      const deployment = deploymentFor(session.chain, validated.quote, config);
      if (!deployment) throw uploadError('Vessel settlement contract is not configured', 'settlement_unavailable');
      const chainClient = session.chain === 'aptos'
        ? controllerInstance.getAptosSettlementClient(deployment)
        : session.chain === 'evm'
          ? controllerInstance.getEvmSettlementClient(deployment)
          : controllerInstance.getSolanaSettlementClient(deployment);
      const verified = await settleContractQuote({
        quote: {
          ...validated.quote,
          uploadContext: validated.quote.uploadContext || validated.intent,
        },
        chainClient,
        request,
        transactionId: validated.settlementTransactionId,
        onSubmitted: ({ transactionId }) => {
          recovery.advance(validated.quote.quoteId, 'settlement_submitted', {
            settlementTransactionId: transactionId,
            quoteToken: validated.quote.quoteToken,
            contractQuote: validated.quote.contractQuote,
            contractSignature: validated.quote.contractSignature,
            quotePublicKey: validated.quote.quotePublicKey,
            settlementDeployment: deployment,
          });
          callbacks.onSubmitted?.({ transactionId });
          callbacks.onStep?.('settlementPending');
        },
      });
      const settlementHash = verified.receipt?.transactionId || validated.settlementTransactionId;
      settlement = Object.freeze({ ...verified, settlementHash });
      recovery.advance(validated.quote.quoteId, 'paid', {
        paidAuthorization: settlement.paidAuthorization,
        settlementHash,
        paymentSignature: settlementHash,
      });
      callbacks.onStep?.('receiptVerified');
    }

    const isAptos = session.chain === 'aptos' && session.mode === 'native';
    const solana = getSolana?.();
    const isSolana = session.chain === 'solana' && solana?.available?.() && config.sponsored;
    const isEvm = session.chain === 'evm' && session.mode === 'daa' && config.sponsored;
    if (!isAptos && !isSolana && !isEvm) {
      throw uploadError(`Uploads are unavailable for ${session.walletName || session.chain}`, 'upload_unavailable');
    }
    callbacks.onStep?.(isAptos ? 'encoding' : 'signing');
    const onCheckpoint = (stage, evidence = {}) => {
      recovery.advance(validated.quote.quoteId, stage, evidence);
      callbacks.onCheckpoint?.(stage, evidence);
    };
    try {
      const result = await controllerInstance.upload(validated.file, {
        quoteToken: validated.quote.quoteToken,
        paidAuthorization: settlement.paidAuthorization,
        expirationMicros: validated.quote.expirationMicros,
        expectedFileHash: validated.quote.fileHash || validated.intent.fileHash,
        paymentTier: validated.quote.tierId,
        uploadContext: validated.intent,
        contractQuote: validated.quote.contractQuote,
        contractSignature: validated.quote.contractSignature,
        onStep: callbacks.onStep,
        onCheckpoint,
      });
      onCheckpoint('active', {
        registerTransactionHash: result.transactionHash,
        actualStorageUnits: result.actualStorageUnits,
        actualGasUsed: result.actualGasUsed,
      });
      recovery.complete(validated.quote.quoteId);
      return Object.freeze({
        ...result,
        contentType: validated.file.type || result.contentType,
        ownedByYou: true,
        account: session.storageAddress,
        ...(isSolana ? { paidUsdc: Number(validated.quote.solanaAmountMicro) / 1_000_000 } : {}),
        ...(isEvm ? { paidWei: String(validated.quote.evmAmountWei || '0') } : {}),
        settlementHash: settlement.settlementHash,
        quotedAccountingMicro: validated.quote.totalAccountingMicro,
        storageCostAccountingMicro: validated.quote.storageAccountingMicro,
        gasAccountingMicro: validated.quote.gasAccountingMicro,
        serviceFeeAccountingMicro: validated.quote.serviceFeeAccountingMicro,
        totalAccountingMicro: validated.quote.totalAccountingMicro,
        lastReconciledAt: now(),
      });
    } catch (error) {
      if (error?.code === 'registration_evidence_missing') {
        onCheckpoint('recovery_required', { errorCode: error.code });
      }
      throw error;
    }
  }

  async function uploadBatch(validated, callbacks = {}) {
    if (!validated?.intent || !validated?.quote || !validated?.manifest) {
      throw uploadError('Validate the batch quote before uploading', 'quote_validation_required');
    }
    if (validated.requiresConfirmation) {
      throw uploadError('Review the updated price before continuing', 'price_confirmation_required');
    }
    const walletState = assertWallet(validated.walletKey);
    const session = normalizeSession(walletState.session);
    const config = validated.config || await loadConfig(callbacks.signal);
    if (!oneApprovalEnabled(config, session.chain)) {
      throw uploadError('One-approval batch upload is unavailable for this wallet', 'one_approval_batch_unavailable');
    }
    const refreshed = await createBatchUploadManifest(validated.manifest.items, {
      sha256FileHex,
      contentAddressedBlobName,
    });
    if (refreshed.manifestHash !== validated.manifest.manifestHash) {
      throw uploadError('The selected folder changed after quoting', 'batch_manifest_changed');
    }
    callbacks.onStep?.('sessionApproval');
    const message = oneApprovalBatchMessage({
      intent: validated.intent,
      quote: validated.quote,
      manifest: validated.manifest,
    });
    const authorization = await defaultAuthorizeUploadSession({
      message,
      intent: validated.intent,
      quote: validated.quote,
      session,
      manifest: validated.manifest,
    });
    recovery.advance(validated.quote.quoteId, 'paid', {
      paymentSignature: authorization?.signature || authorization?.transactionId || authorization?.id,
    });
    callbacks.onStep?.('uploading');
    const result = await defaultSubmitOneApprovalBatchUpload({
      manifest: validated.manifest,
      intent: validated.intent,
      quote: validated.quote,
      authorization: Object.freeze({
        ...authorization,
        message,
        chain: authorization?.chain || session.chain,
        address: authorization?.address || session.sourceAddress,
        storageAddress: session.storageAddress,
      }),
      signal: callbacks.signal,
    });
    recovery.complete(validated.quote.quoteId);
    return Object.freeze({
      ...result,
      ownedByYou: false,
      authorizedByYou: true,
      paymentMode: 'one-approval-beta-batch',
      sourceAddress: session.sourceAddress,
      storageAddress: session.storageAddress,
      quotedAccountingMicro: validated.quote.totalAccountingMicro,
      storageCostAccountingMicro: validated.quote.storageAccountingMicro,
      gasAccountingMicro: validated.quote.gasAccountingMicro,
      serviceFeeAccountingMicro: validated.quote.serviceFeeAccountingMicro,
      totalAccountingMicro: validated.quote.totalAccountingMicro,
      lastReconciledAt: now(),
    });
  }

  async function resume(file, record, callbacks = {}) {
    if (!record?.context || !record?.stage) throw uploadError('Recovery record is required', 'recovery_required');
    const current = requireSession();
    const expectedWallet = [
      record.context.chain,
      record.context.sourceAddress,
      normalizeAptosLikeAddress(record.context.storageAddress),
    ]
      .join(':').toLowerCase();
    if (walletKey(current) !== expectedWallet) throw uploadError('Reconnect the original wallet', 'wallet_changed');
    const hash = await sha256FileHex(file);
    if (hash !== record.context.fileHash) {
      throw uploadError('Selected file does not match the recovery SHA-256', 'file_hash_changed');
    }
    const config = await loadConfig(callbacks.signal);
    if (record.stage === 'registered' || record.stage === 'uploading' || record.stage === 'finalizing' || record.stage === 'recovery_required') {
      recovery.advance(record.id, 'uploading');
      await getController().resumeBlobWrite(file, record);
      recovery.advance(record.id, 'finalizing');
      const artifacts = await getController().listArtifacts();
      const matched = artifacts.find((item) => item.blobNameSuffix === record.context.blobName && item.isWritten);
      if (!matched) throw uploadError('Shelby acknowledgement is still pending', 'acknowledgement_pending', { retriable: true });
      recovery.complete(record.id);
      return Object.freeze({
        ...matched,
        ownedByYou: true,
        account: normalizeAptosLikeAddress(record.context.storageAddress),
      });
    }

    let settlement;
    if (record.stage === 'settlement_submitted') {
      const verified = await settleContractQuote({
        quote: {
          quoteToken: record.quoteToken,
          uploadContext: record.context,
          contractQuote: record.contractQuote,
          contractSignature: record.contractSignature,
          quotePublicKey: record.quotePublicKey,
        },
        transactionId: record.settlementTransactionId,
        request,
      });
      const settlementHash = verified.receipt?.transactionId || record.settlementTransactionId;
      settlement = Object.freeze({ ...verified, settlementHash });
      recovery.advance(record.id, 'paid', {
        paidAuthorization: verified.paidAuthorization,
        settlementHash,
        paymentSignature: settlementHash,
      });
    } else if (record.stage === 'paid' && record.paidAuthorization) {
      settlement = Object.freeze({
        paidAuthorization: record.paidAuthorization,
        settlementHash: record.settlementHash,
      });
    } else if (record.stage === 'paid' && oneApprovalEnabled(config, current.session.chain)) {
      // A one-approval request can fail after the wallet signature but before
      // the server returns its upload result. Retry through the same server
      // path; an empty settlement object would incorrectly route into the
      // wallet-owned three-transaction uploader.
      settlement = undefined;
    } else {
      throw uploadError('This recovery record cannot be resumed', 'recovery_stage_invalid');
    }
    return upload(Object.freeze({
      file,
      intent: Object.freeze({ ...record.context }),
      quote: recoveryQuote(record),
      config: Object.freeze({ ...config }),
      walletKey: expectedWallet,
      settlement,
      requiresConfirmation: false,
    }), callbacks);
  }

  return Object.freeze({ quote, quoteBatch, validate, upload, uploadBatch, resume });
}
