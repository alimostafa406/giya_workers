import { activeWorkersOnly } from './activeWorkers.js'

const text = (value) => String(value || '').trim()

export const isCompensationReviewWorker = (worker) => (
  worker?.staff_classification !== 'special_staff'
)

export const hasConfiguredBaseCompensation = (worker) => {
  const compensation = worker?.payroll_compensation
  const value = worker?.payment_type === 'monthly'
    ? compensation?.monthly_salary
    : compensation?.daily_rate
  if (value == null || String(value).trim() === '') return false
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0
}

export const hasStoredTransportAllowance = (worker) => {
  const value = worker?.payroll_compensation?.daily_transport_allowance
  if (value == null || String(value).trim() === '') return false
  return Number.isFinite(Number(value))
}

const groupByTeam = (workers) => {
  const groups = new Map()

  workers.forEach((worker) => {
    const paymentType = worker.payment_type === 'monthly' ? 'monthly' : 'weekly'
    const compensation = worker.payroll_compensation || null
    const teamId = text(worker.team_id) || 'unassigned'
    const teamName = text(worker.team?.name || worker.team_name) || null
    const group = groups.get(teamId) || { id: teamId, name: teamName, workers: [] }

    group.workers.push({
      id: worker.id,
      name: text(worker.full_name) || '—',
      employeeCode: text(worker.employee_code) || null,
      paymentType,
      currency: text(compensation?.currency_code) || null,
      dailyRate: paymentType === 'weekly' ? compensation?.daily_rate ?? null : null,
      monthlySalary: paymentType === 'monthly' ? compensation?.monthly_salary ?? null : null,
      transportAllowance: compensation?.daily_transport_allowance ?? null,
    })
    groups.set(teamId, group)
  })

  return [...groups.values()]
    .map((group) => ({
      ...group,
      workers: group.workers.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export const buildCompensationReviewSections = (workers = []) => {
  const reviewWorkers = activeWorkersOnly(workers)
    .filter(isCompensationReviewWorker)
  const weeklyWorkers = reviewWorkers.filter((worker) => worker.payment_type === 'weekly')
  const monthlyWorkers = reviewWorkers.filter((worker) => worker.payment_type === 'monthly')

  return {
    weeklyGroups: groupByTeam(weeklyWorkers),
    monthlyGroups: groupByTeam(monthlyWorkers),
    weeklyCount: weeklyWorkers.length,
    monthlyCount: monthlyWorkers.length,
    workerCount: reviewWorkers.length,
    missingBaseCompensationCount: reviewWorkers.filter((worker) => !hasConfiguredBaseCompensation(worker)).length,
    missingTransportCount: reviewWorkers.filter((worker) => !hasStoredTransportAllowance(worker)).length,
    noTeamCount: reviewWorkers.filter((worker) => !text(worker.team_id)).length,
  }
}
