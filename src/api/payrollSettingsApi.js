import { getSupabaseClient } from '../lib/supabase'
import { getWorkersRequest, saveWorkerPayrollProfileRequest } from './workersApi'
import { buildWorkerPayrollSettingsSavePlan } from '../utils/payrollSettings'

const asArray = (value) => (Array.isArray(value) ? value : [])

const localIsoDate = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const currentTermFor = (terms, today) => terms
  .filter((term) => term.effective_from <= today && (!term.effective_to || term.effective_to >= today))
  .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0] || null

export const getPayrollSettingsWorkersRequest = async () => {
  const client = getSupabaseClient()
  const [{ data: workers }, compensationResult, ruleResult] = await Promise.all([
    getWorkersRequest(),
    client
      .from('worker_payroll_compensation')
      .select('id,worker_id,payment_type,effective_from,effective_to,currency_code,daily_rate,daily_transport_allowance,overtime_rate_per_hour,overtime_start_time,monthly_salary,monthly_payroll_cycle_start_date')
      .order('effective_from', { ascending: false }),
    client
      .from('payroll_rule_set')
      .select('id,monthly_working_day_divisor,effective_from')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (compensationResult.error) throw compensationResult.error
  if (ruleResult.error) throw ruleResult.error

  const today = localIsoDate()
  const termsByWorker = new Map()
  asArray(compensationResult.data).forEach((term) => {
    const workerId = String(term.worker_id)
    termsByWorker.set(workerId, [...(termsByWorker.get(workerId) || []), term])
  })

  return {
    rules: ruleResult.data || null,
    data: asArray(workers).map((worker) => {
      const terms = termsByWorker.get(String(worker.id)) || []
      return {
        ...worker,
        payroll_compensation: currentTermFor(terms.filter((term) => term.payment_type === worker.payment_type), today),
        payroll_compensation_terms: terms,
      }
    }),
  }
}

export const saveWorkerPayrollSettingsRequest = async (worker, values) => {
  const plan = buildWorkerPayrollSettingsSavePlan(worker, values, localIsoDate())
  const client = getSupabaseClient()

  // A term is keyed by worker/effective date. Re-saving a planned current or
  // future date corrects that term; a later effective date always preserves it.
  if (plan.compensationPayload) {
    const { error: termError } = await client
      .from('worker_payroll_compensation')
      .upsert(plan.compensationPayload, { onConflict: 'worker_id,effective_from' })

    if (termError) throw termError
  }

  return saveWorkerPayrollProfileRequest(worker.id, plan.profilePayload)
}

export { localIsoDate }
