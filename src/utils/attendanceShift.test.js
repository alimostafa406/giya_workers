import { expect, it } from 'vitest'
import { isDayAttendanceShift } from './attendanceShift'
import { buildAbsenceReport } from './absenceReport'
import { buildSupervisorSheet } from './supervisorSheet'

it('defaults old workers to day and shares night exclusion in morning reports', () => {
  expect(isDayAttendanceShift({})).toBe(true)
  const base = { is_active: true, staff_classification: 'normal', team_id: 'paint', team_name: 'Paint' }
  const workers = [{ ...base, id: 'day', full_name: 'Day' }, { ...base, id: 'night', full_name: 'Night', attendance_shift: 'night' }]
  const report = buildAbsenceReport({ workers, attendance: [], mappings: [], selectedDate: '2026-10-14' })
  const sheet = buildSupervisorSheet({ workers, attendance: [], mappings: [], date: '2026-10-14' })
  expect(report.groups.flatMap(g => g.workers.map(w => w.id))).toEqual(['day'])
  expect(sheet.groups.flatMap(g => g.workers.map(w => w.id))).toEqual(['day'])
  expect(workers[1].is_active).toBe(true)
})
