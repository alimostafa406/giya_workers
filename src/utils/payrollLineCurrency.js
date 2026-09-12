const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

export const payrollWorkerLabel = (line) => {
  const name = String(line?.worker?.full_name || '').trim() || 'Unknown worker'
  const code = String(line?.worker?.employee_code || '').trim()
  return code ? `${name} #${code}` : name
}

export const payrollLineCurrencySnapshot = (line) => {
  const currency = line?.currency
  if (typeof currency !== 'string' || !CURRENCY_CODE_PATTERN.test(currency)) {
    throw new Error(`Payroll compensation currency is not configured for ${payrollWorkerLabel(line)}.`)
  }
  return currency
}

export const assertPayrollLineCurrencies = (lines = []) => {
  const blockers = lines.filter((line) => {
    const currency = line?.currency
    return typeof currency !== 'string' || !CURRENCY_CODE_PATTERN.test(currency)
  })
  if (blockers.length) {
    throw new Error(`Payroll compensation currency is not configured for: ${blockers.map(payrollWorkerLabel).join(', ')}.`)
  }
  return lines
}
