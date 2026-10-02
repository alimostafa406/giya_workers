import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('./supabase/migrations/20261002110000_optimize_live_monitoring_reports.sql', import.meta.url), 'utf8')
const range = sql.slice(sql.indexOf('create or replace function public.foreign_monitoring_live_range_payload'), sql.indexOf('revoke all on function public.foreign_monitoring_live_range_payload'))
const wrapper = sql.slice(sql.indexOf('create or replace function public.get_live_operational_reports'))

test('week and single-day modes use one bounded shared report pipeline', () => {
  assert.match(range, /p_end - p_start > 6/)
  assert.match(range, /generate_series\(p_start::timestamp, p_end::timestamp/)
  assert.match(range, /roster as materialized/)
  assert.match(range, /mapping_scope as materialized/)
  assert.match(range, /events_in_range as materialized/)
  assert.match(range, /attendance_range as materialized/)
  assert.match(wrapper, /v_days := public\.foreign_monitoring_live_range_payload\(v_monday, v_monday \+ 5\)/)
  assert.match(wrapper, /v_days := public\.foreign_monitoring_live_range_payload\(p_date, p_date\)/)
  assert.doesNotMatch(wrapper, /generate_series|foreign_monitoring_live_day_payload/)
})

test('report status, exceptions, overtime, and future availability remain unchanged', () => {
  assert.match(range, /t\.name <> 'Adminstration'/)
  assert.match(range, /w\.operational_start_date is null or w\.operational_start_date <= p_end/)
  assert.match(range, /c\.classification = 'special_staff'/)
  assert.match(range, /d::date <= v_today and extract\(isodow from d::date\) <> 7/)
  assert.match(range, /a\.id is null then 'absent'/)
  assert.match(range, /a\.attendance_day_fraction is distinct from 1 then 'half_day'/)
  assert.match(range, /o\.exception_status <> 'present'/)
  assert.match(range, /c\.team_name <> 'Chauffeur'/)
  assert.match(range, /s\.team_ids/)
  assert.match(range, /o\.overtime_minutes >= 120/)
  assert.match(range, /'last_punch'/)
  assert.match(range, /'biometric_id'/)
})

test('session access and read-only boundaries remain intact', () => {
  assert.match(wrapper, /perform public\.foreign_monitoring_require_session\(p_session_token\)/)
  assert.match(wrapper, /perform public\.foreign_monitoring_touch_session\(p_session_token\)/)
  assert.match(sql, /revoke all on function public\.foreign_monitoring_live_range_payload\(date,date\)/)
  assert.match(sql, /grant execute on function public\.get_live_operational_reports\(text,date\)\s+to anon, authenticated/)
  assert.doesNotMatch(sql, /\b(insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:attendance|workers|payroll_line)\b/i)
  assert.doesNotMatch(sql, /create\s+index/i)
})
