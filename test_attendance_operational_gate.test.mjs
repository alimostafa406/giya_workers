import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ATTENDANCE_REFRESH_INTERVAL_MS,
  isAttendancePageLocked,
  prepareAttendanceOutput,
} from './src/utils/attendanceOperationalGate.js'

test('today before 09:30 Kinshasa is locked', () => {
  assert.equal(isAttendancePageLocked({
    selectedDate: '2026-09-03',
    now: new Date('2026-09-03T08:29:59.000Z'),
  }), true)
})

test('today unlocks exactly at 09:30 Kinshasa and remains unlocked afterward', () => {
  assert.equal(isAttendancePageLocked({
    selectedDate: '2026-09-03',
    now: new Date('2026-09-03T08:30:00.000Z'),
  }), false)
  assert.equal(isAttendancePageLocked({
    selectedDate: '2026-09-03',
    now: new Date('2026-09-03T12:00:00.000Z'),
  }), false)
})

test('historical dates are never subject to the current-day opening gate', () => {
  assert.equal(isAttendancePageLocked({
    selectedDate: '2026-09-02',
    now: new Date('2026-09-03T06:00:00.000Z'),
  }), false)
})

test('automatic unlock is clock-driven and triggers the coordinated fresh snapshot', () => {
  const source = readFileSync('./src/pages/Attendance.jsx', 'utf8')
  assert.match(source, /setInterval\(\(\) => setNow\(new Date\(\)\), 1_000\)/)
  assert.match(source, /if \(locked\)[\s\S]*refreshSnapshot\(filtersRef\.current\)/)
  assert.match(source, /Promise\.all\(\[[\s\S]*getWorkersRequest\(\)[\s\S]*getAttendanceRequest/)
  assert.match(source, /setSnapshot\(nextSnapshot\)/)
})

test('today refresh interval is 30 seconds after unlock', () => {
  assert.equal(ATTENDANCE_REFRESH_INTERVAL_MS, 30_000)
  const source = readFileSync('./src/pages/Attendance.jsx', 'utf8')
  assert.match(source, /if \(!isTodayView \|\| locked\) return undefined/)
  assert.match(source, /ATTENDANCE_REFRESH_INTERVAL_MS/)
})

test('print or export generation is blocked while attendance is locked', async () => {
  let refreshed = false
  let generated = false
  const result = await prepareAttendanceOutput({
    locked: true,
    refresh: async () => { refreshed = true },
    generate: async () => { generated = true },
  })
  assert.deepEqual(result, { ok: false, reason: 'locked' })
  assert.equal(refreshed, false)
  assert.equal(generated, false)
})

test('print or export waits for a successful fresh snapshot before generation', async () => {
  const order = []
  const freshSnapshot = { date: '2026-09-03', attendance: [{ id: 'fresh' }] }
  const result = await prepareAttendanceOutput({
    locked: false,
    refresh: async () => { order.push('refresh'); return freshSnapshot },
    generate: async (snapshot) => { order.push('generate'); assert.equal(snapshot, freshSnapshot) },
  })
  assert.deepEqual(order, ['refresh', 'generate'])
  assert.deepEqual(result, { ok: true, reason: null })
})

test('failed refresh cancels print or export generation', async () => {
  let generated = false
  const failure = new Error('network unavailable')
  const result = await prepareAttendanceOutput({
    locked: false,
    refresh: async () => { throw failure },
    generate: async () => { generated = true },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'refresh_failed')
  assert.equal(result.error, failure)
  assert.equal(generated, false)
})
