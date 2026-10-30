import { isActiveWorker } from './activeWorkers.js'

export const isNormalPayrollWorkerOnDate = (worker, periodEnd = '') => (
  (isActiveWorker(worker) || (worker?.payroll_period_evidence?.end === periodEnd
    && worker.payroll_period_evidence.start && worker.payroll_period_evidence.start <= periodEnd))
  && (!worker?.operational_start_date || !periodEnd || String(worker.operational_start_date) <= String(periodEnd))
  && (worker?.staff_classification || 'normal') === 'normal'
)

// Period membership is not today's operational roster. Preserve recorded work,
// decisions, payable sources and immutable population evidence without changing
// is_active. Evidence is bounded to this week and cannot leak into a later one.
export function weeklyPayrollPeriodWorkers(data, start, end) {
  const inPeriod = date => Boolean(date && date >= start && date <= end)
  return (data.workers || []).map(worker => {
    const id = String(worker.id)
    const history = (data.weeklyPayrollPopulation || []).find(row => String(row.worker_id) === id && inPeriod(row.date))
    const saved = (data.payrollLines || []).find(row => String(row.worker_id) === id
      && row.attendance_period_start <= end && row.attendance_period_end >= start
      && (row.payment_type_snapshot === 'weekly' || row.attendance_summary_snapshot?.monthly_overtime_only))
    const activity = Boolean(history || saved
      || (data.attendance || []).some(row => String(row.worker_id) === id && inPeriod(row.attendance_date))
      || (data.weeklyOvertimeOverrides || []).some(row => String(row.worker_id) === id && row.week_start === start && Number(row.minutes) > 0)
      || (data.biometricOvertimeReviews || []).some(row => String(row.worker?.id) === id && inPeriod(row.attendance?.attendance_date))
      || (data.outsideWorkMovements || []).some(row => row.status === 'final' && inPeriod(row.work_date)
        && (row.outside_work_movement_workers || []).some(participant => String(participant.worker_id) === id)))
    const identity = saved?.attendance_summary_snapshot?.worker_identity_snapshot || history?.identity
    return { ...worker, ...(identity || {}),
      ...(activity ? { payroll_period_evidence: { start, end } } : { payroll_period_evidence: null }) }
  })
}

export const isWeeklyPayrollEligibleWorker = (worker, periodEnd = '') => (
  isNormalPayrollWorkerOnDate(worker, periodEnd) && worker?.payment_type === 'weekly'
)

export const weeklyPayrollEligibleLines = (lines = [], periodEnd = '') => (
  (Array.isArray(lines) ? lines : []).filter((line) => isWeeklyPayrollEligibleWorker(line?.worker, periodEnd))
)

export const payrollDraftEligibleLines = (paymentType, lines = [], periodEnd = '') => (
  paymentType === 'weekly' ? (Array.isArray(lines) ? lines : []).filter((line) => isWeeklyPayrollEligibleWorker(line?.worker, periodEnd)
    || (line?.monthlyOvertimeOnly === true && line.worker?.payment_type === 'monthly'
      && isNormalPayrollWorkerOnDate(line.worker, periodEnd) && Number(line.eveningOvertimeMinutes) > 0
      && line.baseAmount === 0 && line.transportAmount === 0 && line.holidayAmount === 0
      && line.finalAmount === line.overtimeAmount)) : (Array.isArray(lines) ? lines : [])
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
