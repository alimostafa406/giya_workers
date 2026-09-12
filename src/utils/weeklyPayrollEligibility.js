import { isActiveWorker } from './activeWorkers.js'

export const isWeeklyPayrollEligibleWorker = (worker) => (
  isActiveWorker(worker)
  && worker?.payment_type === 'weekly'
  && (worker?.staff_classification || 'normal') === 'normal'
)

export const weeklyPayrollEligibleLines = (lines = []) => (
  (Array.isArray(lines) ? lines : []).filter((line) => isWeeklyPayrollEligibleWorker(line?.worker))
)

export const payrollDraftEligibleLines = (paymentType, lines = []) => (
  paymentType === 'weekly' ? weeklyPayrollEligibleLines(lines) : (Array.isArray(lines) ? lines : [])
)

export const weeklyPayrollTotalsByCurrency = (lines = []) => (
  (Array.isArray(lines) ? lines : []).reduce((totals, line) => {
    const currency = String(line?.currency || '').trim() || 'UNCONFIGURED'
    totals[currency] = Math.round(((totals[currency] || 0) + Number(line?.finalAmount || 0)) * 100) / 100
    return totals
  }, {})
)

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
