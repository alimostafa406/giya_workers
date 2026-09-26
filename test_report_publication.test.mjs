import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReportPublicationDays } from './src/utils/reportPublication.js'
import { readFileSync } from 'node:fs'

const worker = { id: 'w', full_name: 'Worker', is_active: true, staff_classification: 'normal', team_id: 't', team: { id: 't', name: 'Zarour' } }
const source = { business_date: '2026-09-26', available_dates: ['2026-09-21', '2026-09-22'], workers: [worker], mappings: [], evidence: [], overtime_team_ids: ['t'], attendance: [{ id: 'a', worker_id: 'w', worker, team: worker.team, attendance_date: '2026-09-21', status: 'present', attendance_day_fraction: 1, check_in: '08:00:00', check_out: '23:06:19' }] }
test('snapshot reuses canonical reports and freezes only allowed Monday–Saturday days', () => {
  const before = JSON.stringify(source)
  const days = buildReportPublicationDays(source)
  assert.deepEqual(days.map(d => d.date), source.available_dates)
  assert.equal(days[0].attendance[0].status, 'present')
  assert.equal(days[0].overtime[0].overtime_minutes, 360)
  assert.equal(days[1].attendance[0].status, 'absent')
  assert.equal(JSON.stringify(source), before)
  assert.equal('payroll_profile' in days[0].attendance[0], false)
})
test('saved team filter, 2h threshold and Chauffeur exclusion remain unchanged', () => {
  assert.equal(buildReportPublicationDays({ ...source, overtime_team_ids: [] })[0].overtime.length, 0)
  assert.equal(buildReportPublicationDays({ ...source, attendance: [{ ...source.attendance[0], check_out: '18:39:00' }] })[0].overtime.length, 0)
  const chauffeur = { ...worker, team: { id: 't', name: 'Chauffeur' } }
  assert.equal(buildReportPublicationDays({ ...source, workers: [chauffeur], attendance: [{ ...source.attendance[0], worker: chauffeur, team: chauffeur.team }] })[0].overtime.length, 0)
})
test('Adminstration, special staff and future operational start remain excluded', () => {
  const excluded = [ { ...worker, id: 'admin', team: { name: 'Adminstration' } }, { ...worker, id: 'special', staff_classification: 'special_staff' }, { ...worker, id: 'future', operational_start_date: '2026-09-23' } ]
  assert.equal(buildReportPublicationDays({ ...source, workers: [worker, ...excluded] })[0].attendance.length, 1)
})
test('SQL uses independent storage, admin checks, RLS and no attendance/payroll mutations', () => {
  const sql = readFileSync(new URL('./supabase/migrations/20260926113735_independent_report_publication.sql', import.meta.url), 'utf8')
  assert.match(sql, /enable row level security/)
  assert.match(sql, /foreign_monitoring_require_session/)
  assert.match(sql, /source changed/i)
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public\.(?:attendance\b|workers\b|weekly_payroll|payroll)/i)
})
