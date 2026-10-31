import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'
import { biometricIdsByWorker } from './dailyOperationalReports.js'

// Manual overtime eligibility is deliberately separate from weekly base salary.
export const isWeeklyOvertimeEligibleWorker = (worker, end) => Boolean(worker?.team_id)
  && isOperationalAttendanceWorkerOnDate(worker, end)
  && (worker.staff_classification || 'normal') === 'normal'
  && ['weekly', 'monthly'].includes(worker.payment_type)

// Manual admin entry and automatic biometric review have different scopes.
export const isBiometricOvertimeEligibleWorker = (worker, end) => isWeeklyOvertimeEligibleWorker(worker, end)
  && (worker.team?.name || worker.team_name) !== 'Chauffeur'

export const overtimeBiometricIds = biometricIdsByWorker
export const overtimeSearchPlaceholder = 'بحث بالاسم أو الكود أو رقم البصمة...'
export function matchesOvertimeWorker(worker, search, ids = new Map()) {
  const query = search.trim().toLocaleLowerCase()
  if (!query) return true
  return String(worker.full_name || '').toLocaleLowerCase().includes(query)
    || String(worker.employee_code || '').toLocaleLowerCase().includes(query)
    // Exact biometric string comparison: 025 and 25 are distinct identities.
    || (ids.get(String(worker.id)) || '').split(' · ').some((id) => id.toLocaleLowerCase() === query)
}
export const unionSelectedWorkers = (selected, workers) => [...new Set([...selected, ...workers.map((w) => String(w.id))])]
