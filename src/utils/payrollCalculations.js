const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const atNoon = (value) => new Date(`${value}T12:00:00`)
const money = (value) => Math.round((Number(value) || 0) * 100) / 100

export const mondayFor = (value = new Date()) => {
  const date = new Date(value)
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return iso(date)
}

export const weeklyDates = (monday) => Array.from({ length: 6 }, (_, index) => {
  const date = atNoon(monday)
  date.setDate(date.getDate() + index)
  return iso(date)
})

export const datesForRange = (start, end) => {
  if (!start || !end || start > end) return []
  const dates = []
  const current = atNoon(start)
  const last = atNoon(end)
  while (current <= last) {
    dates.push(iso(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

export const monthlyCycle = (anchor) => {
  if (!anchor) return null
  const anchorDay = Number(String(anchor).slice(-2))
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const anniversary = (year, month) => new Date(year, month, Math.min(anchorDay, new Date(year, month + 1, 0).getDate()), 12)
  let start = anniversary(today.getFullYear(), today.getMonth())
  if (today < start) start = anniversary(today.getFullYear(), today.getMonth() - 1)
  const due = anniversary(start.getFullYear(), start.getMonth() + 1)
  const end = new Date(due); end.setDate(end.getDate() - 1)
  return { start: iso(start), end: iso(end), due: iso(due), day: anchorDay }
}

const durationHours = (from, to) => {
  if (!from || !to) return 0
  const [fromHours, fromMinutes, fromSeconds = 0] = String(from).split(':').map(Number)
  const [toHours, toMinutes, toSeconds = 0] = String(to).split(':').map(Number)
  return Math.max(0, ((toHours * 3600 + toMinutes * 60 + toSeconds) - (fromHours * 3600 + fromMinutes * 60 + fromSeconds)) / 3600)
}

const roundOvertime = (hours, rules) => {
  const minutes = rules?.overtime_rounding_minutes
  const mode = rules?.overtime_rounding_mode
  if (!minutes || !mode) return money(hours)
  const units = hours * 60 / minutes
  const rounded = mode === 'up' ? Math.ceil(units) : mode === 'down' ? Math.floor(units) : Math.round(units)
  return money(rounded * minutes / 60)
}

export const calculatePayrollLine = ({ worker, term, attendanceByDate, dates, rules, holidayDates, paymentType }) => {
  const dailyRate = Number(term?.daily_rate || 0)
  const monthlySalary = Number(term?.monthly_salary ?? worker.monthly_salary ?? 0)
  const halfMultiplier = Number(rules?.half_day_multiplier ?? 0.5)
  const transportRate = Number(term?.daily_transport_allowance || 0)
  const overtimeRate = Number(term?.overtime_rate_per_hour || 0)
  const divisor = Number(rules?.monthly_working_day_divisor || 26)
  let presentDays = 0; let halfDays = 0; let absentDays = 0; let unresolvedDays = 0
  let transportDays = 0; let overtimeHours = 0; let holidayAmount = 0; let attendanceWage = 0
  const details = dates.map((date) => {
    const row = attendanceByDate.get(`${worker.id}|${date}`) || null
    const status = row?.status || (date > iso(new Date()) ? 'pending' : 'absent')
    const factor = status === 'present' ? 1 : status === 'half_day' ? halfMultiplier : 0
    const isHoliday = holidayDates.has(date)
    if (status === 'present') presentDays += 1
    else if (status === 'half_day') halfDays += 1
    else if (status === 'pending' || status === 'in_progress') unresolvedDays += 1
    else absentDays += 1
    const eligibleTransport = status === 'present' || (status === 'half_day' && rules?.transport_eligibility === 'present_and_half_day')
    if (eligibleTransport) transportDays += 1
    const baseEffect = paymentType === 'weekly' ? dailyRate * factor : 0
    const holidayEffect = paymentType === 'weekly' && isHoliday ? baseEffect * (Number(rules?.weekly_holiday_multiplier ?? 2) - 1) : 0
    attendanceWage += baseEffect; holidayAmount += holidayEffect
    const candidate = row?.check_out && term?.overtime_start_time ? roundOvertime(durationHours(term.overtime_start_time, row.check_out), rules) : 0
    overtimeHours += candidate
    return { date, row, status, isHoliday, baseEffect: money(baseEffect), holidayEffect: money(holidayEffect), candidateOvertimeHours: candidate, transportEffect: eligibleTransport ? transportRate : 0 }
  })
  const transportAmount = money(transportDays * transportRate)
  const overtimeAmount = money(overtimeHours * overtimeRate)
  const dailyValue = money(monthlySalary / divisor)
  const absenceDeduction = paymentType === 'monthly' ? money(absentDays * dailyValue) : 0
  const halfDayDeduction = paymentType === 'monthly' ? money(halfDays * dailyValue * (1 - halfMultiplier)) : 0
  const baseAmount = paymentType === 'monthly' ? money(monthlySalary - absenceDeduction - halfDayDeduction) : money(attendanceWage)
  const finalAmount = money(baseAmount + transportAmount + overtimeAmount + holidayAmount)
  return { worker, term, rules, paymentType, currency: term?.currency_code || (paymentType === 'monthly' ? 'USD' : 'CDF'), presentDays, halfDays, absentDays, unresolvedDays, transportDays, transportAmount, overtimeHours: money(overtimeHours), overtimeRate, overtimeAmount, holidayAmount: money(holidayAmount), attendanceWage: money(attendanceWage), monthlySalary, dailyValue, absenceDeduction, halfDayDeduction, baseAmount, finalAmount, details }
}

export const totalLines = (lines) => lines.reduce((total, line) => ({
  workers: total.workers + 1, presentDays: total.presentDays + line.presentDays, halfDays: total.halfDays + line.halfDays, absentDays: total.absentDays + line.absentDays, overtimeHours: money(total.overtimeHours + line.overtimeHours), baseAmount: money(total.baseAmount + line.baseAmount), transportAmount: money(total.transportAmount + line.transportAmount), overtimeAmount: money(total.overtimeAmount + line.overtimeAmount), holidayAmount: money(total.holidayAmount + line.holidayAmount), bonusAmount: money(total.bonusAmount + (line.bonusAmount || 0)), deductionAmount: money(total.deductionAmount + (line.deductionAmount || 0)), advanceAmount: money(total.advanceAmount + (line.advanceAmount || 0)), manualAdjustmentAmount: money(total.manualAdjustmentAmount + (line.manualAdjustmentAmount || 0)), finalAmount: money(total.finalAmount + line.finalAmount),
}), { workers: 0, presentDays: 0, halfDays: 0, absentDays: 0, overtimeHours: 0, baseAmount: 0, transportAmount: 0, overtimeAmount: 0, holidayAmount: 0, bonusAmount: 0, deductionAmount: 0, advanceAmount: 0, manualAdjustmentAmount: 0, finalAmount: 0 })

export const summarizePayrollAdjustments = (adjustments = []) => adjustments
  .filter((adjustment) => !adjustment?.voided_at)
  .reduce((summary, adjustment) => {
    const amount = Number(adjustment.amount || 0)
    switch (adjustment.adjustment_type) {
      case 'bonus': summary.bonusAmount += Math.abs(amount); break
      case 'deduction': summary.deductionAmount += Math.abs(amount); break
      case 'advance': summary.advanceAmount += Math.abs(amount); break
      case 'transport_correction': summary.transportCorrection += amount; break
      case 'overtime_correction': summary.overtimeCorrection += amount; break
      case 'holiday_correction': summary.holidayCorrection += amount; break
      case 'other': summary.otherAmount += amount; break
      default: break
    }
    return summary
  }, { bonusAmount: 0, deductionAmount: 0, advanceAmount: 0, transportCorrection: 0, overtimeCorrection: 0, holidayCorrection: 0, otherAmount: 0 })

export const applyPayrollAdjustments = (line, adjustments = []) => {
  const adjustmentSummary = summarizePayrollAdjustments(adjustments)
  const transportAmount = money(line.transportAmount + adjustmentSummary.transportCorrection)
  const overtimeAmount = money(line.overtimeAmount + adjustmentSummary.overtimeCorrection)
  const holidayAmount = money(line.holidayAmount + adjustmentSummary.holidayCorrection)
  const bonusAmount = money(adjustmentSummary.bonusAmount)
  const deductionAmount = money(adjustmentSummary.deductionAmount)
  const advanceAmount = money(adjustmentSummary.advanceAmount)
  const manualAdjustmentAmount = money(adjustmentSummary.otherAmount)
  const finalAmount = money(line.baseAmount + transportAmount + overtimeAmount + holidayAmount + bonusAmount - deductionAmount - advanceAmount + manualAdjustmentAmount)
  return {
    ...line,
    transportAmount,
    overtimeAmount,
    holidayAmount,
    bonusAmount,
    deductionAmount,
    advanceAmount,
    manualAdjustmentAmount,
    adjustmentSummary,
    finalAmount,
  }
}
