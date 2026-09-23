import { isActiveWorker } from './activeWorkers.js'

export const isWeeklyPayrollEligibleWorker = (worker, periodEnd = '') => (
  isActiveWorker(worker)
  && (!worker?.operational_start_date || !periodEnd || String(worker.operational_start_date) <= String(periodEnd))
  && worker?.payment_type === 'weekly'
  && (worker?.staff_classification || 'normal') === 'normal'
)

export const weeklyPayrollEligibleLines = (lines = [], periodEnd = '') => (
  (Array.isArray(lines) ? lines : []).filter((line) => isWeeklyPayrollEligibleWorker(line?.worker, periodEnd))
)

export const payrollDraftEligibleLines = (paymentType, lines = [], periodEnd = '') => (
  paymentType === 'weekly' ? weeklyPayrollEligibleLines(lines, periodEnd) : (Array.isArray(lines) ? lines : [])
)

export const weeklyPayrollTotalsByCurrency = (lines = []) => (
  (Array.isArray(lines) ? lines : []).reduce((totals, line) => {
    const currency = String(line?.currency || '').trim() || 'UNCONFIGURED'
    totals[currency] = Math.round(((totals[currency] || 0) + Number(line?.finalAmount || 0)) * 100) / 100
    return totals
  }, {})
)

export const positiveWeeklyPayrollCurrencyTotals = (totals = {}) => {
  const normalized = (Array.isArray(totals) ? totals : Object.entries(totals)).reduce((result, entry) => {
    const [rawCurrency, rawAmount] = Array.isArray(entry)
      ? entry
      : [entry?.currency ?? entry?.currencyCode, entry?.amount ?? entry?.total]
    const currency = String(rawCurrency || '').trim().toUpperCase() || 'UNCONFIGURED'
    const amount = Number(rawAmount)
    result[currency] = Math.round(((result[currency] || 0) + (Number.isFinite(amount) ? amount : 0)) * 100) / 100
    return result
  }, {})
  return Object.entries(normalized)
    .filter(([, amount]) => amount > 0)
    .sort(([left], [right]) => left.localeCompare(right))
}

export const weeklyPayrollCurrencyTotalsMatch = (storedLines = [], currentLines = []) => {
  const stored = weeklyPayrollTotalsByCurrency(storedLines)
  const current = weeklyPayrollTotalsByCurrency(currentLines)
  const currencies = new Set([...Object.keys(stored), ...Object.keys(current)])
  return [...currencies].every((currency) => stored[currency] === current[currency])
}

export const removableStaleWeeklyPayrollLineIds = (existingLines = [], eligibleLines = [], adjustmentsByLineId = new Map()) => {
  const eligibleWorkerIds = new Set(eligibleLines.map((line) => String(line?.worker?.id)))
  return existingLines
    .filter((line) => !eligibleWorkerIds.has(String(line.worker_id)) && !(adjustmentsByLineId.get(String(line.id)) || []).length)
    .map((line) => line.id)
}
