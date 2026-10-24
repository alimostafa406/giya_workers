import { applyPayrollAdjustments, calculatePayrollLine, weeklyDates } from './payrollCalculations.js'
import { isWeeklyPayrollEligibleWorker } from './weeklyPayrollEligibility.js'
import { calculateWeeklyOvertimePay, isChauffeurNormalOvertimeExcluded } from './weeklyPayrollOvertime.js'

const round = (n) => Math.round(n * 100) / 100
export const manualReportMinutes = (row) => row?.manual_override === true
  && row.emergency_overtime_mode === 'manual_overtime_duration'
  && Number.isInteger(Number(row.emergency_overtime_minutes)) && Number(row.emergency_overtime_minutes) >= 0
  ? Number(row.emergency_overtime_minutes) : 0

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
  // Old snapshots do not retain manual-entry provenance. Never silently
  // substitute today's attendance or call biometric overtime "manual".
  if (locked && stored.some((s) => s.attendance_summary_snapshot?.manual_overtime_source_version !== 1
    && (Number(s.overtime_hours) !== 0 || Number(s.overtime_amount) !== 0))) {
    return { unavailable: 'هذا الأسبوع محفوظ وغير قابل للتغيير؛ اللقطة القديمة لا تتضمن تفصيل مصدر الإضافي اليدوي. لا يمكن إعادة احتسابها من البيانات الحالية.', groups: [], lines: [], run }
  }
  const attendance = new Map((data.attendance || []).map((r) => [`${r.worker_id}|${r.attendance_date}`, r]))
  const holidays = new Set((data.holidays || []).map((h) => h.holiday_date))
  const lines = locked ? stored.map((s) => {
    const minutes = (s.attendance_summary_snapshot?.days || []).filter((d) => dates.includes(d.date)).reduce((sum, day) => sum + manualReportMinutes(day), 0)
    const overtime = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: s.compensation_snapshot?.overtime_rate_per_hour })
    const basePay = round(Number(s.final_amount) - Number(s.overtime_amount || 0))
    const overtimeAmount = overtime.missingRateBlocker ? null : overtime.overtimePay ?? 0
    return {
      worker: { ...(data.workers || []).find((w) => String(w.id) === String(s.worker_id)), id: s.worker_id, full_name: s.worker_name_snapshot },
      currency: s.currency_code_snapshot, workDays: Number(s.present_days) + Number(s.half_days) * Number(s.rule_snapshot?.half_day_multiplier ?? .5),
      absentDays: Number(s.absent_days), minutes, overtimeAmount, basePay,
      finalAmount: overtimeAmount == null ? null : round(basePay + overtimeAmount), unresolved: overtime.missingRateBlocker,
    }
  }) : (data.workers || []).filter((worker) => isWeeklyPayrollEligibleWorker(worker, end)).map((worker) => {
    const datesForWorker = dates.filter((date) => !worker.operational_start_date || date >= worker.operational_start_date)
    const line = calculatePayrollLine({ worker, term: worker.payroll_compensation, attendanceByDate: attendance,
      dates: datesForWorker, rules: data.rules, holidayDates: holidays, paymentType: 'weekly', futureDatesAreNeutral: true })
    const saved = stored.find((s) => String(s.worker_id) === String(worker.id))
    // Non-OT canonical adjustments still form part of base payable. OT
    // corrections outside the manual-entry path are not payable in this report.
    const adjusted = applyPayrollAdjustments(line, (data.payrollAdjustments || []).filter((a) => a.payroll_line_id === saved?.id && a.adjustment_type !== 'overtime_correction'))
    const minutes = isChauffeurNormalOvertimeExcluded(worker) ? 0 : line.details.reduce((sum, detail) => sum + manualReportMinutes(detail.row), 0)
    const overtime = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: line.term?.overtime_rate_per_hour })
    const configured = line.term?.daily_rate != null && line.term.daily_rate !== '' && line.term?.daily_transport_allowance != null && line.currency
    const basePay = configured ? round(adjusted.finalAmount - adjusted.overtimeAmount) : null
    const overtimeAmount = overtime.missingRateBlocker ? null : overtime.overtimePay ?? 0
    return { worker, currency: line.currency, workDays: line.presentDays + line.halfDays * Number(data.rules?.half_day_multiplier ?? .5),
      absentDays: line.absentDays, minutes, basePay, overtimeAmount,
      finalAmount: basePay == null || overtimeAmount == null ? null : round(basePay + overtimeAmount),
      unresolved: !configured || overtime.missingRateBlocker || line.unresolvedDays > 0 }
  })
  const groups = [...new Set(lines.map((l) => String(l.worker.team_id || 'unassigned')))].map((id) => {
    const teamLines = lines.filter((l) => String(l.worker.team_id || 'unassigned') === id)
    return { id, name: teamLines[0].worker.team_name || teamLines[0].worker.team?.name || 'بدون فريق', lines: teamLines, totals: reportTotals(teamLines) }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return { lines, groups, totals: reportTotals(lines), run, locked }
}

export const teamReportPrintCss = `@page{size:A4 landscape;margin:10mm}body{font:12px Arial,Tahoma,sans-serif;color:#172033}h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:7px;text-align:start}th{background:#f1f5f9}thead{display:table-header-group}tr{break-inside:avoid}bdi{white-space:nowrap}.team-report-totals{display:flex;flex-wrap:wrap;gap:20px;margin-top:16px}.team-report-totals div{padding:8px;border:1px solid #cbd5e1}.team-report-totals strong{display:block}h1,h2{break-after:avoid}`
export function printTeamReport(element) {
  if (!element) return false
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير أجور الفرق الأسبوعي</title><style>${teamReportPrintCss}</style></head><body>${element.innerHTML}</body></html>`)
  popup.document.close()
  Promise.resolve(popup.document.fonts?.ready).then(() => { popup.focus(); popup.print() })
  return true
}
