export function accountingMicro(value) {
  try {
    const text = String(value ?? '').trim();
    return text ? BigInt(text) : 0n;
  } catch {
    return 0n;
  }
}

function hasAccountingValue(item, field) {
  return item?.[field] !== undefined && item?.[field] !== null && String(item[field]).trim() !== '';
}

function hasAccountingBreakdown(item) {
  return hasAccountingValue(item, 'storageCostAccountingMicro')
    && hasAccountingValue(item, 'serviceFeeAccountingMicro');
}

function feeReceiptKey(item, index) {
  const explicit = String(item?.paymentGroupId || '').trim();
  if (explicit) return `payment:${explicit}`;
  if (item?.paymentMode === 'one-approval-beta-batch') {
    const reconciledAt = String(item?.lastReconciledAt ?? '').trim();
    if (reconciledAt) {
      return [
        'legacy-batch',
        reconciledAt,
        item.totalAccountingMicro || item.quotedAccountingMicro || '',
        item.storageCostAccountingMicro || '',
        item.serviceFeeAccountingMicro || '',
      ].join(':');
    }
  }
  return `artifact:${String(item?.key || index)}`;
}

export function summarizeFeeReceipts(items = []) {
  const seen = new Set();
  return items.reduce((sum, item, index) => {
    const receiptKey = feeReceiptKey(item, index);
    if (seen.has(receiptKey)) return sum;
    seen.add(receiptKey);
    const total = accountingMicro(item.totalAccountingMicro || item.quotedAccountingMicro);
    const hasBreakdown = hasAccountingBreakdown(item);
    return {
      total: sum.total + total,
      storage: sum.storage + (hasBreakdown ? accountingMicro(item.storageCostAccountingMicro) : 0n),
      service: sum.service + (hasBreakdown ? accountingMicro(item.serviceFeeAccountingMicro) : 0n),
      unitemized: sum.unitemized + (total > 0n && !hasBreakdown ? total : 0n),
      breakdownCount: sum.breakdownCount + (hasBreakdown ? 1 : 0),
    };
  }, { total: 0n, storage: 0n, service: 0n, unitemized: 0n, breakdownCount: 0 });
}
