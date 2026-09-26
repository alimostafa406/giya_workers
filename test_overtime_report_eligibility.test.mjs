import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOvertimeReportEligible } from './src/utils/overtimeReportEligibility.js'
import { buildDailyOvertimeReport } from './src/utils/dailyOperationalReports.js'
import { dailyReportData } from './src/utils/dailyReportCenter.js'
import { weeklyPayrollOvertimeForDetail } from './src/utils/weeklyPayrollOvertime.js'

test('selected real team ID and canonical minimum both required without rounding', () => {
  const row = { teamId: 'a', teamName: 'Zarour' }
  for (const minutes of [91, 119, 119.99]) assert.equal(isOvertimeReportEligible({ ...row, overtimeMinutes: minutes }, ['a']), false)
  for (const minutes of [120, 150, 300]) assert.equal(isOvertimeReportEligible({ ...row, overtimeMinutes: minutes }, ['a']), true)
  assert.equal(isOvertimeReportEligible({ ...row, overtimeMinutes: 300 }, ['b']), false)
  assert.equal(isOvertimeReportEligible({ ...row, overtimeMinutes: 300 }), false)
  assert.equal(isOvertimeReportEligible({ ...row, teamName: 'Chauffeur', overtimeMinutes: 300 }, ['a']), false)
})
test('both report surfaces re-filter earlier weekdays with current configuration, preserving canonical values and exceptions', () => {
  for (const date of ['2026-09-21', '2026-09-22', '2026-09-25']) {
    const worker = { id: 'w', full_name: 'Worker', is_active: true, team_id: 'a', team: { name: 'Zarour' }, staff_classification: 'normal' }
    const attendance = [{ id: 'r', worker_id: 'w', worker, team_name: 'Zarour', attendance_date: date, status: 'present', check_in: '08:00:00', check_out: '19:00:00', finalAmount: 100 }]
    const original = structuredClone(attendance)
    const input = { date, workers: [worker], attendance }
    assert.equal(buildDailyOvertimeReport(input).length, 0)
    const enabled = { ...input, overtimeTeamIds: ['a'] }
    assert.equal(buildDailyOvertimeReport(enabled)[0].overtimeMinutes, 120)
    assert.deepEqual(dailyReportData(enabled).overtime, buildDailyOvertimeReport(enabled))
    assert.deepEqual(dailyReportData(enabled).exceptions, dailyReportData(input).exceptions)
    assert.equal(weeklyPayrollOvertimeForDetail({ date, status: 'present', row: attendance[0] }).eveningOvertimeMinutes, 120)
    assert.deepEqual(attendance, original)
  }
})
