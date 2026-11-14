import { isActiveWorkerOnDate } from './activeWorkers.js'
import { biometricIdsByWorker } from './dailyOperationalReports.js'

// OT eligibility is not the morning biometric-attendance population. Office
// workers with real team membership may receive OT without joining that report.
export const isManualOvertimeEligibleWorker = (worker, end) => Boolean(worker?.team_id)
  && Boolean(worker.team?.name || worker.team_name)
  && isActiveWorkerOnDate(worker, end)
  && (worker.staff_classification || 'normal') === 'normal'

export const isWeeklyOvertimeEligibleWorker = (worker, end) => isManualOvertimeEligibleWorker(worker, end)
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
