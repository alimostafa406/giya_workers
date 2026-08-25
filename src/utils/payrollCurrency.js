const ISO_CURRENCY_CODE = /^[A-Z]{3}$/

const validCurrency = (value) => {
  const normalized = String(value || '').trim().toUpperCase()
  return ISO_CURRENCY_CODE.test(normalized) ? normalized : null
}

export const resolvePayrollCurrency = ({
  currency,
  currencyCode,
  currencyCodeSnapshot,
  compensationCurrency,
} = {}) => {
  const explicit = [currency, currencyCode, currencyCodeSnapshot, compensationCurrency]
    .map(validCurrency)
    .find(Boolean)

  if (explicit) return explicit
  return null
}

// Rendering helper only; it does not alter payroll calculation values.
export const formatPayrollMoney = (amount, options = {}) => {
  const raw = Number(amount)
  const value = Number.isFinite(raw) ? raw : 0
  const currency = resolvePayrollCurrency(options)

  if (!currency) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}
