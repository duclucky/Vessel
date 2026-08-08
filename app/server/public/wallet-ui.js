const shortWallet = (address) => (
  address && address.length > 10
    ? `${address.slice(0, 4)}…${address.slice(-5)}`
    : address || ''
);

export function walletPresentation({
  status = 'disconnected',
  session = null,
} = {}) {
  if (status === 'network_required') {
    return {
      connected: false,
      headerLabel: 'Switch network',
      headerAria: 'Switch wallet to ShelbyNet',
      identityLabel: 'SWITCH TO SHELBYNET',
      identityDisabled: false,
      chainLabel: 'APTOS',
    };
  }
  if (status === 'identity_required') {
    return {
      connected: false,
      headerLabel: 'Updating identity',
      headerAria: 'Updating derived Aptos storage identity',
      identityLabel: 'DERIVING STORAGE IDENTITY',
      identityDisabled: true,
      chainLabel: 'SOLANA DAA',
    };
  }
  const connected = status === 'ready' && Boolean(session?.sourceAddress);
  const shortAddress = shortWallet(session?.sourceAddress || '');
  const chainLabel = session?.chain === 'evm'
    ? 'ETHEREUM DAA'
    : session?.mode === 'daa' ? 'SOLANA DAA' : 'APTOS';
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
