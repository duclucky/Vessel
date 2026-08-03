const shortWallet = (address) => (
  address && address.length > 10
    ? `${address.slice(0, 4)}…${address.slice(-5)}`
    : address || ''
);

export function walletPresentation({
  status = 'disconnected',
  session = null,
} = {}) {
  const connected = status === 'ready' && Boolean(session?.sourceAddress);
  const shortAddress = shortWallet(session?.sourceAddress || '');
  const chainLabel = session?.mode === 'daa' ? 'SOLANA DAA' : 'APTOS';
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
