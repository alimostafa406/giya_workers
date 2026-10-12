import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync('supabase/migrations/20261012165541_supervisor_morning_review.sql', 'utf8')

test('one invoker-rights RPC validates admin, Kinshasa today, 11:00, and every frozen-list result', () => {
  assert.match(sql, /create or replace function public\.admin_save_supervisor_morning_review\(/i)
  assert.match(sql, /language plpgsql security invoker/i)
  assert.match(sql, /public\.is_admin\(\)/i)
  assert.match(sql, /Africa\/Kinshasa/i)
  assert.match(sql, /time '11:00'/i)
  assert.match(sql, /jsonb_each_text\(p_results\)/i)
  assert.match(sql, /v_choice not in \('A', 'P', 'O', 'M'\)/i)
  assert.match(sql, /revoke all on function .* from public, anon/i)
})

test('A/P/O/M become present or absent with no fabricated biometric timestamps', () => {
  assert.match(sql, /v_status := case when v_choice in \('P', 'O'\) then 'present' else 'absent' end/i)
  assert.match(sql, /when 'O' then 'working_outside' when 'M' then 'medical'/i)
  assert.match(sql, /values \([\s\S]*v_worker_id, p_date, v_status, null, null, v_note/i)
  assert.match(sql, /check_in = case when v_status = 'absent' then null else a\.check_in end/i)
  assert.match(sql, /check_out = case when v_status = 'absent' then null else a\.check_out end/i)
  assert.doesNotMatch(sql, /(?:time '08:00'|time '17:00'|insert into public\.biometric)/i)
})

test('the manual result stays protected and records previous state, actor, choice and time', () => {
  assert.match(sql, /manual_override is true or v_old\.attendance_source <> 'biometric'/i)
  assert.match(sql, /attendance_source = 'manual', manual_override = true/i)
  assert.match(sql, /'previous', v_previous, 'actor', v_actor, 'applied_at', v_applied_at/i)
  assert.match(sql, /biometric_sync_metadata = v_metadata/i)
  assert.doesNotMatch(sql, /create table|payroll_line|payroll_run|update public\.workers/i)
})
