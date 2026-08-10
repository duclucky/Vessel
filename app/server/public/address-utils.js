const APTOS_HEX = /^[0-9a-f]{1,64}$/;
const FULL_APTOS_HEX = /^[0-9a-f]{64}$/;

export function normalizeAptosLikeAddress(value) {
  const raw = String(value?.toString?.() ?? value ?? '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  const hex = lowered.replace(/^@/, '').replace(/^0x/, '');
  if (lowered.startsWith('@')) {
    return APTOS_HEX.test(hex) ? `0x${hex}` : lowered;
  }
  if (lowered.startsWith('0x')) {
    return FULL_APTOS_HEX.test(hex) ? `0x${hex}` : raw;
  }
  return lowered;
}

export function canonicalWalletAddress(value) {
  const normalized = normalizeAptosLikeAddress(value);
  const hex = normalized.replace(/^0x/, '');
  if (!APTOS_HEX.test(hex)) return normalized;
  return `0x${hex.replace(/^0+/, '') || '0'}`;
}
