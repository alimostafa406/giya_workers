import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  isSpecialStaffWorker,
  validateWorkerTeamAssignment,
  workerRequiresOperationalTeam,
} from './src/utils/workerTeamEligibility.js'
import { buildAbsenceReport } from './src/utils/absenceReport.js'
import { isWeeklyPayrollEligibleWorker } from './src/utils/weeklyPayrollEligibility.js'
import { isOperationalAttendanceWorkerOnDate } from './src/utils/activeWorkers.js'

const normalWorker = {
  id: 'normal', full_name: 'Normal Worker', team_id: null, team_name: null,
  is_active: true, staff_classification: 'normal', payment_type: 'weekly',
}
const specialMonthlyWorker = {
  id: 'special-monthly', full_name: 'Special Monthly Worker', team_id: null, team_name: null,
  is_active: true, staff_classification: 'special_staff', payment_type: 'monthly',
}
const assignedNormalWorker = { ...normalWorker, id: 'normal-assigned', team_id: 'team-1', team_name: 'Team One' }

test('normal operational workers cannot be saved without a team', () => {
  assert.equal(workerRequiresOperationalTeam(normalWorker), true)
  assert.throws(() => validateWorkerTeamAssignment(normalWorker), /team is required/i)
})

test('only foreign/special workers can be saved without a team', () => {
  assert.equal(isSpecialStaffWorker(specialMonthlyWorker), true)
  assert.equal(workerRequiresOperationalTeam(specialMonthlyWorker), false)
  assert.doesNotThrow(() => validateWorkerTeamAssignment(specialMonthlyWorker))
  assert.throws(() => validateWorkerTeamAssignment({ ...normalWorker, payment_type: 'monthly' }), /team is required/i)
})

test('normal workers with a team remain operational regardless of payment type', () => {
  const monthlyNormalWorker = { ...assignedNormalWorker, id: 'normal-monthly', payment_type: 'monthly' }
  assert.equal(isOperationalAttendanceWorkerOnDate(assignedNormalWorker, '2026-09-24'), true)
  assert.equal(isOperationalAttendanceWorkerOnDate(monthlyNormalWorker, '2026-09-24'), true)
})

test('teamless foreign monthly staff stay out of normal operational reports and weekly payroll', () => {
  const report = buildAbsenceReport({
    workers: [normalWorker, assignedNormalWorker, specialMonthlyWorker], attendance: [],
    selectedDate: '2026-09-23', businessDate: '2026-09-23',
  })
  assert.equal(report.missingMorningWorkers, 1)
  assert.deepEqual(report.groups.flatMap((group) => group.workers.map((worker) => worker.id)), ['normal-assigned'])
  assert.equal(isWeeklyPayrollEligibleWorker(specialMonthlyWorker), false)
})

test('normal workers without teams are not operational, while Administration and future starts remain excluded', () => {
  assert.equal(isOperationalAttendanceWorkerOnDate(normalWorker, '2026-09-24'), false)
  assert.equal(isOperationalAttendanceWorkerOnDate({ ...assignedNormalWorker, team_name: 'Adminstration' }, '2026-09-24'), false)
  assert.equal(isOperationalAttendanceWorkerOnDate({ ...assignedNormalWorker, operational_start_date: '2026-09-25' }, '2026-09-24'), false)
})

test('monthly payroll flow continues to identify active teamless monthly staff', () => {
  assert.equal(specialMonthlyWorker.is_active, true)
  assert.equal(specialMonthlyWorker.payment_type, 'monthly')
  assert.equal(specialMonthlyWorker.team_id, null)
})

test('worker form renders the translated no-team option and preserves normal team validation', async () => {
  const form = await readFile(new URL('./src/components/Forms/WorkerForm.jsx', import.meta.url), 'utf8')
  const biometricForm = await readFile(new URL('./src/components/Biometric/CreateWorkerFromDeviceModal.jsx', import.meta.url), 'utf8')
  const biometricApi = await readFile(new URL('./src/api/biometricMappingApi.js', import.meta.url), 'utf8')
  const api = await readFile(new URL('./src/api/workersApi.js', import.meta.url), 'utf8')
  assert.match(form, /workers\.noTeam/)
  assert.match(form, /required=\{teamRequired\}/)
  assert.match(biometricForm, /workers\.noTeam/)
  assert.match(biometricForm, /required=\{teamRequired\}/)
  assert.match(biometricApi, /if \(!teamId && !isTeamlessSpecialStaff\)/)
  assert.match(biometricApi, /if \(!teamId\) \{/)
  assert.match(api, /validateWorkerTeamAssignment\(payload\)/)
})
