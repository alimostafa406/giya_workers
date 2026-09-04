const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const BUSINESS_TIME_ZONE = 'Africa/Lagos'

const parseDateOnly = (dateText) => {
  if (!DATE_ONLY_PATTERN.test(String(dateText || ''))) return null
  const date = new Date(`${dateText}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const formatDateOnly = (date) => (
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
)

export const getWeeklyReportBusinessDate = (value = new Date()) => {
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value)) return value

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

export const getWeeklyReportRange = (referenceDate = new Date()) => {
  const today = parseDateOnly(getWeeklyReportBusinessDate(referenceDate))
  const start = new Date(today)
  start.setUTCDate(today.getUTCDate() - today.getUTCDay())
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)

  return { startDate: formatDateOnly(start), endDate: formatDateOnly(end) }
}

export const getDefaultWeeklyReportRange = (referenceDate = new Date()) => (
  getWeeklyReportRange(referenceDate)
)

export const shiftWeeklyReportRange = (referenceDate, weekOffset) => {
  const currentRange = getWeeklyReportRange(referenceDate)
  const start = parseDateOnly(currentRange.startDate)
  start.setUTCDate(start.getUTCDate() + (Number(weekOffset) * 7))
  return getWeeklyReportRange(formatDateOnly(start))
}

export const buildWeeklyReportDateRange = (startDate, endDate) => {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (!start || !end || start > end) return []

  const dates = []
  const cursor = new Date(start)
  while (cursor <= end) {
    dates.push(formatDateOnly(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export const normalizeWeeklyAttendanceStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'present' || normalized === 'حاضر') return 'present'
  if (normalized === 'late') return 'late'
  if (normalized === 'half_day') return 'half_day'
  if (normalized === 'absent' || normalized === 'غائب') return 'absent'
  return 'unresolved'
}

export const classifyWeeklyReportDay = ({ date, status, checkOut, businessDate }) => {
  const parsedDate = parseDateOnly(date)
  if (!parsedDate) return 'unresolved'

  if (date > businessDate) return 'future'
  const normalizedStatus = normalizeWeeklyAttendanceStatus(status)
  const reportStatus = normalizedStatus === 'late' ? (checkOut ? 'present' : 'half_day') : normalizedStatus

  // Sunday is displayed inside the report cycle, but stays outside normal
  // attendance totals. Real Sunday work remains visible when it was recorded.
  if (parsedDate.getUTCDay() === 0) {
    if (reportStatus === 'present') return 'sunday_present'
    if (reportStatus === 'half_day') return 'sunday_half_day'
    return 'sunday'
  }

  return reportStatus
}

const lateWorkedFraction = (attendance = {}) => {
  const rawFraction = attendance.attendance_day_fraction
  const storedFraction = Number(rawFraction)
  if (rawFraction !== null && rawFraction !== undefined && rawFraction !== '' && Number.isFinite(storedFraction)) {
    return Math.max(0, Math.min(1, storedFraction))
  }
  return attendance.check_out ? 1 : 0.5
}

export const summarizeWeeklyAttendanceDays = ({ dates, getStatus = () => undefined, getAttendance, businessDate }) => {
  const days = dates.map((date) => {
    const attendance = getAttendance?.(date) || null
    const sourceStatus = attendance?.status ?? getStatus(date)
    const normalizedStatus = normalizeWeeklyAttendanceStatus(sourceStatus)
    const status = classifyWeeklyReportDay({ date, status: sourceStatus, checkOut: attendance?.check_out, businessDate })
    const workedFraction = date > businessDate || status.startsWith('sunday')
      ? 0
      : normalizedStatus === 'late'
        ? lateWorkedFraction(attendance || {})
        : status === 'present'
          ? 1
          : status === 'half_day' ? 0.5 : 0
    return { date, status, workedFraction }
  })

  return {
    days,
    presentDays: days.reduce((total, day) => total + day.workedFraction, 0),
    absentDays: days.filter((day) => day.status === 'absent').length,
  }
}
