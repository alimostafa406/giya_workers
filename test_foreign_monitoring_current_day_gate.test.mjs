import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  './supabase/sql/foreign_monitoring_current_day_verification_gate.sql',
  'utf8',
)
const snapshotMigration = readFileSync(
  './supabase/sql/foreign_monitoring_normal_report_snapshot.sql',
  'utf8',
)

const reportIsAvailable = ({ dateFrom, dateTo, today, morningStatus }) => {
  const requestsToday = dateFrom <= today && dateTo >= today
  return !requestsToday || morningStatus === 'complete'
}

test('current-day publication is allowed only after canonical morning verification completes', () => {
  assert.equal(reportIsAvailable({
    dateFrom: '2026-09-22', dateTo: '2026-09-22', today: '2026-09-22', morningStatus: 'complete',
  }), true)
})

for (const morningStatus of ['not_started', 'not_due', 'running', 'incomplete', 'partial', 'failed', 'stale', 'unknown', undefined]) {
  test(`current-day publication fails closed for ${morningStatus ?? 'no verification'}`, () => {
    assert.equal(reportIsAvailable({
      dateFrom: '2026-09-22', dateTo: '2026-09-22', today: '2026-09-22', morningStatus,
    }), false)
  })
}

test('historical report publication remains available regardless of current verification state', () => {
  assert.equal(reportIsAvailable({
    dateFrom: '2026-09-21', dateTo: '2026-09-21', today: '2026-09-22', morningStatus: 'failed',
  }), true)
})

test('range containing today is withheld as a whole so no provisional worker rows can leak', () => {
  assert.equal(reportIsAvailable({
    dateFrom: '2026-09-20', dateTo: '2026-09-22', today: '2026-09-22', morningStatus: 'running',
  }), false)
  assert.match(migration, /'workers', '\[\]'::jsonb/)
  assert.match(migration, /'teams', '\[\]'::jsonb/)
  assert.match(migration, /'attendance', '\[\]'::jsonb/)
  assert.match(migration, /'mappedBiometricEvents', '\[\]'::jsonb/)
})

test('the central token-authenticated RPC performs the readiness check without exposing verification runs', () => {
  assert.match(migration, /perform public\.foreign_monitoring_require_session\(p_session_token\)/)
  assert.match(migration, /verification\.verification_type = 'morning'/)
  assert.match(migration, /verification\.status = 'complete'/)
  assert.match(migration, /v_today date := \(now\(\) at time zone 'Africa\/Kinshasa'\)::date/)
  assert.doesNotMatch(migration, /grant\s+(?:select|all).*on\s+(?:table\s+)?public\.attendance_verification_run/i)
})

test('a completed morning verification freezes one idempotent public snapshot', () => {
  assert.match(snapshotMigration, /foreign_monitoring_normal_report_snapshot/)
  assert.match(snapshotMigration, /after insert or update of status on public\.attendance_verification_run/)
  assert.match(snapshotMigration, /new\.verification_type='morning' and new\.status='complete'/)
  assert.match(snapshotMigration, /on conflict \(report_date\) do nothing/)
})

test('today reads only its frozen snapshot while historical ranges use the normal payload', () => {
  assert.match(snapshotMigration, /select payload into v_snapshot from public\.foreign_monitoring_normal_report_snapshot where report_date=v_today/)
  assert.match(snapshotMigration, /if v_snapshot is null then[\s\S]*'reportAvailable',false/)
  assert.match(snapshotMigration, /select public\.foreign_monitoring_normal_report_payload\(p_date_from,p_date_to\) into v_snapshot/)
})

test('snapshot payload excludes Administration and has the existing export data fields', () => {
  assert.match(snapshotMigration, /t\.name is distinct from 'Adminstration'/)
  for (const key of ['workers', 'teams', 'attendance', 'mappedBiometricEvents']) {
    assert.match(snapshotMigration, new RegExp(`'${key}'`))
  }
})
