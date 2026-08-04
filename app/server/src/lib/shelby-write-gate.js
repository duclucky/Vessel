const pausedBody = Object.freeze({
  error: 'Shelby testnet writes are temporarily paused',
  code: 'shelby_writes_paused',
});

const pausedResponse = Object.freeze({ status: 503, body: pausedBody });

export function shelbyWriteGate(enabled) {
  return enabled ? null : pausedResponse;
}
