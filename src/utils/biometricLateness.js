export const lateDeductionLabel = (language) => ({ ar: 'خصم التأخير', fr: 'Retenue de retard', en: 'Late deduction' })[language] || 'Late deduction'
export const latenessStatus = (source) => source.review
  ? source.review.source_fingerprint === source.evidence?.source_fingerprint ? source.review.decision : 'stale'
  : 'pending'

// Reviews contain a server-calculated, evidence-checked source projection. Match
// the very same raw check-in loaded for payroll; never mutate either input.
export function applyWeeklyLateDeductions(line, sources = []) {
  const byDate = new Map()
  for (const source of sources) {
    if (String(source.worker.id) !== String(line.worker.id) || latenessStatus(source) !== 'approved' || !source.payroll_source) continue
    const detail = line.details.find((day) => day.date === source.attendance.attendance_date)
    if (!detail?.row || detail.row.attendance_source !== 'biometric'
      || (detail.row.manual_override && detail.row.emergency_overtime_mode !== 'manual_overtime_duration')
      || String(detail.row.id) !== String(source.attendance.id)
      || detail.row.check_in !== source.attendance.check_in || line.currency !== 'CDF') continue
    byDate.set(detail.date, source.payroll_source)
  }
  const latenessDeductions = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const lateDeduction = Math.round(latenessDeductions.reduce((sum, source) => sum + Number(source.deduction_amount), 0) * 100) / 100
  // Idempotent even when a refreshed projection is applied to a previous one.
  const before = Number(line.finalAmount) + Number(line.lateDeduction || 0)
  return { ...line, latenessDeductions, lateDeduction,
    deductionAmount: Math.round((Number(line.deductionAmount || 0) - Number(line.lateDeduction || 0) + lateDeduction) * 100) / 100,
    finalAmount: Math.round((before - lateDeduction) * 100) / 100 }
}
