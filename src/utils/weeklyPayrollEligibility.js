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
