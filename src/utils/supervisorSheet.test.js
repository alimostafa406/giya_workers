import { describe, expect, it } from 'vitest'
import { buildAbsenceReport } from './absenceReport.js'
import { buildSupervisorSheet } from './supervisorSheet.js'

const teams = [
  { id: 'paint', name: 'Peinture Raghibe', is_active: true },
  { id: 'house', name: 'Maison', is_active: true },
  { id: 'admin', name: 'Adminstration', is_active: true },
]
const workers = [
  { id: 'one', full_name: 'ROBERT', employee_code: '79', team_id: 'paint', is_active: true, staff_classification: 'normal' },
  { id: 'two', full_name: 'NIVA', employee_code: '211', team_id: 'paint', is_active: true, staff_classification: 'normal' },
  { id: 'three', full_name: 'AUGUSTINE', employee_code: '61', team_id: 'house', is_active: true, staff_classification: 'normal' },
  { id: 'inactive', full_name: 'BAKA', team_id: 'paint', is_active: false, staff_classification: 'normal' },
  { id: 'special', full_name: 'SPECIAL', team_id: 'paint', is_active: true, staff_classification: 'special_staff' },
  { id: 'admin-worker', full_name: 'ADMIN', team_id: 'admin', is_active: true, staff_classification: 'normal' },
  { id: 'future', full_name: 'FUTURE', team_id: 'paint', is_active: true, staff_classification: 'normal', operational_start_date: '2026-10-13' },
]
const mappings = [
  { worker_id: 'one', device_employee_no: '084', is_active: true, mapping_review_state: 'confirmed' },
  { worker_id: 'one', device_employee_no: '064', is_active: true, mapping_review_state: 'confirmed' },
  { worker_id: 'one', device_employee_no: '999', is_active: false, mapping_review_state: 'confirmed' },
  { worker_id: 'two', device_employee_no: '070', is_active: true, mapping_review_state: 'needs_review' },
]
const roster = workers.map((worker) => ({ ...worker, team_name: teams.find((team) => team.id === worker.team_id)?.name }))
const attendance = [{ worker_id: 'two', attendance_date: '2026-10-12', check_in: '08:00:00' }]
const missingIds = (groups) => groups.flatMap((group) => group.workers.map((worker) => worker.id))

describe('supervisor sheet roster', () => {
  it('has exactly the same missing-morning worker IDs as the absence report, preserving confirmed biometric strings', () => {
    const sheet = buildSupervisorSheet({ workers: [...roster, roster[0]], attendance, mappings, date: '2026-10-12' })
    const report = buildAbsenceReport({ workers: [...roster, roster[0]], attendance, mappings, selectedDate: '2026-10-12' })
    expect(missingIds(sheet.groups)).toEqual(missingIds(report.groups))
    expect(sheet.workerCount).toBe(report.missingMorningWorkers)
    expect(sheet.workerCount).toBe(2)
    expect(sheet.groups.map((group) => group.name)).toEqual(['Maison', 'Peinture Raghibe'])
    const paint = sheet.groups.find((group) => group.id === 'paint').workers
    expect(paint.map((worker) => worker.id)).toEqual(['one'])
    expect(paint.find((worker) => worker.id === 'one')).toMatchObject({ name: 'ROBERT', employeeCode: '79', biometricId: '064 · 084' })
    expect(missingIds(sheet.groups)).not.toContain('two')
    const allIds = missingIds(sheet.groups)
    expect(new Set(allIds).size).toBe(sheet.workerCount)
  })

  it('selects one team without adding inactive, special, or not-yet-operational workers', () => {
    const sheet = buildSupervisorSheet({ workers: roster, attendance, mappings, date: '2026-10-12', teamId: 'paint' })
    expect(sheet.groups).toHaveLength(1)
    expect(sheet.workerCount).toBe(1)
    expect(sheet.groups[0].workers.map((worker) => worker.id)).toEqual(['one'])
  })
})
