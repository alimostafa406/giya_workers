import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canPublishCurrentWeeklyPayroll, isPublishedWeeklyPayrollActiveOn, normalizeCurrentWeeklyPayrollPublication } from './src/utils/payrollPublication.js'

const current = normalizeCurrentWeeklyPayrollPublication({
  weekStart: '2026-09-07', weekEnd: '2026-09-12', finalizedRunCount: 2,
  unfinishedRunCount: 0, workerCount: 20, teamCount: 3,
  publicationStatus: 'published', viewerVisible: true,
  totals: [{ currency: 'CDF', amount: '100' }],
})

test('only the server-derived current Monday-Saturday payroll is available to the UI', () => {
  const page = fs.readFileSync('src/pages/PayrollPublication.jsx', 'utf8')
  const api = fs.readFileSync('src/api/payrollPublicationApi.js', 'utf8')
  assert.equal(current.weekStart, '2026-09-07')
  assert.equal(current.weekEnd, '2026-09-12')
  assert.doesNotMatch(page, /<select|previous|historical|selectedStart/i)
  assert.match(api, /get_current_weekly_payroll_publication_admin/)
  assert.match(api, /set_current_weekly_payroll_viewer_publication/)
  assert.doesNotMatch(api, /p_week_start|payment_type.*monthly/i)
})

test('current weekly payroll must be fully finalized before sending', () => {
  assert.equal(canPublishCurrentWeeklyPayroll(current), true)
  assert.equal(canPublishCurrentWeeklyPayroll({ ...current, unfinishedRunCount: 1 }), false)
  assert.equal(canPublishCurrentWeeklyPayroll({ ...current, finalizedRunCount: 0 }), false)
})

test('published payroll is active Saturday and Sunday, then expires Monday', () => {
  assert.equal(isPublishedWeeklyPayrollActiveOn(current, '2026-09-12'), true)
  assert.equal(isPublishedWeeklyPayrollActiveOn(current, '2026-09-13'), true)
  assert.equal(isPublishedWeeklyPayrollActiveOn(current, '2026-09-14'), false)
  assert.equal(isPublishedWeeklyPayrollActiveOn({ ...current, publicationStatus: 'unpublished' }, '2026-09-12'), false)
})

test('migration sends immutable weekly snapshots unchanged and never sends monthly payroll', () => {
  const sql = fs.readFileSync('supabase/sql/weekly_payroll_viewer_publication.sql', 'utf8')
  const executable = sql.replace(/--.*$/gm, '')
  assert.match(sql, /r\.payment_type = 'weekly'/)
  assert.match(sql, /l\.payment_type_snapshot = 'weekly'/)
  assert.match(sql, /r\.status in \('finalized', 'paid'\)/)
  assert.match(sql, /v_today between p\.week_start and p\.week_end \+ 1/)
  assert.match(sql, /'finalAmount', l\.final_amount/)
  assert.match(sql, /weekly_payroll_publication_audit/)
  assert.doesNotMatch(executable, /\b(update|delete from)\s+public\.(payroll_run|payroll_line|attendance|workers|worker_payroll_compensation)\b/i)
})

test('manual stop only changes publication visibility and preserves financial records', () => {
  const sql = fs.readFileSync('supabase/sql/weekly_payroll_viewer_publication.sql', 'utf8')
  assert.match(sql, /case when p_publish then 'published' else 'unpublished' end/)
  assert.doesNotMatch(sql, /delete from public\.(weekly_payroll_publication|weekly_payroll_publication_run|payroll_run|payroll_line)/i)
})

test('publishing confirms snapshot totals and does not recalculate payroll', () => {
  const source = fs.readFileSync('src/pages/PayrollPublication.jsx', 'utf8') + fs.readFileSync('src/api/payrollPublicationApi.js', 'utf8')
  assert.match(source, /window\.confirm/)
  assert.equal(current.workerCount, 20)
  assert.equal(current.teamCount, 3)
  assert.equal(current.totals[0].amount, 100)
  assert.doesNotMatch(source, /persistPayrollDraft|calculatePayroll|setWeeklyPayrollRunStatus/)
})
