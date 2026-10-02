import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('supabase/migrations/20261002170000_viewer_report_parity_fields.sql', 'utf8')

test('live report display metadata stays behind the existing viewer session gate', () => {
  assert.match(sql, /foreign_monitoring_require_session\(p_session_token\)/)
  assert.match(sql, /foreign_monitoring_live_range_payload\(v_monday, v_monday \+ 5\)/)
  assert.match(sql, /'roster_state'/)
  assert.match(sql, /'lateness_seconds'/)
  assert.match(sql, /a\.biometric_sync_metadata->'lateness_seconds'/)
  assert.doesNotMatch(sql, /insert into public\.attendance|update public\.attendance|delete from public\.attendance/i)
})

test('normal report adds operational start date only to already-scoped workers', () => {
  assert.match(sql, /'operationalStartDate', w\.operational_start_date/)
  assert.match(sql, /left join public\.workers w on w\.id = \(item->>'id'\)::uuid/)
  assert.match(sql, /foreign_monitoring_require_session\(p_session_token\)/)
  assert.match(sql, /v_today_snapshot->'workers'/)
})
