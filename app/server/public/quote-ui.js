import { normalizeRetentionDays } from './retention.js';

const MICRO_PER_DOLLAR = 1_000_000n;

export function formatAccountingMicro(value) {
  const amount = BigInt(value ?? 0);
  const sign = amount < 0n ? '-' : '';
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / MICRO_PER_DOLLAR;
  const fraction = (absolute % MICRO_PER_DOLLAR).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}$${whole}${fraction ? `.${fraction}` : ''}`;
}

function formatCountdown(expiresAtMs, nowMs) {
  const remainingSeconds = Math.max(0, Math.ceil((Number(expiresAtMs) - nowMs) / 1_000));
  const minutes = Math.floor(remainingSeconds / 60).toString().padStart(2, '0');
  const seconds = (remainingSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function quoteViewModel(quote, nowMs = Date.now()) {
  const serviceFee = formatAccountingMicro(quote.serviceFeeAccountingMicro);
  return {
    storage: formatAccountingMicro(quote.storageAccountingMicro),
    gas: formatAccountingMicro(quote.gasAccountingMicro),
    serviceFee: quote.minimumApplied ? `${serviceFee} (minimum applied)` : serviceFee,
    total: formatAccountingMicro(quote.totalAccountingMicro),
    tokenLine: `${quote.settlementToken} · ${quote.settlementNetwork}`,
    expiration: new Date(quote.targetExpirationUtc).toLocaleString(),
    countdown: formatCountdown(quote.expiresAtMs, nowMs),
    expired: Number(quote.expiresAtMs) <= nowMs,
  };
}

export function mountQuoteUi({ root, onRetentionChange }) {
  if (!root) throw new TypeError('Quote root is required');
  const find = (selector) => root.querySelector(selector);
  const options = find('#retention-options');
  const customWrap = find('#custom-days-wrap');
  const customInput = find('#custom-days');
  const customError = find('#custom-days-error');
  const status = find('#quote-status');
  const confirm = find('#quote-confirm');
  const countdown = find('#quote-countdown');
  let currentDays = 7;
  let currentState = { kind: 'unavailable' };
  let timer = null;

  function selectedValue() {
    return options?.querySelector('input[name="retention"]:checked')?.value || '7';
  }

  function validateDays({ announce = false } = {}) {
    try {
      const selected = selectedValue();
      currentDays = normalizeRetentionDays(selected === 'custom' ? customInput?.value : selected);
      if (customError) customError.textContent = '';
      customInput?.removeAttribute('aria-invalid');
      return currentDays;
    } catch (error) {
      if (customError && announce) customError.textContent = error.message;
      customInput?.setAttribute('aria-invalid', 'true');
      return null;
    }
  }

  function notifyRetention() {
    const value = validateDays({ announce: true });
    if (value !== null) onRetentionChange?.(value);
  }

  function renderCountdown() {
    if (currentState.kind !== 'ready' || !currentState.quote) return;
    const model = quoteViewModel(currentState.quote);
    if (countdown) countdown.textContent = model.countdown;
    if (model.expired) render({ kind: 'expired', quote: currentState.quote });
  }

  function setText(selector, value) {
    const element = find(selector);
    if (element) element.textContent = value;
  }

  function render(state) {
    currentState = state;
    root.dataset.state = state.kind;
    clearInterval(timer);
    timer = null;

    if (state.kind === 'loading') {
      if (status) status.textContent = 'Calculating an on-chain storage quote…';
      if (confirm) {
        confirm.disabled = true;
        confirm.textContent = 'CALCULATING QUOTE';
      }
      return;
    }

    if (state.kind === 'ready') {
      const model = quoteViewModel(state.quote);
      setText('#quote-storage-cost', model.storage);
      setText('#quote-gas-cost', model.gas);
      setText('#quote-service-fee', model.serviceFee);
      setText('#quote-total', model.total);
      setText('#quote-token-network', model.tokenLine);
      setText('#quote-expiration', model.expiration);
      setText('#quote-countdown', model.countdown);
      if (status) status.textContent = state.message || 'Quote ready. Review the total before continuing.';
      if (confirm) {
        confirm.disabled = false;
        confirm.textContent = state.confirmLabel || 'CONFIRM & CONTINUE';
      }
      timer = setInterval(renderCountdown, 1_000);
      return;
    }

    if (state.kind === 'expired') {
      if (status) status.textContent = 'This quote expired. Requesting a fresh quote is required.';
      if (confirm) {
        confirm.disabled = true;
        confirm.textContent = 'QUOTE EXPIRED';
      }
      setText('#quote-countdown', '00:00');
      return;
    }

    if (state.kind === 'unavailable') {
      if (status) status.textContent = state.message || 'Select a file to calculate the exact price.';
      if (confirm) {
        confirm.disabled = true;
        confirm.textContent = 'CONFIRM & CONTINUE';
      }
    }
  }

  options?.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'retention') return;
    const custom = event.target.value === 'custom';
    if (customWrap) customWrap.hidden = !custom;
    if (custom) customInput?.focus();
    notifyRetention();
  });
  customInput?.addEventListener('input', notifyRetention);
  customInput?.addEventListener('blur', () => validateDays({ announce: true }));

  function reset() {
    clearInterval(timer);
    timer = null;
    currentDays = 7;
    const defaultOption = find('#retention-7');
    if (defaultOption) defaultOption.checked = true;
    if (customInput) customInput.value = '7';
    if (customWrap) customWrap.hidden = true;
    if (customError) customError.textContent = '';
    render({ kind: 'unavailable' });
  }

  reset();
  return { render, days: () => validateDays() ?? currentDays, reset };
}
