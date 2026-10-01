import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const liveSql = await readFile(new URL('./supabase/migrations/20261001150000_live_monitoring_reports.sql', import.meta.url), 'utf8')
const rangeSql = await readFile(new URL('./supabase/migrations/20261001151000_normal_attendance_range_merge.sql', import.meta.url), 'utf8')

test('live report RPC validates monitoring sessions and exposes only computed read-only rows', () => {
  assert.match(liveSql, /perform public\.foreign_monitoring_require_session\(p_session_token\)/)
  assert.match(liveSql, /revoke all on function public\.foreign_monitoring_live_day_payload\(date\) from public, anon, authenticated/)
  assert.match(liveSql, /grant execute on function public\.get_live_operational_reports\(text,date\) to anon, authenticated/)
  assert.match(liveSql, /'publication_required', false/)
  assert.match(liveSql, /'exceptions', coalesce\(jsonb_agg\(exception_value/)
  assert.match(liveSql, /'overtime', coalesce\(jsonb_agg\(overtime_value/)
  assert.doesNotMatch(liveSql, /\b(insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:attendance|payroll_line|workers)\b/i)
})

test('live reports retain operational roster and safe biometric evidence boundaries', () => {
  assert.match(liveSql, /t\.name <> 'Adminstration'/)
  assert.match(liveSql, /w\.operational_start_date is null or w\.operational_start_date <= p_date/)
  assert.match(liveSql, /c\.classification = 'special_staff'/)
  assert.match(liveSql, /scope\.exact_owner_count = 1/)
  assert.match(liveSql, /scope\.legacy_owner_count = 1/)
  assert.match(liveSql, /review\.review_state = 'ignored'/)
  assert.match(liveSql, /c\.team_name <> 'Chauffeur'/)
  assert.match(liveSql, /overtime_minutes >= 120/)
  assert.match(liveSql, /s\.team_ids/)
})

test('weekly normal-attendance range merges historical days with only the today snapshot', () => {
  assert.match(rangeSql, /p_date_from, least\(p_date_to, v_today - 1\)/)
  assert.match(rangeSql, /s\.report_date = v_today/)
  assert.match(rangeSql, /coalesce\(v_history->'attendance', '\[\]'::jsonb\)\s*\|\| coalesce\(v_today_snapshot->'attendance'/)
  assert.match(rangeSql, /'dateFrom', p_date_from, 'dateTo', p_date_to/)
  assert.match(rangeSql, /'withheldCurrentDay', v_requests_today and v_today_snapshot is null/)
  assert.doesNotMatch(rangeSql, /return v_today_snapshot/)
})
