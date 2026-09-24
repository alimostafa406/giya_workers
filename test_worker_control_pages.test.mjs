import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildWorkerControlPages, workerControlCategories } from './src/utils/workerControlPages.js'

const today = '2026-09-24'
const dates = []
for (const day = new Date('2026-09-01T12:00:00Z'); day <= new Date(`${today}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
  if (day.getUTCDay() !== 0) dates.push(day.toISOString().slice(0, 10))
}
const worker = (id, extra = {}) => ({ id, full_name: id, employee_code: id, team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal', ...extra })
const workers = [worker('absent'), worker('monthly'), worker('half'), worker('activated'), worker('returned'), worker('inactive', { is_active: false })]
const attendance = workers.filter((item) => item.is_active).flatMap((item) => dates.map((date) => ({ worker_id: item.id, attendance_date: date, status: (
  (item.id === 'absent' && ['2026-09-23', today].includes(date))
  || (item.id === 'monthly' && date === '2026-09-08')
  || (item.id === 'returned' && ['2026-09-22', '2026-09-23'].includes(date))
) ? 'absent' : item.id === 'half' && ['2026-09-22', today].includes(date) ? 'half_day' : 'present' })))
const input = {
  workers, attendance, today, weekStart: '2026-09-21', monthStart: '2026-09-01', mappings: [],
  events: [
    { worker_id: 'inactive', device_id: 'office-main', device_employee_no: '73', event_timestamp: '2026-09-24T07:00:00Z' },
    { worker_id: 'inactive', device_id: 'office-main', device_employee_no: '73', event_timestamp: '2026-09-24T10:00:00Z' },
  ],
  activated: [{ worker_id: 'activated', activated_at: '2026-09-24T09:00:00Z', biometric_ids: ['74'] }],
}

test('all nine hub cards point to distinct real category routes', () => {
  assert.deepEqual(workerControlCategories.map((item) => item.path), [
    '/worker-control-center/absent-today', '/worker-control-center/consecutive-absence',
    '/worker-control-center/weekly', '/worker-control-center/monthly',
    '/worker-control-center/half-day', '/worker-control-center/inactive-punched',
    '/worker-control-center/activated-today', '/worker-control-center/returned',
    '/worker-control-center/teams',
  ])
  assert.equal(new Set(workerControlCategories.map((item) => item.path)).size, 9)
})

test('each subject receives only its intended worker data from the existing bulk inputs', () => {
  const { rows } = buildWorkerControlPages(input)
  const ids = (subject) => rows[subject].map((item) => item.worker.id)
  assert.deepEqual(ids('absent-today'), ['absent'])
  assert.deepEqual(ids('consecutive-absence'), ['absent'])
  assert.deepEqual(ids('weekly').sort(), ['absent', 'returned'])
  assert.deepEqual(ids('monthly').sort(), ['absent', 'monthly', 'returned'])
  assert.deepEqual(ids('half-day'), ['half'])
  assert.deepEqual(ids('inactive-punched'), ['inactive'])
  assert.deepEqual(ids('activated-today'), ['activated'])
  assert.deepEqual(ids('returned'), ['returned'])
  assert.equal(rows.teams.length, 1)
  assert.equal(rows.teams[0].active, 5)
  assert.deepEqual([rows['inactive-punched'][0].firstPunch.event_timestamp, rows['inactive-punched'][0].lastPunch.event_timestamp, rows['inactive-punched'][0].punchCount], ['2026-09-24T07:00:00Z', '2026-09-24T10:00:00Z', 2])
})

test('router declares each focused page and a team detail route', async () => {
  const router = await readFile(new URL('./src/routes/AppRouter.jsx', import.meta.url), 'utf8')
  for (const { path } of workerControlCategories) assert.ok(router.includes(`path="${path}"`), path)
  assert.ok(router.includes('path="/worker-control-center/teams/:teamId"'))
})
