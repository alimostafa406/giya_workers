import { getSupabaseClient } from '../lib/supabase'
import { getWorkersRequest, saveWorkerPayrollProfileRequest } from './workersApi'

const asArray = (value) => (Array.isArray(value) ? value : [])

const localIsoDate = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const numberOrNull = (value) => value === '' || value == null ? null : Number(value)

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
  const effectiveFrom = values.effective_from || localIsoDate()
  const paymentType = values.payment_type
  const monthlySalary = numberOrNull(values.monthly_salary)
  const dailyRate = numberOrNull(values.daily_rate)
  const dailyTransportAllowance = numberOrNull(values.daily_transport_allowance) ?? 0
  const overtimeRate = numberOrNull(values.overtime_rate_per_hour)

  if (!['weekly', 'monthly'].includes(paymentType)) {
    throw new Error('Payment type must be explicitly set to weekly or monthly.')
  }
  if (effectiveFrom < localIsoDate()) {
    throw new Error('Effective date cannot be in the past.')
  }
  if (worker.payment_type && paymentType !== worker.payment_type && effectiveFrom !== localIsoDate()) {
    throw new Error('A payment-type change must take effect today so the worker profile and active compensation stay consistent.')
  }
  if (paymentType === 'weekly' && (dailyRate == null || dailyRate < 0)) {
    throw new Error('A non-negative daily rate is required for weekly workers.')
  }
  if (paymentType === 'monthly' && (monthlySalary == null || monthlySalary < 0)) {
    throw new Error('A non-negative monthly salary is required for monthly workers.')
  }
  if (paymentType === 'monthly' && !values.monthly_payroll_cycle_start_date) {
    throw new Error('Monthly payroll cycle start date is required for monthly workers.')
  }
  if ([dailyTransportAllowance, overtimeRate].some((amount) => amount != null && amount < 0)) {
    throw new Error('Payroll amounts cannot be negative.')
  }

  const client = getSupabaseClient()
  const compensationPayload = {
    worker_id: worker.id,
    payment_type: paymentType,
    effective_from: effectiveFrom,
    currency_code: String(values.currency_code || (paymentType === 'monthly' ? 'USD' : 'CDF')).toUpperCase(),
    daily_rate: paymentType === 'weekly' ? dailyRate : null,
    daily_transport_allowance: dailyTransportAllowance,
    overtime_rate_per_hour: overtimeRate,
    overtime_start_time: values.overtime_start_time || null,
    monthly_salary: paymentType === 'monthly' ? monthlySalary : null,
    monthly_payroll_cycle_start_date: paymentType === 'monthly' ? values.monthly_payroll_cycle_start_date : null,
  }

  // A term is keyed by worker/effective date. Re-saving a planned current or
  // future date corrects that term; a later effective date always preserves it.
  const { error: termError } = await client
    .from('worker_payroll_compensation')
    .upsert(compensationPayload, { onConflict: 'worker_id,effective_from' })

  if (termError) throw termError

  await saveWorkerPayrollProfileRequest(worker.id, {
    payment_type: paymentType,
    monthly_salary: paymentType === 'monthly' ? monthlySalary : null,
  })
}

export { localIsoDate }
