export const RECOVERY_KEY = 'vessel_recovery_v1';

const STAGES = new Set([
  'quoted',
  'settlement_submitted',
  'paid',
  'registered',
  'uploading',
  'committed',
  'finalizing',
  'active',
  'recovery_required',
]);
const CONTEXT_FIELDS = [
  'operation', 'chain', 'sourceNetwork', 'storageNetwork', 'sourceAddress',
  'storageAddress', 'fileHash', 'blobName', 'sizeBytes', 'contentType',
  'encoding', 'days', 'expirationMicros',
];
const EVIDENCE_FIELDS = [
  'quoteToken', 'paidAuthorization', 'settlementHash', 'paymentSignature',
  'settlementTransactionId',
  'contractQuote', 'contractSignature', 'quotePublicKey', 'settlementDeployment',
  'registerTransactionHash', 'acknowledgementHash', 'actualStorageUnits',
  'actualGasUsed', 'quotedAccountingMicro', 'errorCode',
  'storageCostAccountingMicro', 'gasAccountingMicro', 'serviceFeeAccountingMicro',
  'totalAccountingMicro',
  'paymentTier', 'commitTransactionHash', 'registrationUid', 'blobMerkleRoot',
];

const pick = (input, fields) => Object.fromEntries(
  fields.filter((field) => input?.[field] != null).map((field) => [field, input[field]]),
);

export function normalizeWalletIdentity(identity) {
  if (typeof identity === 'string') return identity.toLowerCase();
  return [identity?.chain, identity?.sourceAddress, identity?.storageAddress]
    .map((value) => String(value || '').toLowerCase())
    .join(':');
}

export function createRecoveryLedger(storage = globalThis.localStorage, now = Date.now) {
  const read = () => {
    try {
      const parsed = JSON.parse(storage.getItem(RECOVERY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (records) => storage.setItem(RECOVERY_KEY, JSON.stringify(records.slice(0, 30)));
  const fresh = (record) => {
    const age = now() - Number(record.updatedAtMs || record.createdAtMs || 0);
    return age <= (
      record.paidAuthorization || record.settlementTransactionId ? 86_400_000 : 300_000
    );
  };

  function save(checkpoint) {
    if (!STAGES.has(checkpoint?.stage)) throw new RangeError('Invalid recovery stage');
    const id = String(checkpoint.id || checkpoint.quoteId || '');
    if (!id) throw new TypeError('Recovery record id is required');
    const records = read();
    const existing = records.find((entry) => entry.id === id);
    if (checkpoint.stage === 'quoted' && existing && existing.stage !== 'quoted' && fresh(existing)) {
      return existing;
    }
    const timestamp = now();
    const record = Object.freeze({
      id,
      stage: checkpoint.stage,
      walletKey: normalizeWalletIdentity(checkpoint.walletIdentity),
      quoteId: String(checkpoint.quoteId || id),
      context: Object.freeze(pick(checkpoint.context, CONTEXT_FIELDS)),
      ...pick(checkpoint, EVIDENCE_FIELDS),
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
    });
    write([record, ...records.filter((entry) => entry.id !== id)]);
    return record;
  }

  function loadForWallet(identity) {
    const walletKey = normalizeWalletIdentity(identity);
    const records = read();
    const retained = records.filter(fresh);
    if (retained.length !== records.length) write(retained);
    return retained.filter((record) => record.walletKey === walletKey);
  }

  function advance(id, stage, evidence = {}) {
    if (!STAGES.has(stage)) throw new RangeError('Invalid recovery stage');
    let updated;
    const records = read().map((record) => {
      if (record.id !== id) return record;
      updated = Object.freeze({
        ...record,
        stage,
        ...pick(evidence, EVIDENCE_FIELDS),
        updatedAtMs: now(),
      });
      return updated;
    });
    if (!updated) throw new Error('Recovery record not found');
    write(records);
    return updated;
  }

  function complete(id) {
    write(read().filter((record) => record.id !== id));
  }

  return Object.freeze({ save, loadForWallet, advance, complete });
}
