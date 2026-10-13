import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildAbsenceReport } from './src/utils/absenceReport.js'

const date = '2026-10-13'
const team = { id: 'team-1', name: 'Zarour' }
const worker = (id, active = true) => ({
  id, full_name: id, employee_code: id, is_active: active,
  staff_classification: 'normal', team_id: team.id, team,
})

test('main absence report excludes inactive workers and workers with a canonical check-in', () => {
  const report = buildAbsenceReport({
    workers: [worker('inactive', false), worker('absent'), worker('present')],
    attendance: [{ worker_id: 'present', attendance_date: date, check_in: '08:00:00', status: 'present' }],
    selectedDate: date, businessDate: date,
  })
  assert.deepEqual(report.groups.flatMap((group) => group.workers.map((item) => item.id)), ['absent'])
  assert.equal(report.missingMorningWorkers, 1)
})

test('public live missing-morning contract mirrors main eligibility and keeps snapshot gate', () => {
  const sql = readFileSync('supabase/migrations/20261013104840_live_missing_morning_parity.sql', 'utf8')
  assert.match(sql, /w\.is_active is true/)
  assert.match(sql, /join public\.teams t on t\.id = w\.team_id/)
  assert.match(sql, /t\.name <> 'Adminstration'/)
  assert.match(sql, /w\.operational_start_date <= p_date/)
  assert.match(sql, /c\.classification = 'special_staff'/)
  assert.match(sql, /a\.worker_id = w\.id and a\.attendance_date = p_date/)
  assert.match(sql, /nullif\(btrim\(a\.check_in::text\), ''\) is not null/)
  assert.match(sql, /foreign_monitoring_require_session\(p_session_token\)/)
  assert.match(sql, /foreign_monitoring_normal_report_snapshot[\s\S]*report_date = v_today/)
  assert.doesNotMatch(sql, /\b(?:insert|update|delete)\s+(?:into|public\.)/i)
})
