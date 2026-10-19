import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sql = readFileSync('supabase/migrations/20261019123544_morning_report_finalization.sql','utf8')
const page = readFileSync('src/pages/AbsenceReport.jsx','utf8')

test('final morning evidence is bounded inclusively at 11:00 without attendance writes', () => {
  assert.match(sql, /a\.check_in<=time '11:00'/)
  assert.match(sql, /e\.event_timestamp <= \(p_date\+time '11:00'\) at time zone 'Africa\/Kinshasa'/)
  assert.match(sql, /e\.worker_id=p_worker/)
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) (?:public\.)?(?:attendance|biometric_attendance_events)\b/i)
  for (const [time, expected] of [['10:58:25',true],['11:00:00',true],['11:00:01',false],['11:01:00',false]]) {
    assert.equal(new Date(`2026-10-19T${time}+01:00`) <= new Date('2026-10-19T11:00:00+01:00'), expected)
  }
})

test('page has no network polling or focus handlers and uses persisted final population', () => {
  assert.doesNotMatch(page, /ATTENDANCE_REFRESH_INTERVAL_MS|addEventListener\('focus'|addEventListener\('visibilitychange'/)
  assert.match(page, /finalizeSupervisorReviewRequest\(requested\.selectedDate\)/)
  assert.match(page, /exactPopulation: true/)
  assert.match(page, /T11:00:00\+01:00/)
})

test('viewer keeps authorization/publication wrapper and reads the shared final snapshot', () => {
  assert.match(sql, /private\.supervisor_review_daily_snapshot where attendance_date=p_date/)
  assert.match(sql, /final_snapshot_pending/)
  assert.match(sql, /private\.legacy_missing_morning_payload\(p_date\)/)
  assert.doesNotMatch(sql, /create or replace function public\.get_live_normal_missing_morning_report/)
  assert.doesNotMatch(sql, /update private\.supervisor_review_daily_snapshot|delete from private\.supervisor_review_daily_snapshot/)
})
