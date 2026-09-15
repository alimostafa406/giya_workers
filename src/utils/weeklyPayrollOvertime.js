const KINSHASA_TIME_ZONE = 'Africa/Kinshasa'

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

export const weeklyPayrollDisplayStatus = (detail) => {
  if (!detail || ['future', 'pending', 'in_progress', 'not_recorded'].includes(detail.status)) return 'neutral'
  if (detail.status === 'present') return 'present'
  if (detail.status === 'half_day') return 'half_day'
  if (detail.status === 'late') return (detail.row?.check_out ?? detail.check_out) ? 'present' : 'half_day'
  return 'absent'
}

export const weeklyPayrollOvertimeForDetail = (detail) => {
  if (!detail?.date || !isWeekday(detail.date)) {
    return { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 }
  }
  const checkIn = clockMinutes(detail.row?.check_in ?? detail.check_in)
  const checkOut = clockMinutes(detail.row?.check_out ?? detail.check_out)
  const workedAfterEndMinutes = checkOut == null ? 0 : Math.max(Math.floor(checkOut - 1020), 0)
  return {
    morningOvertimeMinutes: checkIn == null ? 0 : Math.max(Math.round(480 - checkIn), 0),
    eveningOvertimeMinutes: workedAfterEndMinutes < 60 ? 0 : 60 + (Math.floor((workedAfterEndMinutes - 60) / 30) * 30),
  }
}

export const weeklyPayrollOvertimeForLine = (line) => (
  (line?.details || []).reduce((totals, detail) => {
    const overtime = weeklyPayrollOvertimeForDetail(detail)
    return {
      morningOvertimeMinutes: totals.morningOvertimeMinutes + overtime.morningOvertimeMinutes,
      eveningOvertimeMinutes: totals.eveningOvertimeMinutes + overtime.eveningOvertimeMinutes,
    }
  }, { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 })
)

export const formatOvertimeMinutes = (minutes) => {
  const safeMinutes = Math.max(Math.round(Number(minutes) || 0), 0)
  return `${Math.floor(safeMinutes / 60)}h${String(safeMinutes % 60).padStart(2, '0')}`
}

export const formatEveningOvertimeMinutes = (minutes) => {
  const safeMinutes = Math.max(Math.round(Number(minutes) || 0), 0)
  return safeMinutes === 0 ? '—' : formatOvertimeMinutes(safeMinutes)
}

export const calculateWeeklyOvertimePay = ({ morningOvertimeMinutes = 0, eveningOvertimeMinutes = 0, overtimeHourlyRate = null } = {}) => {
  const morningMinutes = Math.max(Number(morningOvertimeMinutes) || 0, 0)
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
