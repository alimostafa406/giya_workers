import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../../api/axios'
import { saveAttendanceManuallyRequest, updateAttendanceManuallyRequest } from '../../api/attendanceApi'
import { cancelSundayWorkRequest, confirmSundayWorkRequest, createPayrollAdjustmentRequest, getPayrollOperationsDataRequest, markSundayPaymentPaidRequest, persistPayrollDraftRequest, reversePaidSundayPaymentRequest, setWeeklyPayrollRunStatusRequest } from '../../api/payrollOperationsApi'
import { saveWorkerPayrollSettingsRequest } from '../../api/payrollSettingsApi'
import { applyPayrollAdjustments, calculatePayrollLine, mondayFor, sundayBefore, totalLines, weeklyDates } from '../../utils/payrollCalculations'
import { exportPayrollExcel, exportPayrollPdf, printPayrollReport } from '../../utils/payrollExports'
import { formatPayrollMoney } from '../../utils/payrollCurrency'
import { useTranslation } from '../../i18n/LanguageContext'
import AttendanceEditModal from '../Forms/AttendanceEditModal'
import Table from '../Table/Table'
import WeeklyPayrollSheet from './WeeklyPayrollSheet'
import WeeklyPayrollWorkerEditPanel from './WeeklyPayrollWorkerEditPanel'

const money = (amount, currency) => formatPayrollMoney(amount, { currency, paymentType: 'weekly' })

const weeklyLinesFor = (data, monday) => {
  const attendance = new Map((data?.attendance || []).map((row) => [`${row.worker_id}|${row.attendance_date}`, row]))
  const holidays = new Set((data?.holidays || []).map((item) => item.holiday_date))
  const saturday = weeklyDates(monday).at(-1)
  const sundayDate = sundayBefore(monday)
  const run = (data?.runs || []).find((item) => item.payment_type === 'weekly' && item.weekly_period_start === monday && item.weekly_period_end === saturday)
  return (data?.workers || [])
    .filter((worker) => worker.is_active !== false && worker.payment_type === 'weekly')
    .map((worker) => {
      const sundayPayment = (data?.sundayPayments || []).find((payment) => String(payment.worker_id) === String(worker.id) && payment.work_date === sundayDate) || null
      return { ...calculatePayrollLine({
      worker,
      term: worker.payroll_compensation,
      attendanceByDate: attendance,
      dates: weeklyDates(monday),
      rules: data?.rules,
      holidayDates: holidays,
      paymentType: 'weekly',
      futureDatesAreNeutral: true,
      }), sundayDate, sundayPayment }
    })
}

const numeric = (value) => Math.round((Number(value) || 0) * 100) / 100

export default function PayrollOperations() {
  const { t, language, direction } = useTranslation()
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [monday, setMonday] = useState(mondayFor()); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(''); const [selectedTeamId, setSelectedTeamId] = useState(''); const [editingWorkerId, setEditingWorkerId] = useState(''); const [editingAttendance, setEditingAttendance] = useState(null); const [savingAttendance, setSavingAttendance] = useState(false); const [savingSheetWorkerId, setSavingSheetWorkerId] = useState(''); const [runActionSaving, setRunActionSaving] = useState(false); const [reviewErrors, setReviewErrors] = useState([])
  const load = async () => { setLoading(true); try { const result = await getPayrollOperationsDataRequest(); setData(result); setError(''); return result } catch (e) { setError(getErrorMessage(e)); return null } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const saturday = weeklyDates(monday).at(-1)
  const weeklyRun = useMemo(() => data?.runs?.find((run) => run.payment_type === 'weekly' && run.weekly_period_start === monday && run.weekly_period_end === saturday && run.scheduled_payment_date === saturday) || null, [data, monday, saturday])
  const draftRun = weeklyRun?.status === 'draft' ? weeklyRun : null
  const payrollLineByWorkerId = useMemo(() => new Map((data?.payrollLines || []).filter((line) => line.payroll_run_id === weeklyRun?.id).map((line) => [String(line.worker_id), line])), [data, weeklyRun])
  const adjustmentsByLineId = useMemo(() => {
    const grouped = new Map()
    ;(data?.payrollAdjustments || []).forEach((adjustment) => {
      const items = grouped.get(String(adjustment.payroll_line_id)) || []
      items.push(adjustment)
      grouped.set(String(adjustment.payroll_line_id), items)
    })
    return grouped
  }, [data])
  const calculatedLines = useMemo(() => weeklyLinesFor(data, monday).map((line) => {
    const payrollLine = payrollLineByWorkerId.get(String(line.worker.id))
    return payrollLine ? applyPayrollAdjustments(line, adjustmentsByLineId.get(String(payrollLine.id)) || []) : line
  }), [adjustmentsByLineId, data, monday, payrollLineByWorkerId])
  const storedLines = useMemo(() => (data?.payrollLines || []).filter((line) => line.payroll_run_id === weeklyRun?.id).map((stored) => {
    const worker = (data?.workers || []).find((item) => String(item.id) === String(stored.worker_id)) || { id: stored.worker_id, full_name: stored.worker_name_snapshot, employee_code: null, team_id: null, team_name: null }
    const summary = stored.attendance_summary_snapshot || {}
    const calculation = stored.calculation_snapshot || {}
    return {
      worker,
      term: stored.compensation_snapshot || {},
      rules: stored.rule_snapshot || {},
      paymentType: stored.payment_type_snapshot,
      currency: stored.currency_code_snapshot,
      presentDays: Number(stored.present_days || 0), halfDays: Number(stored.half_days || 0), absentDays: Number(stored.absent_days || 0), unresolvedDays: Number(summary.unresolved_days || 0),
      attendanceWage: Number(calculation.attendance_wage ?? stored.base_amount ?? 0), baseAmount: Number(stored.base_amount || 0), transportAmount: Number(stored.transport_amount || 0), overtimeHours: Number(stored.overtime_hours || 0), overtimeAmount: Number(stored.overtime_amount || 0), holidayAmount: Number(stored.holiday_amount || 0), sundayDate: sundayBefore(stored.attendance_period_start), sundayPayment: (data?.sundayPayments || []).find((payment) => String(payment.worker_id) === String(stored.worker_id) && payment.work_date === sundayBefore(stored.attendance_period_start)) || null, bonusAmount: Number(stored.bonus_amount || 0), deductionAmount: Number(stored.deduction_amount || 0), advanceAmount: Number(stored.advance_amount || 0), manualAdjustmentAmount: Number(stored.manual_adjustment_amount || 0), finalAmount: Number(stored.final_amount || 0),
      calculationSnapshotHasAdjustments: Object.prototype.hasOwnProperty.call(calculation, 'adjustment_summary'),
      details: (summary.days || []).map((detail) => ({ ...detail, row: detail.check_in || detail.check_out ? { check_in: detail.check_in, check_out: detail.check_out } : null })),
    }
  }), [data, weeklyRun])
  const lines = weeklyRun && weeklyRun.status !== 'draft' ? storedLines : calculatedLines
  const totals = totalLines(lines)
  const runStatusLabel = weeklyRun?.status === 'reviewed' ? t('payroll.statusReviewed') : weeklyRun?.status === 'finalized' ? t('payroll.statusFinalized') : weeklyRun?.status === 'paid' ? t('payroll.statusPaid') : t('payroll.statusDraft')
  const teamGroups = useMemo(() => {
    const groups = new Map()
    lines.forEach((line) => {
      const id = String(line.worker.team_id || 'unassigned')
      const group = groups.get(id) || { id, name: line.worker.team_name || t('common.unknown'), lines: [] }
      group.lines.push(line)
      groups.set(id, group)
    })
    return [...groups.values()].map((group) => ({ ...group, totals: totalLines(group.lines) }))
  }, [lines, t])
  const selectedTeam = teamGroups.find((group) => group.id === selectedTeamId) || null
  const editingLine = selectedTeam?.lines.find((line) => String(line.worker.id) === String(editingWorkerId)) || null
  const teamExportHeaders = [t('payroll.worker'), t('workers.employeeCode'), t('payroll.presentDays'), t('payroll.halfDays'), t('payroll.absentDays'), t('payroll.dailyRate'), t('payroll.attendanceWage'), t('payroll.transport'), t('payroll.overtimeHours'), t('payroll.overtimeAmount'), t('payroll.holidaySunday'), t('payroll.bonuses'), t('payroll.deductions'), t('payroll.advances'), t('payroll.otherAdjustments'), t('payroll.finalPay')]
  const teamExportRows = selectedTeam?.lines.map((line) => [line.worker.full_name, line.worker.employee_code || '—', line.presentDays, line.halfDays, line.absentDays, numeric(line.term?.daily_rate), numeric(line.attendanceWage), numeric(line.transportAmount), numeric(line.overtimeHours), numeric(line.overtimeAmount), numeric(line.holidayAmount), numeric(line.bonusAmount), numeric(line.deductionAmount), numeric(line.advanceAmount), numeric(line.manualAdjustmentAmount), numeric(line.finalAmount)]) || []
  const teamExportTotals = selectedTeam ? [[t('payroll.finalTeamPayrollTotal'), '', selectedTeam.totals.presentDays, selectedTeam.totals.halfDays, selectedTeam.totals.absentDays, '', numeric(selectedTeam.totals.baseAmount), numeric(selectedTeam.totals.transportAmount), numeric(selectedTeam.totals.overtimeHours), numeric(selectedTeam.totals.overtimeAmount), numeric(selectedTeam.totals.holidayAmount), numeric(selectedTeam.totals.bonusAmount), numeric(selectedTeam.totals.deductionAmount), numeric(selectedTeam.totals.advanceAmount), numeric(selectedTeam.totals.manualAdjustmentAmount), numeric(selectedTeam.totals.finalAmount)]] : []
  const allTeamsHeaders = [t('common.team'), t('payroll.workers'), t('payroll.presentDays'), t('payroll.halfDays'), t('payroll.absentDays'), t('payroll.attendanceWage'), t('payroll.transport'), t('payroll.overtime'), t('payroll.holidaySunday'), t('payroll.adjustments'), t('payroll.finalTeamPayrollTotal')]
  const allTeamsRows = teamGroups.map((group) => [group.name, group.totals.workers, group.totals.presentDays, group.totals.halfDays, group.totals.absentDays, numeric(group.totals.baseAmount), numeric(group.totals.transportAmount), numeric(group.totals.overtimeAmount), numeric(group.totals.holidayAmount), numeric(group.totals.bonusAmount - group.totals.deductionAmount - group.totals.advanceAmount + group.totals.manualAdjustmentAmount), numeric(group.totals.finalAmount)])
  const allTeamsTotals = [[t('payroll.allTeamsPayrollTotal'), totals.workers, totals.presentDays, totals.halfDays, totals.absentDays, numeric(totals.baseAmount), numeric(totals.transportAmount), numeric(totals.overtimeAmount), numeric(totals.holidayAmount), numeric(totals.bonusAmount - totals.deductionAmount - totals.advanceAmount + totals.manualAdjustmentAmount), numeric(totals.finalAmount)]]
  const exportMetadata = (teamName = null) => [
    `${t('common.status')}: ${weeklyRun ? runStatusLabel : t('payroll.preview')}`,
    teamName ? `${t('common.team')}: ${teamName}` : `${t('payroll.allTeamsSummary')}`,
    `${t('payroll.payrollPeriod')}: ${monday} → ${saturday}`,
    `${t('payroll.paymentDueDate')}: ${saturday}`,
    `${t('payroll.currency')}: CDF`,
  ]
  const exportTeam = (kind) => {
    if (!selectedTeam) return
    const config = { title: `${t('payroll.weeklyPayrollReport')} — ${selectedTeam.name}`, metadata: exportMetadata(selectedTeam.name), headers: teamExportHeaders, rows: teamExportRows, totals: teamExportTotals, direction, language, sheetName: t('payroll.weekly'), filename: `weekly-payroll-${monday}-${selectedTeam.name}` }
    if (kind === 'print') printPayrollReport(config)
    if (kind === 'excel') exportPayrollExcel({ ...config, filename: `${config.filename}.xlsx` })
    if (kind === 'pdf' && !exportPayrollPdf({ ...config, filename: `${config.filename}.pdf` }).supported) setError(t('payroll.pdfArabicUnsupported'))
  }
  const exportAllTeams = (kind) => {
    const config = { title: t('payroll.allTeamsSummary'), metadata: exportMetadata(), headers: allTeamsHeaders, rows: allTeamsRows, totals: allTeamsTotals, direction, language, sheetName: t('payroll.allTeamsSummary'), filename: `weekly-payroll-all-teams-${monday}` }
    if (kind === 'print') printPayrollReport(config)
    if (kind === 'excel') exportPayrollExcel({ ...config, filename: `${config.filename}.xlsx` })
    if (kind === 'pdf' && !exportPayrollPdf({ ...config, filename: `${config.filename}.pdf` }).supported) setError(t('payroll.pdfArabicUnsupported'))
  }
  const saveDraft = async () => { if (!data?.rules || (weeklyRun && weeklyRun.status !== 'draft')) return; setSaving(true); setError(''); setMessage(''); try { const saturday = weeklyDates(monday).at(-1); await persistPayrollDraftRequest({ paymentType: 'weekly', periodStart: monday, periodEnd: saturday, dueDate: saturday, currency: 'CDF', ruleSetId: data.rules.id, lines: weeklyLinesFor(data, monday).filter((line) => line.term?.daily_rate != null) }); await load(); setMessage(t('payroll.draftSaved')) } catch (e) { setError(getErrorMessage(e)) } finally { setSaving(false) } }
  const validateDraftForReview = () => {
    const errors = []
    if (!draftRun || draftRun.payment_type !== 'weekly') errors.push(t('payroll.reviewValidationRun'))
    if (draftRun?.weekly_period_start !== monday || draftRun?.weekly_period_end !== saturday || new Date(`${monday}T12:00:00`).getDay() !== 1 || draftRun?.scheduled_payment_date !== saturday) errors.push(t('payroll.reviewValidationPeriod'))
    if (!storedLines.length) errors.push(t('payroll.reviewValidationLines'))
    if (calculatedLines.some((line) => line.term?.daily_rate == null || Number(line.term.daily_rate) < 0)) errors.push(t('payroll.reviewValidationCompensation'))
    if (storedLines.length !== calculatedLines.length || storedLines.some((line) => !Number.isFinite(line.finalAmount) || line.unresolvedDays > 0)) errors.push(t('payroll.reviewValidationAmounts'))
    const activeAdjustmentLineIds = new Set((data?.payrollAdjustments || []).filter((adjustment) => !adjustment.voided_at).map((adjustment) => String(adjustment.payroll_line_id)))
    if (storedLines.some((line) => activeAdjustmentLineIds.has(String(payrollLineByWorkerId.get(String(line.worker.id))?.id)) && !line.calculationSnapshotHasAdjustments)) errors.push(t('payroll.reviewValidationAdjustments'))
    const storedTotal = numeric(storedLines.reduce((sum, line) => sum + Number(line.finalAmount || 0), 0))
    if (storedTotal !== numeric(totals.finalAmount)) errors.push(t('payroll.reviewValidationTotals'))
    return errors
  }
  const changeRunStatus = async (nextStatus) => {
    if (!weeklyRun) return
    if (nextStatus === 'reviewed') {
      const errors = validateDraftForReview()
      setReviewErrors(errors)
      if (errors.length) return
    }
    if (nextStatus === 'finalized' && !window.confirm(t('payroll.finalizedConfirmation'))) return
    if (nextStatus === 'paid' && !window.confirm(t('payroll.paidConfirmation', { period: `${monday} → ${saturday}`, dueDate: saturday, total: money(totals.finalAmount, 'CDF') }))) return
    setRunActionSaving(true); setError(''); setMessage('')
    try {
      await setWeeklyPayrollRunStatusRequest({ runId: weeklyRun.id, nextStatus })
      await load()
      setReviewErrors([])
      setMessage(nextStatus === 'reviewed' ? t('payroll.statusReviewed') : nextStatus === 'finalized' ? t('payroll.statusFinalized') : t('payroll.statusDraft'))
    } catch (e) { setError(getErrorMessage(e)) } finally { setRunActionSaving(false) }
  }
  const refreshExistingDraft = async () => {
    const refreshed = await load()
    const refreshedSaturday = weeklyDates(monday).at(-1)
    const existingDraft = refreshed?.runs?.find((run) => run.payment_type === 'weekly'
      && run.status === 'draft'
      && run.weekly_period_start === monday
      && run.weekly_period_end === refreshedSaturday
      && run.scheduled_payment_date === refreshedSaturday)
    if (!existingDraft || !refreshed?.rules) return refreshed
    await persistPayrollDraftRequest({
      paymentType: 'weekly',
      periodStart: monday,
      periodEnd: refreshedSaturday,
      dueDate: refreshedSaturday,
      currency: 'CDF',
      ruleSetId: refreshed.rules.id,
      lines: weeklyLinesFor(refreshed, monday).filter((line) => line.term?.daily_rate != null),
    })
    return load()
  }
  const saveAttendanceCorrection = async (values) => {
    if (!editingAttendance) return
    setSavingAttendance(true)
    setError('')
    try {
      await updateAttendanceManuallyRequest(editingAttendance, values)
      setEditingAttendance(null)
      const refreshed = await refreshExistingDraft()
      if (refreshed?.runs?.some((run) => run.id === draftRun?.id)) {
        setMessage(t('payroll.draftRefreshedAfterAttendance'))
      }
    } catch (e) { setError(getErrorMessage(e)) } finally { setSavingAttendance(false) }
  }
  const saveSheetEdit = async (line, values) => {
    const term = line.term || {}
    const compensation = values.compensation || {}
    const selectedPaymentType = compensation.paymentType || line.worker.payment_type || 'weekly'
    const compensationChanged = selectedPaymentType !== line.worker.payment_type
      || String(compensation.currencyCode ?? '') !== String(term.currency_code ?? line.currency ?? '')
      || String(compensation.dailyRate ?? '') !== String(term.daily_rate ?? '')
      || String(compensation.monthlySalary ?? '') !== String(term.monthly_salary ?? line.worker.monthly_salary ?? '')
      || String(compensation.monthlyCycleStart ?? '') !== String(term.monthly_payroll_cycle_start_date ?? '')
      || String(compensation.dailyTransportAllowance ?? '') !== String(term.daily_transport_allowance ?? 0)
      || String(compensation.overtimeRate ?? '') !== String(term.overtime_rate_per_hour ?? '')
      || String(compensation.overtimeStartTime ?? '') !== String(term.overtime_start_time ?? '')
    const sundayWasWorked = Boolean(line.sundayPayment && line.sundayPayment.payment_status !== 'cancelled')
    const sundayChanged = Boolean(values.sundayWorked) !== sundayWasWorked
    const targetOvertimeHours = Number(values.overtimeHours)
    const targetTransportAmount = Number(values.transportAmount)
    const adjustmentAmount = Number(values.adjustmentAmount || 0)
    if (!Number.isFinite(targetOvertimeHours) || targetOvertimeHours < 0 || !Number.isFinite(targetTransportAmount) || !Number.isFinite(adjustmentAmount)) {
      setError(t('payroll.adjustmentRequired'))
      return
    }
    const changedDetails = line.details.filter((detail) => values.statuses[detail.date] !== detail.status)
    const overtimeDifference = numeric((targetOvertimeHours - Number(line.overtimeHours || 0)) * Number(line.overtimeRate || 0))
    const transportDifference = numeric(targetTransportAmount - Number(line.transportAmount || 0))
    const changes = [
      ['overtime_correction', overtimeDifference],
      ['transport_correction', transportDifference],
      [values.adjustmentType, adjustmentAmount],
    ].filter(([, amount]) => amount !== 0)
    if (!changedDetails.length && !changes.length && !compensationChanged && !sundayChanged) { setEditingWorkerId(''); return }
    if (changes.length && (!draftRun || !payrollLineByWorkerId.get(String(line.worker.id)))) { setError(t('payroll.adjustmentDraftRequired')); return }
    if (changes.length && !String(values.reason || '').trim()) { setError(t('payroll.adjustmentRequired')); return }
    setSavingSheetWorkerId(String(line.worker.id))
    setError('')
    try {
      if (compensationChanged) {
        await saveWorkerPayrollSettingsRequest(line.worker, {
          payment_type: selectedPaymentType,
          currency_code: compensation.currencyCode,
          daily_rate: compensation.dailyRate,
          monthly_salary: compensation.monthlySalary,
          monthly_payroll_cycle_start_date: compensation.monthlyCycleStart,
          daily_transport_allowance: compensation.dailyTransportAllowance,
          overtime_rate_per_hour: compensation.overtimeRate,
          overtime_start_time: compensation.overtimeStartTime,
          effective_from: compensation.effectiveFrom,
        })
      }
      if (sundayChanged) {
        if (values.sundayWorked) await confirmSundayWorkRequest({
          workerId: line.worker.id,
          workDate: line.sundayDate,
          compensationTermId: compensationChanged ? null : line.term?.id,
        })
        else await cancelSundayWorkRequest(line.sundayPayment.id)
      }
      await Promise.all(changedDetails.map((detail) => saveAttendanceManuallyRequest({
        row: detail.row || null,
        workerId: line.worker.id,
        attendanceDate: detail.date,
        values: { status: values.statuses[detail.date], check_in: values.checkIns?.[detail.date] || detail.row?.check_in || '', check_out: detail.row?.check_out || '' },
      })))
      if (changes.length) {
        const payrollLine = payrollLineByWorkerId.get(String(line.worker.id))
        await Promise.all(changes.map(([adjustmentType, amount]) => createPayrollAdjustmentRequest({ payrollLineId: payrollLine.id, adjustmentType, amount: ['bonus', 'deduction', 'advance'].includes(adjustmentType) ? Math.abs(amount) : amount, reason: String(values.reason).trim() })))
      }
      await refreshExistingDraft()
      setMessage(
        changes.length
          ? t('payroll.adjustmentSaved')
          : compensationChanged
            ? t('payroll.configured')
            : sundayChanged
              ? (values.sundayWorked ? t('payroll.sundayConfirmed') : t('payroll.sundayCancelled'))
              : t('attendance.correctionSaved'),
      )
      setEditingWorkerId('')
    } catch (e) {
      const message = String(e?.message || '')
      setError(/financially processed/i.test(message)
        ? t('payroll.sundayProcessedCannotReverse')
        : /weekly daily rate|Payroll compensation is not configured/i.test(message)
          ? t('payroll.sundayWeeklyRateRequired')
          : getErrorMessage(e))
    } finally { setSavingSheetWorkerId('') }
  }
  const markSundayPaid = async (payment) => {
    if (!payment?.id || payment.payment_status !== 'unpaid' || payment.settled_payroll_run_id) return
    if (!window.confirm(t('payroll.sundayPaidConfirmation'))) return
    setSavingSheetWorkerId(String(payment.worker_id))
    setError('')
    try {
      await markSundayPaymentPaidRequest(payment.id)
      await load()
      setMessage(t('payroll.sundayMarkedPaid'))
    } catch (e) { setError(getErrorMessage(e)) } finally { setSavingSheetWorkerId('') }
  }
  const correctPaidSunday = async (payment) => {
    if (!payment?.id || payment.payment_status !== 'paid') return
    if (!window.confirm(t('payroll.sundayCorrectionConfirmation'))) return
    const reason = window.prompt(t('payroll.sundayCorrectionReasonPrompt'), '')
    if (!String(reason || '').trim()) { setError(t('payroll.sundayCorrectionReasonRequired')); return }
    setSavingSheetWorkerId(String(payment.worker_id))
    setError('')
    try {
      await reversePaidSundayPaymentRequest({ sundayPaymentId: payment.id, reason })
      await load()
      setMessage(t('payroll.sundayCorrected'))
    } catch (e) { setError(getErrorMessage(e)) } finally { setSavingSheetWorkerId('') }
  }
  const teamColumns = [{ key: 'name', header: t('common.team'), render: (group) => group.name }, { key: 'workers', header: t('payroll.workers'), render: (group) => group.totals.workers }, { key: 'days', header: `${t('payroll.presentDays')} / ${t('payroll.halfDays')} / ${t('payroll.absentDays')}`, render: (group) => `${group.totals.presentDays} / ${group.totals.halfDays} / ${group.totals.absentDays}` }, { key: 'total', header: t('payroll.teamTotal'), render: (group) => money(group.totals.finalAmount, 'CDF') }, { key: 'open', header: '', render: (group) => <button className="btn-secondary" onClick={() => setSelectedTeamId(group.id)}>{t('payroll.open')}</button> }]
  const exportButtons = (onExport) => <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary px-3 py-2" onClick={() => onExport('print')}>{t('reports.print')}</button><button type="button" className="btn-secondary px-3 py-2" onClick={() => onExport('pdf')}>{t('reports.pdf')}</button><button type="button" className="btn-secondary px-3 py-2" onClick={() => onExport('excel')}>{t('reports.excel')}</button></div>
  return <section>
    {error ? <p className="mb-3 rounded bg-red-50 p-3 text-red-700">{error}</p> : null}
    {message ? <p className="mb-3 rounded bg-emerald-50 p-3 text-emerald-700">{message}</p> : null}
    <div className="surface-card mb-3 grid gap-3 p-4 md:grid-cols-2">
      <label>{t('payroll.monday')}<input type="date" className="input-base mt-1" value={monday} onChange={(event) => { setMonday(mondayFor(`${event.target.value}T12:00:00`)); setSelectedTeamId(''); setEditingWorkerId(''); setReviewErrors([]) }} /></label>
      <div className="flex flex-wrap items-end gap-2">
        <span className={`status-badge ${weeklyRun?.status === 'finalized' ? 'status-badge--success' : weeklyRun?.status === 'reviewed' ? 'status-badge--warning' : 'status-badge--neutral'}`}>{runStatusLabel}</span>
        {!weeklyRun || weeklyRun.status === 'draft' ? <><button className="btn-primary" disabled={saving || loading || runActionSaving} onClick={saveDraft}>{saving ? t('payroll.saving') : t('payroll.saveWeeklyDraft')}</button>{draftRun ? <button className="btn-secondary" disabled={saving || runActionSaving} onClick={() => changeRunStatus('reviewed')}>{t('payroll.submitForReview')}</button> : null}</> : null}
        {weeklyRun?.status === 'reviewed' ? <><button className="btn-secondary" disabled={runActionSaving} onClick={() => changeRunStatus('draft')}>{t('payroll.returnToDraft')}</button><button className="btn-primary" disabled={runActionSaving} onClick={() => changeRunStatus('finalized')}>{t('payroll.finalize')}</button></> : null}
        {weeklyRun?.status === 'finalized' ? <button className="btn-primary" disabled={runActionSaving} onClick={() => changeRunStatus('paid')}>{t('payroll.markPaid')}</button> : null}
        <button className="btn-secondary" disabled={loading || runActionSaving} onClick={load}>{t('payroll.refresh')}</button>
      </div>
    </div>
    {reviewErrors.length ? <div className="mb-3 rounded bg-amber-50 p-3 text-amber-900"><p className="font-bold">{t('payroll.reviewValidationFailed')}</p><ul className="mt-2 list-inside list-disc text-sm">{reviewErrors.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {selectedTeam ? <><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><button className="btn-secondary" onClick={() => { setSelectedTeamId(''); setEditingWorkerId('') }}>{t('payroll.back')}</button>{exportButtons(exportTeam)}</div><WeeklyPayrollSheet lines={selectedTeam.lines} dates={weeklyDates(monday)} onEdit={setEditingWorkerId} editable={!weeklyRun || weeklyRun.status === 'draft'} /><div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><p><strong>{t('payroll.presentDays')}:</strong> {selectedTeam.totals.presentDays + (selectedTeam.totals.halfDays * 0.5)}</p><p><strong>{t('payroll.candidateOvertimeHours')}:</strong> {selectedTeam.totals.overtimeHours}</p><p><strong>{t('payroll.transport')}:</strong> {money(selectedTeam.totals.transportAmount, 'CDF')}</p><p className="font-extrabold"><strong>{t('payroll.teamTotal')}:</strong> {money(selectedTeam.totals.finalAmount, 'CDF')}</p></div></> : <><div className="mb-3 flex justify-end">{exportButtons(exportAllTeams)}</div><Table columns={teamColumns} data={teamGroups} loading={loading} emptyMessage={t('payroll.noTeams')} /></>}
    <p className="mt-3 font-extrabold">{t('payroll.allTeamsTotal')}: {money(totals.finalAmount, 'CDF')}</p>
    <WeeklyPayrollWorkerEditPanel line={editingLine} dates={weeklyDates(monday)} hasDraft={Boolean(draftRun)} saving={Boolean(savingSheetWorkerId)} onClose={() => setEditingWorkerId('')} onSave={saveSheetEdit} onMarkSundayPaid={markSundayPaid} onCorrectPaidSunday={correctPaidSunday} />
    <AttendanceEditModal row={editingAttendance} isOpen={Boolean(editingAttendance)} isSaving={savingAttendance} onClose={() => setEditingAttendance(null)} onSave={saveAttendanceCorrection} />
  </section>
}
