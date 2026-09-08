import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import {
  EARLY_MORNING_DECISIONS,
  indexEarlyMorningReviews,
  reviewDecisionLabel,
} from './src/utils/earlyMorningReview.js'

test('review rows expose previous and current attendance without name matching', () => {
  const result = indexEarlyMorningReviews({
    reviews: [{ id: 'r1', worker_id: 'w1', previous_work_date: '2026-09-07', current_work_date: '2026-09-08' }],
    workers: [{ id: 'w1', full_name: 'HENRY', employee_code: '155' }],
    attendance: [
      { worker_id: 'w1', attendance_date: '2026-09-07', check_in: '08:00:00' },
      { worker_id: 'w1', attendance_date: '2026-09-08', check_in: null },
    ],
  })
  assert.equal(result[0].worker.full_name, 'HENRY')
  assert.equal(result[0].previousAttendance.check_in, '08:00:00')
  assert.equal(result[0].currentAttendance.check_in, null)
})

test('admin UI offers exactly the three approved review decisions', () => {
  assert.deepEqual(Object.values(EARLY_MORNING_DECISIONS), [
    'current_day_check_in', 'previous_workday_check_out', 'ignored',
  ])
  assert.equal(reviewDecisionLabel('ignored'), 'تم التجاهل')
  const source = fs.readFileSync(new URL('./src/components/Attendance/EarlyMorningAttendanceReviewPanel.jsx', import.meta.url), 'utf8')
  assert.match(source, /تسجيل دخول اليوم/)
  assert.match(source, /تسجيل خروج ليوم العمل السابق/)
  assert.match(source, /تجاهل البصمة/)
})

test('review UI does not mutate attendance tables directly', () => {
  const api = fs.readFileSync(new URL('./src/api/earlyMorningReviewApi.js', import.meta.url), 'utf8')
  assert.doesNotMatch(api, /from\(['"]attendance['"]\).*\.(insert|update|upsert|delete)/s)
  assert.match(api, /resolve_early_morning_biometric_review/)
})
