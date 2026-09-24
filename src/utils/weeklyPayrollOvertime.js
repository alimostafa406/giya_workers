const KINSHASA_TIME_ZONE = 'Africa/Kinshasa'

const overtimeTeamName = (value = {}) => {
  const row = value?.row || {}
  const worker = value?.worker || row?.worker || {}
  return [
    value?.team?.name,
    value?.team_name,
    worker?.team?.name,
    worker?.team_name,
    row?.team?.name,
    row?.team_name,
  ].find((name) => typeof name === 'string' && name.trim())?.trim() || ''
}

// Chauffeur attendance is deliberately handled by its own temporary
// attendance rule. It must never enter the normal-worker overtime model.
export const isChauffeurNormalOvertimeExcluded = (value = {}) => overtimeTeamName(value) === 'Chauffeur'

const clockMinutes = (value) => {
  if (!value) return null
  const text = String(value).trim()
  if (text.includes('T') || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const instant = new Date(text)
    if (Number.isNaN(instant.getTime())) return null
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: KINSHASA_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return (Number(values.hour) * 60) + Number(values.minute) + (Number(values.second) / 60)
  }
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/)
  if (!match) return null
  return (Number(match[1]) * 60) + Number(match[2]) + (Number(match[3] || 0) / 60)
}

const isWeekday = (date) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

const nextCalendarDate = (date) => {
  const value = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(value.getTime())) return null
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

const timestampDateAndMinutes = (value) => {
  if (!value) return null
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KINSHASA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const minutes = (Number(values.hour) * 60) + Number(values.minute) + (Number(values.second) / 60)
  if (!values.year || !values.month || !values.day || !Number.isFinite(minutes)) return null
  return { date: `${values.year}-${values.month}-${values.day}`, minutes }
}

const checkoutEvidenceTimestamp = (detail) => {
  const row = detail?.row || {}
  const metadata = typeof row.biometric_sync_metadata === 'string'
    ? (() => { try { return JSON.parse(row.biometric_sync_metadata) } catch { return null } })()
    : row.biometric_sync_metadata
  return metadata?.check_out_event_timestamp || row.review_approved_check_out_at || null
}

const normalizedCheckoutMinutes = (detail) => {
  const checkOut = clockMinutes(detail?.row?.check_out ?? detail?.check_out)
  if (checkOut == null) return null

  // A plain 00:xx clock is ambiguous.  Add a day only when the attendance row
  // carries timestamp evidence proving that this checkout belongs to the next
  // calendar day of the selected workday, and stays within the accepted 02:00
  // workday tail.
  const evidence = timestampDateAndMinutes(checkoutEvidenceTimestamp(detail))
  const isVerifiedNextDayCheckout = evidence
    && evidence.date === nextCalendarDate(detail?.date)
    && evidence.minutes <= 120
    && Math.abs(evidence.minutes - checkOut) < (1 / 60)
  return isVerifiedNextDayCheckout ? checkOut + (24 * 60) : checkOut
}

export const weeklyPayrollDisplayStatus = (detail) => {
  if (!detail || ['future', 'pending', 'in_progress', 'not_recorded'].includes(detail.status)) return 'neutral'
  if (detail.status === 'present') return 'present'
  if (detail.status === 'half_day') return 'half_day'
  if (detail.status === 'late') return (detail.row?.check_out ?? detail.check_out) ? 'present' : 'half_day'
  return 'absent'
}

export const weeklyPayrollOvertimeForDetail = (detail) => {
  if (!detail?.date || !isWeekday(detail.date) || isChauffeurNormalOvertimeExcluded(detail)) {
    return { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 }
  }
  const checkOut = normalizedCheckoutMinutes(detail)
  const workedAfterEndMinutes = checkOut == null ? 0 : Math.max(Math.floor(checkOut - 1020), 0)
  return {
    morningOvertimeMinutes: 0,
    eveningOvertimeMinutes: workedAfterEndMinutes < 60 ? 0 : 60 + (Math.floor((workedAfterEndMinutes - 60) / 30) * 30),
  }
}

export const weeklyPayrollOvertimeForLine = (line) => (
  isChauffeurNormalOvertimeExcluded(line)
    ? { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 }
    : (line?.details || []).reduce((totals, detail) => {
    const overtime = weeklyPayrollOvertimeForDetail(detail)
    return {
      morningOvertimeMinutes: totals.morningOvertimeMinutes + overtime.morningOvertimeMinutes,
      eveningOvertimeMinutes: totals.eveningOvertimeMinutes + overtime.eveningOvertimeMinutes,
    }
  }, { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 })
)

export const formatOvertimeMinutes = (minutes) => {
  const safeMinutes = Math.max(Math.round(Number(minutes) || 0), 0)
  return safeMinutes === 0 ? '—' : `${Math.floor(safeMinutes / 60)}h${String(safeMinutes % 60).padStart(2, '0')}`
}

export const formatEveningOvertimeMinutes = formatOvertimeMinutes

export const calculateWeeklyOvertimePay = ({ morningOvertimeMinutes = 0, eveningOvertimeMinutes = 0, overtimeHourlyRate = null } = {}) => {
  // Keep the field available, but do not calculate or pay morning overtime
  // until worker-specific schedules are approved.
  const morningMinutes = 0
  const eveningMinutes = Math.max(Number(eveningOvertimeMinutes) || 0, 0)
  const overtimeMinutes = morningMinutes + eveningMinutes
  const hasRate = overtimeHourlyRate !== '' && overtimeHourlyRate != null && Number.isFinite(Number(overtimeHourlyRate)) && Number(overtimeHourlyRate) >= 0
  return { morningOvertimeMinutes: morningMinutes, eveningOvertimeMinutes: eveningMinutes, overtimeMinutes, overtimeHours: overtimeMinutes / 60, overtimePay: hasRate ? Math.round(((overtimeMinutes / 60) * Number(overtimeHourlyRate)) * 100) / 100 : null, missingRateBlocker: overtimeMinutes > 0 && !hasRate }
}

export const applyWeeklyOvertimePay = (line) => {
  const overtime = calculateWeeklyOvertimePay({ ...weeklyPayrollOvertimeForLine(line), overtimeHourlyRate: line?.term?.overtime_rate_per_hour })
  const payable = overtime.overtimePay ?? 0
  return { ...line, ...overtime, overtimeRate: line?.term?.overtime_rate_per_hour ?? null, overtimeAmount: payable, finalAmount: Math.round(((Number(line?.finalAmount) || 0) - (Number(line?.overtimeAmount) || 0) + payable) * 100) / 100 }
}
