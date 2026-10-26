import { applyPayrollAdjustments, weeklyDates } from './payrollCalculations.js'
import { isNormalPayrollWorkerOnDate, isWeeklyPayrollEligibleWorker } from './weeklyPayrollEligibility.js'
import { calculateWeeklyOvertimePay } from './weeklyPayrollOvertime.js'
import { manualReportMinutes } from './weeklyManualOvertime.js'
import { calculateWeeklyPayoutLine } from './weeklyPayoutLines.js'
export { manualReportMinutes } from './weeklyManualOvertime.js'

const round = (n) => Math.round(n * 100) / 100

export const reportTotals = (lines) => lines.reduce((total, line) => {
  total.workers += 1; total.workDays += line.workDays; total.absentDays += line.absentDays; total.minutes += line.minutes
  const key = line.currency || 'UNCONFIGURED'
  const amounts = total.currencies[key] ||= { basePay: 0, overtimeAmount: 0, finalAmount: 0 }
  for (const field of Object.keys(amounts)) amounts[field] = amounts[field] == null || line[field] == null ? null : round(amounts[field] + line[field])
  return total
}, { workers: 0, workDays: 0, absentDays: 0, minutes: 0, currencies: {} })

// Read-only projection. Attendance/wage classification remains in the existing
// payroll engine; only this report's overtime source is replaced, never stored.
export function teamWeeklyReport(data, monday) {
  const dates = weeklyDates(monday), end = dates.at(-1)
  const run = data.runs?.find((r) => r.payment_type === 'weekly' && r.weekly_period_start === monday && r.weekly_period_end === end)
  const stored = (data.payrollLines || []).filter((line) => line.payroll_run_id === run?.id)
  const locked = run && run.status !== 'draft'
  const frozenPopulation = stored.some((line) => line.attendance_summary_snapshot?.weekly_payout_source_version === 3)
  // Old snapshots do not retain manual-entry provenance. Never silently
  // substitute today's attendance or call biometric overtime "manual".
  if (locked && stored.some((s) => s.attendance_summary_snapshot?.manual_overtime_source_version !== 1
    && (Number(s.overtime_hours) !== 0 || Number(s.overtime_amount) !== 0))) {
    return { unavailable: 'هذا الأسبوع محفوظ وغير قابل للتغيير؛ اللقطة القديمة لا تتضمن تفصيل مصدر الإضافي اليدوي. لا يمكن إعادة احتسابها من البيانات الحالية.', groups: [], lines: [], run }
  }
  const lines = locked ? stored.map((s) => {
    const minutes = s.attendance_summary_snapshot?.payable_overtime_source_version === 2
      ? Number(s.calculation_snapshot?.evening_overtime_minutes ?? Number(s.overtime_hours) * 60)
      : s.attendance_summary_snapshot?.weekly_manual_overtime_override_minutes ?? (s.attendance_summary_snapshot?.days || []).filter((d) => dates.includes(d.date)).reduce((sum, day) => sum + manualReportMinutes(day), 0)
    const overtime = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: s.compensation_snapshot?.overtime_rate_per_hour })
    const monthlyOvertimeOnly = s.payment_type_snapshot === 'monthly'
    const basePay = monthlyOvertimeOnly ? 0 : round(Number(s.final_amount) - Number(s.overtime_amount || 0))
    const overtimeAmount = overtime.missingRateBlocker ? null : s.attendance_summary_snapshot?.payable_overtime_source_version === 2 ? Number(s.overtime_amount || 0) : overtime.overtimePay ?? 0
    return {
      worker: { ...(data.workers || []).find((w) => String(w.id) === String(s.worker_id)), ...s.attendance_summary_snapshot?.worker_identity_snapshot, id: s.worker_id, full_name: s.worker_name_snapshot, payment_type: s.payment_type_snapshot },
      currency: s.currency_code_snapshot, workDays: Number(s.present_days) + Number(s.half_days) * Number(s.rule_snapshot?.half_day_multiplier ?? .5),
      absentDays: Number(s.absent_days), minutes, overtimeAmount, basePay, monthlyOvertimeOnly,
      details: s.attendance_summary_snapshot?.days || [],
      finalAmount: overtimeAmount == null ? null : round(basePay + overtimeAmount), unresolved: overtime.missingRateBlocker,
    }
  }).filter((line) => !line.monthlyOvertimeOnly || line.minutes > 0) : (data.workers || []).filter((worker) => isWeeklyPayrollEligibleWorker(worker, end)).map((worker) => {
    const line = calculateWeeklyPayoutLine(data, monday, worker)
    const saved = stored.find((s) => String(s.worker_id) === String(worker.id))
    // Non-OT canonical adjustments still form part of base payable. OT
    // corrections outside the manual-entry path are not payable in this report.
    const adjusted = applyPayrollAdjustments(line, (data.payrollAdjustments || []).filter((a) => a.payroll_line_id === saved?.id && a.adjustment_type !== 'overtime_correction'))
    const minutes = line.eveningOvertimeMinutes
    const overtime = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: line.term?.overtime_rate_per_hour })
    const configured = line.term?.daily_rate != null && line.term.daily_rate !== '' && line.term?.daily_transport_allowance != null && line.currency
    const basePay = configured ? round(adjusted.finalAmount - adjusted.overtimeAmount) : null
    const overtimeAmount = overtime.missingRateBlocker ? null : overtime.overtimePay ?? 0
    return { worker, currency: line.currency, workDays: line.presentDays + line.halfDays * Number(data.rules?.half_day_multiplier ?? .5),
      absentDays: line.absentDays, minutes, basePay, overtimeAmount, details: line.details,
      finalAmount: basePay == null || overtimeAmount == null ? null : round(basePay + overtimeAmount),
      unresolved: !configured || overtime.missingRateBlocker || line.unresolvedDays > 0 }
  })
  // Monthly salary/cycle/deductions are deliberately never evaluated here.
  // Reuse the attendance classifier with zero wage/transport inputs solely for
  // operational day counts; only the canonical manual OT rate can pay money.
  const included = new Set(lines.map((line) => String(line.worker.id)))
  const monthlyLines = (locked && frozenPopulation ? [] : data.workers || []).filter((worker) => worker.payment_type === 'monthly'
    && isNormalPayrollWorkerOnDate(worker, end) && !included.has(String(worker.id))).map((worker) => {
    const effective = calculateWeeklyPayoutLine({ ...data, outsideWorkMovements: locked ? [] : data.outsideWorkMovements }, monday, worker)
    const term = effective.term, attendanceLine = effective
    const overtimeAmount = effective.missingRateBlocker || !term.currency_code ? null : effective.overtimeAmount
    return { worker, currency: term.currency_code, monthlyOvertimeOnly: true,
      workDays: attendanceLine.presentDays + attendanceLine.halfDays * Number(data.rules?.half_day_multiplier ?? .5),
      absentDays: attendanceLine.absentDays, minutes: effective.eveningOvertimeMinutes, details: attendanceLine.details,
      basePay: 0, overtimeAmount, finalAmount: overtimeAmount, unresolved: effective.missingRateBlocker || !term.currency_code }
  }).filter((line) => line.minutes > 0)
  lines.push(...monthlyLines)
  const groups = [...new Set(lines.map((l) => String(l.worker.team_id || 'unassigned')))].map((id) => {
    const teamLines = lines.filter((l) => String(l.worker.team_id || 'unassigned') === id)
    return { id, name: teamLines[0].worker.team_name || teamLines[0].worker.team?.name || 'بدون فريق', lines: teamLines, totals: reportTotals(teamLines) }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return { lines, groups, totals: reportTotals(lines), run, locked, hasLiveMonthlyOvertime: locked && monthlyLines.length > 0 }
}

export const teamReportPrintCss = `@page{size:A4 landscape;margin:10mm}body{font:12px Arial,Tahoma,sans-serif;color:#172033}h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:7px;text-align:start}td:not(:first-child),thead th:not(:first-child){text-align:center}th{background:#f1f5f9}thead{display:table-header-group}tfoot{display:table-row-group;break-inside:avoid;page-break-inside:avoid}tfoot th,tfoot td{font-weight:800;background:#e2e8f0;border-top:2px solid #64748b}tfoot bdi{display:block}tr{break-inside:avoid;page-break-inside:avoid}bdi{white-space:nowrap}h1,h2{break-after:avoid}.team-report-header{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}.team-report-team+.team-report-team,.team-report-summary{break-before:page;page-break-before:always}tbody tr:last-child{break-after:avoid;page-break-after:avoid}`
export function printTeamReport(element, { language = document.documentElement.lang || 'ar', title = element?.querySelector?.('h1')?.textContent || '' } = {}) {
  if (!element) return false
  const popup = window.open('', '_blank')
  if (!popup) return false
  const locale = ['ar', 'fr', 'en'].includes(language) ? language : 'en'
  const escapedTitle = String(title).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
  popup.document.write(`<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${escapedTitle}</title><style>${teamReportPrintCss}.team-report-team table{font-size:10px}.team-report-team th,.team-report-team td{padding:5px 3px}.team-report-day{white-space:nowrap}</style></head><body>${element.innerHTML}</body></html>`)
  popup.document.close()
  Promise.resolve(popup.document.fonts?.ready).then(() => { popup.focus(); popup.print() })
  return true
}
