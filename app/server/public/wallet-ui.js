const shortWallet = (address) => (
  address && address.length > 10
    ? `${address.slice(0, 4)}…${address.slice(-5)}`
    : address || ''
);

export function walletPresentation({
  status = 'disconnected',
  session = null,
  address = '',
  verified = false,
} = {}) {
  const legacySession = !session && address && verified
    ? { sourceAddress: address, mode: 'daa' }
    : null;
  const currentSession = session || legacySession;
  const currentStatus = legacySession ? 'ready' : status;
  const connected = currentStatus === 'ready' && Boolean(currentSession?.sourceAddress);
  const shortAddress = shortWallet(currentSession?.sourceAddress || '');
  const chainLabel = currentSession?.mode === 'daa' ? 'SOLANA DAA' : 'APTOS';
  return {
    connected,
    headerLabel: connected ? shortAddress : 'Connect',
    headerAria: connected
      ? `Wallet ${shortAddress} connected on ${chainLabel}`
      : 'Connect wallet',
    identityLabel: connected ? 'CONNECTED — STORAGE READY' : 'CONNECT WALLET — OWN YOUR STORAGE',
    identityDisabled: connected,
    chainLabel: connected ? chainLabel : '',
  };
}
