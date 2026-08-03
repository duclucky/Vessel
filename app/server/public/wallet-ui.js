const shortWallet = (address) => (
  address && address.length > 10
    ? `${address.slice(0, 4)}…${address.slice(-5)}`
    : address || ''
);

export function walletPresentation({ address = '', verified = false } = {}) {
  const connected = Boolean(address && verified);
  const shortAddress = shortWallet(address);
  return {
    connected,
    headerLabel: connected ? shortAddress : 'Connect',
    headerAria: connected ? `Wallet ${shortAddress} connected` : 'Connect wallet',
    identityLabel: connected ? 'CONNECTED — STORAGE READY' : 'CONNECT PHANTOM — OWN YOUR STORAGE',
    identityDisabled: connected,
  };
}
