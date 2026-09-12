import { isActiveWorker } from './activeWorkers.js'

const FINAL_STATUSES = new Set(['finalized', 'paid'])
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0

export const currentWeeklyPayrollRuns = (runs = [], weekStart, weekEnd) => (
  (Array.isArray(runs) ? runs : []).filter((run) => (
    run?.payment_type === 'weekly'
    && run.weekly_period_start === weekStart
    && run.weekly_period_end === weekEnd
    && run.scheduled_payment_date === weekEnd
  ))
)

// payroll_run is returned newest-first by getPayrollOperationsDataRequest.
// This mirrors the exact period key used by the existing Weekly Payroll page.
export const resolveCurrentWeeklyPayrollRun = (runs = [], weekStart, weekEnd) => (
  currentWeeklyPayrollRuns(runs, weekStart, weekEnd)[0] || null
)

export const summarizeCurrentWeeklyPayrollWorkflow = ({ data = {}, weekStart, weekEnd }) => {
  const run = resolveCurrentWeeklyPayrollRun(data.runs, weekStart, weekEnd)
  const weeklyWorkers = (data.workers || []).filter((worker) => isActiveWorker(worker) && worker.payment_type === 'weekly')
  const workerById = new Map((data.workers || []).map((worker) => [String(worker.id), worker]))
  const snapshotLines = run
    ? (data.payrollLines || []).filter((line) => String(line.payroll_run_id) === String(run.id) && line.payment_type_snapshot === 'weekly')
    : []
  const isFinalized = Boolean(run && FINAL_STATUSES.has(run.status))
  const countWorkers = snapshotLines.length ? snapshotLines : weeklyWorkers.map((worker) => ({ worker_id: worker.id }))
  const teamIds = new Set(countWorkers.map((line) => workerById.get(String(line.worker_id))?.team_id).filter(Boolean).map(String))
  const totals = new Map()

  if (isFinalized) {
    snapshotLines.forEach((line) => {
      const currency = line.currency_code_snapshot || run.currency_code || 'CDF'
      totals.set(currency, numeric(totals.get(currency)) + numeric(line.final_amount))
    })
  }

  return {
    weekStart,
    weekEnd,
    run,
    runStatus: run?.status || 'not_saved',
    workerCount: new Set(countWorkers.map((line) => String(line.worker_id))).size,
    teamCount: teamIds.size,
    finalizedRunCount: isFinalized && snapshotLines.length > 0 ? 1 : 0,
    unfinishedRunCount: run && (!isFinalized || snapshotLines.length === 0) ? 1 : 0,
    totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
    publishable: isFinalized && snapshotLines.length > 0,
  }
}
