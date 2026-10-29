import { expect, it, vi } from 'vitest'
// Isolate candidate filtering from the unchanged canonical calculation formula.
vi.mock('./weeklyPayrollOvertime.js', () => ({
  weeklyPayrollOvertimeForDetail: ({ row }) => ({ eveningOvertimeMinutes: row.derivedMinutes }),
}))
import { biometricReviewRows, MINIMUM_BIOMETRIC_REVIEW_MINUTES } from './biometricOvertimeReview'

it.each([[20,false],[29,false],[30,true],[31,true],[45,true],[60,true]])('derived %s minutes has visibility %s', (minutes, visible) => {
  const source = { worker: { id:'w', is_active:true, payment_type:'monthly', staff_classification:'normal', team_id:'t', team_name:'Team' },
    attendance: { attendance_date:'2026-10-28', attendance_source:'biometric', status:'present', check_out:'18:00:00', derivedMinutes:minutes }, review:null }
  const before = JSON.stringify(source)
  expect(MINIMUM_BIOMETRIC_REVIEW_MINUTES).toBe(30)
  expect(biometricReviewRows([source])).toHaveLength(visible ? 1 : 0)
  expect(JSON.stringify(source)).toBe(before)
})
