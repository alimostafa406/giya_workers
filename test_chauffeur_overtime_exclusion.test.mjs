import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDailyOvertimeReport } from './src/utils/dailyOperationalReports.js'
import { calculatePayrollLine } from './src/utils/payrollCalculations.js'
import { weeklyPayrollDisplayStatus, weeklyPayrollOvertimeForDetail, weeklyPayrollOvertimeForLine } from './src/utils/weeklyPayrollOvertime.js'

const detail = (teamName, checkOut) => ({
  date: '2026-09-14',
  status: 'present',
  row: {
    check_in: '07:47:00',
    check_out: checkOut,
    worker: { id: `${teamName}-worker`, is_active: true, team_name: teamName },
  },
})

test('Chauffeur keeps valid attendance but has no normal overtime at late or night checkout', () => {
  assert.equal(weeklyPayrollDisplayStatus(detail('Chauffeur', '18:39:00')), 'present')
  assert.deepEqual(weeklyPayrollOvertimeForDetail(detail('Chauffeur', '18:39:00')), { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 })
  assert.deepEqual(weeklyPayrollOvertimeForDetail(detail('Chauffeur', '23:00:00')), { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 })
  assert.deepEqual(weeklyPayrollOvertimeForLine({ worker: { team_name: 'Chauffeur' }, details: [detail('Chauffeur', '23:00:00')] }), { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 })
})

test('Daily Overtime Report excludes Chauffeur while retaining normal-worker overtime', () => {
  const chauffeur = { id: 'chauffeur', full_name: 'BEBETO', is_active: true, staff_classification: 'normal', team_name: 'Chauffeur', team: { name: 'Chauffeur' } }
  const normal = { id: 'normal', full_name: 'Normal Worker', is_active: true, staff_classification: 'normal', team_name: 'Peinture Raghibe', team: { name: 'Peinture Raghibe' } }
  const report = buildDailyOvertimeReport({
    date: '2026-09-14',
    attendance: [
      { id: 'chauffeur-row', worker: chauffeur, worker_name: 'BEBETO', team_name: 'Chauffeur', status: 'present', check_in: '07:47:00', check_out: '18:39:00' },
      { id: 'normal-row', worker: normal, worker_name: 'Normal Worker', team_name: 'Peinture Raghibe', status: 'present', check_in: '08:00:00', check_out: '18:39:00' },
    ],
  })
  assert.deepEqual(report.map((item) => [item.worker, item.overtimeMinutes]), [['Normal Worker', 90]])
})

test('Chauffeur payroll line has no normal overtime while Maison remains unchanged', () => {
  const chauffeurLine = calculatePayrollLine({
    worker: { id: 'chauffeur', team_name: 'Chauffeur' },
    term: { daily_rate: 100, daily_transport_allowance: 0, overtime_rate_per_hour: 10, overtime_start_time: '17:00:00' },
    attendanceByDate: new Map([['chauffeur|2026-09-14', { status: 'present', check_in: '07:47:00', check_out: '23:00:00' }]]),
    dates: ['2026-09-14'], rules: {}, holidayDates: new Set(), paymentType: 'weekly', businessDate: '2026-09-14',
  })
  assert.equal(chauffeurLine.presentDays, 1)
  assert.equal(chauffeurLine.overtimeHours, 0)
  assert.equal(chauffeurLine.overtimeAmount, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(detail('Maison', '18:39:00')).eveningOvertimeMinutes, 90)
  assert.equal(weeklyPayrollOvertimeForDetail(detail('Peinture Raghibe', '18:39:00')).eveningOvertimeMinutes, 90)
})
