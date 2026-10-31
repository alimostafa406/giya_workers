import { expect, it } from 'vitest'
import { isWeeklyOvertimeEligibleWorker, isBiometricOvertimeEligibleWorker, matchesOvertimeWorker, overtimeBiometricIds } from './overtimeWorkerScope'
const worker = { id: 'w', full_name: 'KIPULU', employee_code: '207', payment_type: 'monthly', is_active: true, team_id: 't', team_name: 'Team', staff_classification: 'normal' }
it.each(['weekly','monthly'])('allows operational %s worker', (payment_type) => {
  expect(isWeeklyOvertimeEligibleWorker({ ...worker, payment_type }, '2026-10-24')).toBe(true)
})
it.each([{ is_active: false }, { team_id: null }, { team_name: null }, { staff_classification: 'special_staff' }, { payment_type: 'other' }, { operational_start_date: '2026-11-01' }, { team_name: 'Adminstration' }])('rejects non-eligible worker %j', (extra) => {
  expect(isWeeklyOvertimeEligibleWorker({ ...worker, ...extra }, '2026-10-24')).toBe(false)
})
it('Chauffeur is eligible for manual weekly OT, never biometric review', () => {
  const driver = { ...worker, team_name: 'Chauffeur' }
  expect(isWeeklyOvertimeEligibleWorker(driver, '2026-10-24')).toBe(true)
  expect(isBiometricOvertimeEligibleWorker(driver, '2026-10-24')).toBe(false)
})
it('canonical confirmed mapping search preserves exact identities and trims case-insensitive partial names', () => {
  const ids = overtimeBiometricIds([{ worker_id: 'w', device_employee_no: '025', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'w', device_employee_no: '070', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'w', device_employee_no: '081', is_active: true, mapping_review_state: 'pending' }])
  for (const search of [' kip ', '207', '025', '070']) expect(matchesOvertimeWorker(worker, search, ids)).toBe(true)
  for (const search of ['25','70','081']) expect(matchesOvertimeWorker(worker, search, ids)).toBe(false)
})
