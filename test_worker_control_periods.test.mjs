import assert from 'node:assert/strict'
import test from 'node:test'
import { workerControlPeriods } from './src/utils/workerControlPeriods.js'
import { buildWorkerControlPages } from './src/utils/workerControlPages.js'

const worker = { id: 'w', full_name: 'Worker', team_id: 't', team_name: 'Maison', is_active: true, staff_classification: 'normal', created_at: '2026-08-01T08:00:00Z' }
const row = (date, status) => ({ worker_id: 'w', attendance_date: date, status })
const pages = (today, attendance, operationalStartDate) => {
  const { weekStart, monthStart } = workerControlPeriods(today)
  return buildWorkerControlPages({ workers: [{ ...worker, operational_start_date: operationalStartDate }], attendance, today, weekStart, monthStart }).rows
}

test('Thursday resolves the current Monday-Saturday week and September month-to-date', () => {
  assert.deepEqual(workerControlPeriods('2026-09-24'), {
    weekStart: '2026-09-21', weekEnd: '2026-09-26', monthStart: '2026-09-01', monthEnd: '2026-09-24',
  })
})

test('Monday starts a new week and October 1 starts a new month', () => {
  assert.equal(workerControlPeriods('2026-09-28').weekStart, '2026-09-28')
  assert.deepEqual(workerControlPeriods('2026-10-01'), {
    weekStart: '2026-09-28', weekEnd: '2026-10-03', monthStart: '2026-10-01', monthEnd: '2026-10-01',
  })
})

test('Sunday is outside the weekly workday grid and does not break a current streak', () => {
  const result = pages('2026-09-27', [row('2026-09-25', 'present'), row('2026-09-26', 'absent'), row('2026-09-27', 'present')], '2026-09-25')
  assert.equal(result.weekly.length, 0)
  const period = workerControlPeriods('2026-09-27')
  assert.equal(period.weekEnd, '2026-09-26')
  assert.equal(result['consecutive-absence'].length, 0) // Saturday alone is one eligible absence.
})

test('weekly monitoring excludes previous-week absences after Monday reset', () => {
  const result = pages('2026-09-28', [row('2026-09-25', 'absent'), row('2026-09-26', 'absent'), row('2026-09-28', 'absent')], '2026-09-25')
  assert.equal(result.weekly.length, 0)
  assert.deepEqual(result['consecutive-absence'][0].currentDates, ['2026-09-28', '2026-09-26', '2026-09-25'])
})

test('weekly counts include only eligible dates in the new Monday-Saturday window', () => {
  const result = pages('2026-09-29', [row('2026-09-25', 'absent'), row('2026-09-26', 'absent'), row('2026-09-28', 'absent'), row('2026-09-29', 'absent')], '2026-09-25')
  assert.equal(result.weekly.length, 1)
  assert.equal(result.weekly[0].weekAbsent, 2)
  assert.equal(result.weekly[0].weekLongest, 2)
})

test('monthly monitoring excludes September absences on October 1', () => {
  const result = pages('2026-10-01', [row('2026-09-30', 'absent'), row('2026-10-01', 'present')], '2026-09-30')
  assert.equal(result.monthly.length, 0)
  assert.equal(result['consecutive-absence'].length, 0)
})

test('monthly counts restart at one on October 1 despite September absence', () => {
  const result = pages('2026-10-01', [row('2026-09-30', 'absent'), row('2026-10-01', 'absent')], '2026-09-30')
  assert.equal(result.monthly[0].detail.monthCounts.absent, 1)
  assert.equal(result['consecutive-absence'][0].currentStreak, 2)
})

test('consecutive absence crosses Sunday and a week boundary', () => {
  const result = pages('2026-09-28', [row('2026-09-24', 'present'), row('2026-09-25', 'absent'), row('2026-09-26', 'absent'), row('2026-09-28', 'absent')], '2026-09-24')
  assert.deepEqual(result['consecutive-absence'][0].currentDates, ['2026-09-28', '2026-09-26', '2026-09-25'])
  assert.equal(result['consecutive-absence'][0].currentStreak, 3)
  assert.equal(result.weekly.length, 0)
})

test('consecutive absence crosses a month boundary without carrying monthly counts', () => {
  const result = pages('2026-10-01', [row('2026-09-29', 'present'), row('2026-09-30', 'absent'), row('2026-10-01', 'absent')], '2026-09-29')
  assert.deepEqual(result['consecutive-absence'][0].currentDates, ['2026-10-01', '2026-09-30'])
  assert.equal(result['consecutive-absence'][0].monthAbsent, 1)
  assert.equal(result.monthly[0].detail.monthCounts.absent, 1)
})
