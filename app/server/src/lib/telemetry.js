import crypto from 'node:crypto';

const ERROR_CODES = new Set([
  'pricing_unavailable',
  'quote_drift',
  'payment_verification_failed',
  'sponsor_failed',
  'acknowledgement_timeout',
]);

const sizeBucket = (value) => {
  const size = Number(value || 0);
  if (size < 1_048_576) return '<1mb';
  if (size <= 5 * 1_048_576) return '1-5mb';
  if (size <= 25 * 1_048_576) return '5-25mb';
  return '>25mb';
};

const present = (value) => value !== undefined && value !== null && value !== '';
const publicDetail = (value) => String(value || '')
  .replace(/aptoslabs_[A-Za-z0-9_~-]+/g, 'aptoslabs_[redacted]')
  .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
  .slice(0, 1200);

export function createTelemetry({ write, walletSalt, now = Date.now } = {}) {
  const salt = String(walletSalt || '');
  const ref = (value) => crypto.createHash('sha256')
    .update(`${salt}:${String(value || '').toLowerCase()}`)
    .digest('hex')
    .slice(0, 12);
  const emit = write || ((row) => {
    const line = JSON.stringify(row);
    if (row.severity === 'error') console.error(line);
    else console.log(line);
  });

  function operation(event = {}) {
    const severity = ERROR_CODES.has(event.errorCode) || event.severity === 'error'
      ? 'error'
      : 'info';
    const row = {
      timestamp: new Date(now()).toISOString(),
      severity,
      stage: String(event.stage || 'unknown'),
      operation: String(event.operation || 'unknown'),
      network: String(event.network || 'unknown'),
    };
    if (present(event.wallet)) row.walletRef = ref(event.wallet);
    if (present(event.storageAddress)) row.storageRef = ref(event.storageAddress);
    if (present(event.durationDays)) row.durationDays = Number(event.durationDays);
    if (present(event.sizeBytes)) row.sizeBucket = sizeBucket(event.sizeBytes);
    if (present(event.chain)) row.chain = String(event.chain);
    if (present(event.deploymentId)) row.deploymentId = String(event.deploymentId);
    if (present(event.quoteId)) row.quoteRef = ref(event.quoteId);
    if (present(event.configVersion)) row.configVersion = String(event.configVersion);
    if (present(event.finalityLatencyMs)) {
      row.finalityLatencyMs = Math.max(0, Math.trunc(Number(event.finalityLatencyMs)));
    }
    if (present(event.quotedMicro)) row.quotedMicro = String(event.quotedMicro);
    if (present(event.actualStorageUnits)) row.actualStorageUnits = String(event.actualStorageUnits);
    if (present(event.actualGasUsed)) row.actualGasUsed = String(event.actualGasUsed);
    if (present(event.driftBps)) row.driftBps = Number(event.driftBps);
    if (present(event.transactionHash)) row.transactionHash = String(event.transactionHash);
    if (present(event.errorCode)) row.errorCode = String(event.errorCode);
    if (present(event.errorDetail)) row.errorDetail = publicDetail(event.errorDetail);
    emit(Object.freeze(row));
    return row;
  }

  return Object.freeze({ operation });
}
