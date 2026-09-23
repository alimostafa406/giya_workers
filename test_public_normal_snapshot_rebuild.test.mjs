import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync('./supabase/sql/admin_rebuild_today_normal_report_snapshot.sql', 'utf8')

test('today snapshot rebuild is explicitly admin-only and requires a complete morning verification', () => {
  assert.match(sql, /auth\.uid\(\) is null or not public\.is_admin\(\)/)
  assert.match(sql, /verification_type='morning'/)
  assert.match(sql, /v\.status='complete'/)
  assert.match(sql, /today morning verification is not complete/)
  assert.match(sql, /grant execute on function public\.admin_rebuild_today_normal_report_snapshot\(\) to authenticated/)
  assert.match(sql, /revoke all on function public\.admin_rebuild_today_normal_report_snapshot\(\) from public,anon/)
})

test('today snapshot rebuild replaces exactly today and preserves the operational public roster exclusions', () => {
  assert.match(sql, /v_today date := \(now\(\) at time zone 'Africa\/Kinshasa'\)::date/)
  assert.match(sql, /on conflict \(report_date\) do update/)
  assert.match(sql, /t\.name is distinct from 'Adminstration'/)
  assert.match(sql, /w\.operational_start_date is null or w\.operational_start_date <= p_date_to/)
  assert.doesNotMatch(sql, /delete from public\.foreign_monitoring_normal_report_snapshot/i)
})

test('dashboard only renders the explicit rebuild action for an administrator after verification completes', () => {
  const source = readFileSync('./src/components/Attendance/AttendanceAgentStatus.jsx', 'utf8')
  assert.match(source, /Boolean\(admin\?\.id\) && verificationDetails\.isComplete/)
  assert.match(source, /window\.confirm\(t\('agentStatus\.rebuildTodayReportConfirm'\)\)/)
  assert.match(source, /rebuildTodayPublicNormalReportSnapshotRequest/)
})
