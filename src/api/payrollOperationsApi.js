import { getSupabaseClient } from '../lib/supabase'
import { getAttendanceRequest } from './attendanceApi'
import { getPayrollSettingsWorkersRequest } from './payrollSettingsApi'
import { applyPayrollAdjustments } from '../utils/payrollCalculations'

export const getPayrollOperationsDataRequest = async () => {
  const client = getSupabaseClient()
  const [workersResult, attendanceResult, rulesResult, holidaysResult, runsResult, linesResult, adjustmentsResult] = await Promise.all([
    getPayrollSettingsWorkersRequest(), getAttendanceRequest(),
    client.from('payroll_rule_set').select('*').eq('is_active', true).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
    client.from('company_holiday').select('holiday_date,name').eq('is_active', true),
    client.from('payroll_run').select('id,payment_type,status,scheduled_payment_date,weekly_period_start,weekly_period_end,currency_code,created_at,reviewed_by,reviewed_at,finalized_by,finalized_at,paid_by,paid_at').order('created_at', { ascending: false }),
    client.from('payroll_line').select('id,payroll_run_id,worker_id,attendance_period_start,attendance_period_end,payment_due_date,worker_name_snapshot,payment_type_snapshot,currency_code_snapshot,compensation_snapshot,rule_snapshot,attendance_summary_snapshot,calculation_snapshot,present_days,half_days,absent_days,base_amount,transport_amount,overtime_hours,overtime_amount,holiday_amount,bonus_amount,deduction_amount,advance_amount,manual_adjustment_amount,final_amount'),
    client.from('payroll_adjustment').select('id,payroll_line_id,adjustment_type,amount,reason,created_at,created_by,voided_at,voided_by,void_reason').order('created_at', { ascending: false }),
  ])
  if (rulesResult.error) throw rulesResult.error
  if (holidaysResult.error) throw holidaysResult.error
  if (runsResult.error) throw runsResult.error
  if (linesResult.error) throw linesResult.error
  if (adjustmentsResult.error) throw adjustmentsResult.error
  return { workers: workersResult.data, attendance: attendanceResult.data, rules: rulesResult.data, holidays: holidaysResult.data || [], runs: runsResult.data || [], payrollLines: linesResult.data || [], payrollAdjustments: adjustmentsResult.data || [] }
}

const linePayload = (runId, line, periodStart, periodEnd, dueDate) => ({
  payroll_run_id: runId, worker_id: line.worker.id, attendance_period_start: periodStart, attendance_period_end: periodEnd, payment_due_date: dueDate,
  worker_name_snapshot: line.worker.full_name || '-', payment_type_snapshot: line.paymentType, currency_code_snapshot: line.currency,
  monthly_payroll_cycle_start_date_snapshot: line.term?.monthly_payroll_cycle_start_date || null,
  compensation_snapshot: line.term || {}, rule_snapshot: line.rules || {},
  attendance_summary_snapshot: { present_days: line.presentDays, half_days: line.halfDays, absent_days: line.absentDays, unresolved_days: line.unresolvedDays, days: (line.details || []).map((detail) => ({ date: detail.date, status: detail.status, check_in: detail.row?.check_in || null, check_out: detail.row?.check_out || null })) },
  calculation_snapshot: { daily_value: line.dailyValue, attendance_wage: line.attendanceWage, absence_deduction: line.absenceDeduction, half_day_deduction: line.halfDayDeduction, transport_days: line.transportDays, adjustment_summary: line.adjustmentSummary || {}, final_amount: line.finalAmount },
  present_days: line.presentDays, half_days: line.halfDays, absent_days: line.absentDays, base_amount: line.baseAmount, transport_amount: line.transportAmount,
  overtime_hours: line.overtimeHours, overtime_amount: line.overtimeAmount, holiday_amount: line.holidayAmount,
  // A Draft line is recalculable, but its persisted snapshot must still include
  // the active adjustments that produced its displayed final amount.  This is
  // especially important once the run moves to Reviewed/Finalized.
  bonus_amount: line.bonusAmount || 0,
  deduction_amount: line.deductionAmount || 0,
  advance_amount: line.advanceAmount || 0,
  manual_adjustment_amount: line.manualAdjustmentAmount || 0,
  final_amount: line.finalAmount,
})

export const persistPayrollDraftRequest = async ({ paymentType, periodStart = null, periodEnd = null, dueDate, currency, ruleSetId, lines }) => {
  const client = getSupabaseClient()
  let protectedRunQuery = client.from('payroll_run').select('id,status').eq('payment_type', paymentType).eq('scheduled_payment_date', dueDate).eq('currency_code', currency).neq('status', 'draft')
  protectedRunQuery = paymentType === 'weekly' ? protectedRunQuery.eq('weekly_period_start', periodStart).eq('weekly_period_end', periodEnd) : protectedRunQuery.is('weekly_period_start', null).is('weekly_period_end', null)
  const { data: protectedRuns, error: protectedRunError } = await protectedRunQuery.limit(1)
  if (protectedRunError) throw protectedRunError
  if (protectedRuns?.[0]) throw new Error('This payroll period is already reviewed, finalized, or paid and cannot be refreshed as Draft.')
  let query = client.from('payroll_run').select('id,status').eq('payment_type', paymentType).eq('scheduled_payment_date', dueDate).eq('currency_code', currency).eq('status', 'draft')
  query = paymentType === 'weekly' ? query.eq('weekly_period_start', periodStart).eq('weekly_period_end', periodEnd) : query.is('weekly_period_start', null).is('weekly_period_end', null)
  const { data: found, error: findError } = await query.limit(1)
  if (findError) throw findError
  let run = found?.[0]
  if (!run) {
    const { data, error } = await client.from('payroll_run').insert({ payment_type: paymentType, weekly_period_start: periodStart, weekly_period_end: periodEnd, scheduled_payment_date: dueDate, currency_code: currency, rule_set_id: ruleSetId, status: 'draft' }).select('id,status').single()
    if (error) throw error
    run = data
  }
  const { data: existingLines, error: existingLinesError } = await client.from('payroll_line').select('id,worker_id').eq('payroll_run_id', run.id)
  if (existingLinesError) throw existingLinesError
  const lineIdByWorkerId = new Map((existingLines || []).map((line) => [String(line.worker_id), line.id]))
  const existingLineIds = [...lineIdByWorkerId.values()]
  let adjustments = []
  if (existingLineIds.length) {
    const { data, error } = await client.from('payroll_adjustment').select('payroll_line_id,adjustment_type,amount,voided_at').in('payroll_line_id', existingLineIds)
    if (error) throw error
    adjustments = data || []
  }
  const adjustmentsByLineId = new Map()
  adjustments.forEach((adjustment) => {
    const items = adjustmentsByLineId.get(String(adjustment.payroll_line_id)) || []
    items.push(adjustment)
    adjustmentsByLineId.set(String(adjustment.payroll_line_id), items)
  })
  const payload = lines.map((line) => {
    const existingLineId = lineIdByWorkerId.get(String(line.worker.id))
    const adjustedLine = applyPayrollAdjustments(line, existingLineId ? adjustmentsByLineId.get(String(existingLineId)) || [] : [])
    return linePayload(run.id, adjustedLine, line.cycle?.start || periodStart, line.cycle?.end || periodEnd, line.cycle?.due || dueDate)
  })
  const { error: lineError } = await client.from('payroll_line').upsert(payload, { onConflict: 'payroll_run_id,worker_id' })
  if (lineError) throw lineError
  return run
}

const requireDraftLine = async (client, payrollLineId) => {
  const { data, error } = await client
    .from('payroll_line')
    .select('id,payroll_run_id,payroll_run!inner(status,payment_type)')
    .eq('id', payrollLineId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.payroll_run?.status !== 'draft' || !['weekly', 'monthly'].includes(data.payroll_run?.payment_type)) {
    throw new Error('Payroll adjustments are available only for a Draft payroll line.')
  }
  return data
}

const currentAdminId = async (client) => {
  const { data: { user }, error } = await client.auth.getUser()
  if (error) throw error
  if (!user?.id) throw new Error('An active admin session is required.')
  return user.id
}

export const createPayrollAdjustmentRequest = async ({ payrollLineId, adjustmentType, amount, reason }) => {
  const client = getSupabaseClient()
  const normalizedReason = String(reason || '').trim()
  const numericAmount = Number(amount)
  if (!normalizedReason || !Number.isFinite(numericAmount) || numericAmount === 0) {
    throw new Error('A non-zero adjustment amount and reason are required.')
  }
  await requireDraftLine(client, payrollLineId)
  const createdBy = await currentAdminId(client)
  const { data, error } = await client.from('payroll_adjustment').insert({
    payroll_line_id: payrollLineId,
    adjustment_type: adjustmentType,
    amount: numericAmount,
    reason: normalizedReason,
    created_by: createdBy,
  }).select('id').single()
  if (error) throw error
  return data
}

export const voidPayrollAdjustmentRequest = async ({ adjustmentId, reason }) => {
  const client = getSupabaseClient()
  const normalizedReason = String(reason || '').trim()
  if (!normalizedReason) throw new Error('A void reason is required.')
  const { data: adjustment, error: readError } = await client.from('payroll_adjustment').select('id,payroll_line_id,voided_at').eq('id', adjustmentId).maybeSingle()
  if (readError) throw readError
  if (!adjustment || adjustment.voided_at) throw new Error('This adjustment is already voided or unavailable.')
  await requireDraftLine(client, adjustment.payroll_line_id)
  const voidedBy = await currentAdminId(client)
  const { error } = await client.from('payroll_adjustment').update({ voided_at: new Date().toISOString(), voided_by: voidedBy, void_reason: normalizedReason }).eq('id', adjustmentId).is('voided_at', null)
  if (error) throw error
}

export const setWeeklyPayrollRunStatusRequest = async ({ runId, nextStatus }) => {
  const client = getSupabaseClient()
  const { data: run, error: readError } = await client
    .from('payroll_run')
    .select('id,payment_type,status')
    .eq('id', runId)
    .maybeSingle()
  if (readError) throw readError
  if (!run?.id || !['weekly', 'monthly'].includes(run.payment_type)) throw new Error('Payroll run not found.')
  const allowed = (run.status === 'draft' && nextStatus === 'reviewed')
    || (run.status === 'reviewed' && ['draft', 'finalized'].includes(nextStatus))
    || (run.status === 'finalized' && nextStatus === 'paid')
  if (!allowed) throw new Error('This payroll status transition is not allowed.')

  const adminId = await currentAdminId(client)
  const audit = nextStatus === 'reviewed'
    ? { reviewed_by: adminId, reviewed_at: new Date().toISOString() }
    : nextStatus === 'finalized'
      ? { finalized_by: adminId, finalized_at: new Date().toISOString() }
      : nextStatus === 'paid'
        ? { paid_by: adminId, paid_at: new Date().toISOString() }
        : {}
  const { data, error } = await client
    .from('payroll_run')
    .update({ status: nextStatus, ...audit })
    .eq('id', runId)
    .select('id,status,reviewed_by,reviewed_at,finalized_by,finalized_at,paid_by,paid_at')
    .single()
  if (error) throw error
  return data
}
