import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canPublishCurrentWeeklyPayroll, isPublishedWeeklyPayrollActiveOn, normalizeCurrentWeeklyPayrollPublication } from './src/utils/payrollPublication.js'
import { resolveCurrentWeeklyPayrollRun, summarizeCurrentWeeklyPayrollWorkflow } from './src/utils/currentWeeklyPayrollWorkflow.js'

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

test('publication resolves the same canonical current-week run as Weekly Payroll', () => {
  const runs = [
    { id: 'monthly', payment_type: 'monthly', weekly_period_start: null, weekly_period_end: null, scheduled_payment_date: '2026-09-12', status: 'finalized' },
    { id: 'weekly', payment_type: 'weekly', weekly_period_start: '2026-09-07', weekly_period_end: '2026-09-12', scheduled_payment_date: '2026-09-12', status: 'finalized', currency_code: 'CDF' },
  ]
  assert.equal(resolveCurrentWeeklyPayrollRun(runs, '2026-09-07', '2026-09-12')?.id, 'weekly')
  const weeklyPage = fs.readFileSync('src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const publicationPage = fs.readFileSync('src/pages/PayrollPublication.jsx', 'utf8')
  assert.match(weeklyPage, /getPayrollOperationsDataRequest/)
  assert.match(weeklyPage, /run\.payment_type === 'weekly'.*run\.weekly_period_start === monday.*run\.weekly_period_end === saturday.*run\.scheduled_payment_date === saturday/)
  assert.match(publicationPage, /getPayrollOperationsDataRequest/)
  assert.match(publicationPage, /summarizeCurrentWeeklyPayrollWorkflow/)
})

test('unsaved current week shows real weekly population but never exposes draft totals', () => {
  const summary = summarizeCurrentWeeklyPayrollWorkflow({
    weekStart: '2026-09-07', weekEnd: '2026-09-12',
    data: {
      runs: [], payrollLines: [],
      workers: [
        { id: 'w1', is_active: true, payment_type: 'weekly', team_id: 't1' },
        { id: 'w2', is_active: true, payment_type: 'weekly', team_id: 't2' },
        { id: 'w3', is_active: true, payment_type: 'monthly', team_id: 't2' },
        { id: 'w4', is_active: false, payment_type: 'weekly', team_id: 't2' },
      ],
    },
  })
  assert.equal(summary.runStatus, 'not_saved')
  assert.equal(summary.workerCount, 2)
  assert.equal(summary.teamCount, 2)
  assert.deepEqual(summary.totals, [])
  assert.equal(summary.publishable, false)
  assert.equal(canPublishCurrentWeeklyPayroll(summary), false)
})

test('only stored finalized weekly lines provide publication totals', () => {
  const data = {
    runs: [{ id: 'r1', payment_type: 'weekly', weekly_period_start: '2026-09-07', weekly_period_end: '2026-09-12', scheduled_payment_date: '2026-09-12', status: 'finalized', currency_code: 'CDF' }],
    workers: [
      { id: 'w1', is_active: true, payment_type: 'weekly', team_id: 't1' },
      { id: 'w2', is_active: true, payment_type: 'weekly', team_id: 't1' },
      { id: 'm1', is_active: true, payment_type: 'monthly', team_id: 't1' },
    ],
    payrollLines: [
      { payroll_run_id: 'r1', worker_id: 'w1', payment_type_snapshot: 'weekly', currency_code_snapshot: 'CDF', final_amount: 100 },
      { payroll_run_id: 'r1', worker_id: 'w2', payment_type_snapshot: 'weekly', currency_code_snapshot: 'CDF', final_amount: 50 },
      { payroll_run_id: 'r1', worker_id: 'm1', payment_type_snapshot: 'monthly', currency_code_snapshot: 'CDF', final_amount: 999 },
    ],
  }
  const summary = summarizeCurrentWeeklyPayrollWorkflow({ data, weekStart: '2026-09-07', weekEnd: '2026-09-12' })
  assert.equal(summary.workerCount, 2)
  assert.equal(summary.teamCount, 1)
  assert.deepEqual(summary.totals, [{ currency: 'CDF', amount: 150 }])
  assert.equal(summary.publishable, true)
  assert.equal(canPublishCurrentWeeklyPayroll(summary), true)

  data.runs[0].status = 'reviewed'
  const reviewed = summarizeCurrentWeeklyPayrollWorkflow({ data, weekStart: '2026-09-07', weekEnd: '2026-09-12' })
  assert.equal(reviewed.runStatus, 'reviewed')
  assert.deepEqual(reviewed.totals, [])
  assert.equal(canPublishCurrentWeeklyPayroll(reviewed), false)
})
