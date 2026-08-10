const APTOS_HEX = /^[0-9a-f]{1,64}$/;

export function normalizeAptosAddress(value, field = 'Aptos address') {
  const text = String(value?.toString?.() ?? value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^0x/, '');
  if (!APTOS_HEX.test(text)) {
    const error = new Error(`${field} is invalid`);
    error.code = 'provider_unavailable';
    throw error;
  }
  return `0x${text}`;
}

export function aptosAddressBytes32(value, field = 'Aptos address') {
  return normalizeAptosAddress(value, field).slice(2).padStart(64, '0');
}
