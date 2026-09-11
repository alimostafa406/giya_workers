import { activeWorkersOnly } from './activeWorkers.js'

const text = (value) => String(value || '').trim()

export const buildCompensationReviewGroups = (workers = []) => {
  const groups = new Map()

  activeWorkersOnly(workers).forEach((worker) => {
    const paymentType = worker.payment_type === 'monthly' ? 'monthly' : 'weekly'
    const compensation = worker.payroll_compensation || null
    const teamId = text(worker.team_id) || 'unassigned'
    const teamName = text(worker.team?.name || worker.team_name) || '—'
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
