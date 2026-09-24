import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'
import { weeklyPayrollOvertimeForDetail } from './weeklyPayrollOvertime.js'

const key = (value) => String(value || '')
const dateOf = (row) => row?.attendance_date || row?.date || ''
const isoDate = (date) => date.toISOString().slice(0, 10)
const calendarDates = (start, end) => {
  const days = []
  if (!start || !end || start > end) return days
  for (const day = new Date(`${start}T12:00:00Z`); day <= new Date(`${end}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0) days.push(isoDate(day))
  }
  return days
}
const saturdayOf = (monday) => {
  const date = new Date(`${monday}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 5)
  return isoDate(date)
}
const eventDate = (value) => {
  if (!value) return ''
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kinshasa', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
const metadataOf = (row) => {
  if (typeof row?.biometric_sync_metadata !== 'string') return row?.biometric_sync_metadata || null
  try { return JSON.parse(row.biometric_sync_metadata) } catch { return null }
}
const latest = (values) => values.filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)))[0] || null
const isAttendance = (status) => status === 'present' || status === 'half_day' || status === 'late'

export const monitoringFactText = (fact) => {
  switch (fact?.code) {
    case 'consecutive_absence': return `غائب ${fact.count} أيام متتالية`
    case 'week_absence': return `غاب ${fact.count} أيام خلال هذا الأسبوع`
    case 'month_absence': return `غاب ${fact.count} أيام خلال هذا الشهر`
    case 'month_half_day': return `لديه ${fact.count} أنصاف يوم خلال هذا الشهر`
    case 'returned': return `عاد بعد ${fact.count} أيام غياب`
    case 'activated_today': return 'تم تفعيله اليوم'
    case 'inactive_punch_today': return 'غير مفعّل وقام بالبصمة اليوم'
    default: return null
  }
}

export const buildWorkerControlDetail = ({ worker, attendance = [], events = [], mappings = [], activated = [], today, weekStart, monthStart } = {}) => {
  if (!worker?.id) return null
  const id = key(worker.id)
  const rows = new Map(attendance.filter((row) => key(row.worker_id) === id).map((row) => [dateOf(row), row]))
  const workerEvents = events.filter((event) => key(event.worker_id) === id)
  const workerMappings = mappings.filter((mapping) => key(mapping.worker_id) === id)
  const activation = activated.find((item) => key(item.worker_id || item.id) === id) || null
  const monthDates = calendarDates(monthStart, today)
  const weekDates = calendarDates(weekStart, saturdayOf(weekStart))
  const evidenceFor = (date, row) => {
    const metadata = metadataOf(row)
    const matchingEvents = workerEvents.filter((event) => eventDate(event.event_timestamp) === date)
    const matchingPunch = matchingEvents.sort((a, b) => String(b.event_timestamp || '').localeCompare(String(a.event_timestamp || '')))[0] || null
    return {
      lastPunch: latest([matchingPunch?.event_timestamp, metadata?.check_in_event_timestamp, metadata?.check_out_event_timestamp]),
      device: matchingPunch?.device_id || metadata?.device_id || null,
    }
  }
  const day = (date) => {
    const row = rows.get(date) || null
    const eligible = isOperationalAttendanceWorkerOnDate(worker, date)
    const future = date > today
    const evidence = evidenceFor(date, row)
    return {
      date, row, eligible, future,
      status: future ? 'future' : !eligible && worker.is_active ? 'not_applicable' : row?.status || (eligible ? 'no_record' : 'not_applicable'),
      checkIn: row?.check_in || null,
      checkOut: row?.check_out || null,
      overtimeMinutes: row && !future ? weeklyPayrollOvertimeForDetail({ date, row, worker, status: row.status }).eveningOvertimeMinutes : 0,
      ...evidence,
    }
  }
  const week = weekDates.map(day)
  const month = monthDates.map(day).filter((item) => item.eligible || (worker.is_active === false && item.row))
  const eligibleMonth = month.filter((item) => item.eligible)
  const eligibleWeek = week.filter((item) => item.eligible && !item.future)
  const counts = (days) => ({
    present: days.filter((item) => item.status === 'present').length,
    absent: days.filter((item) => item.status === 'absent').length,
    halfDay: days.filter((item) => item.status === 'half_day').length,
    noRecord: days.filter((item) => item.status === 'no_record').length,
    overtimeMinutes: days.reduce((total, item) => total + item.overtimeMinutes, 0),
    overtimeDays: days.filter((item) => item.overtimeMinutes > 0).length,
  })
  const weekCounts = counts(eligibleWeek)
  const monthCounts = counts(eligibleMonth)
  const absenceDays = month.filter((item) => item.status === 'absent')
  const halfDays = month.filter((item) => item.status === 'half_day')
  const absenceStreaks = []
  let current = null
  month.forEach((item) => {
    if (item.status === 'absent') {
      if (!current) current = { from: item.date, to: item.date, count: 0 }
      current.to = item.date
      current.count += 1
    } else if (current) {
      absenceStreaks.push(current)
      current = null
    }
  })
  if (current) absenceStreaks.push(current)
  const longestAbsence = Math.max(0, ...absenceStreaks.map((streak) => streak.count))
  const currentAbsence = month.at(-1)?.status === 'absent' ? absenceStreaks.at(-1)?.count || 0 : 0
  const returnedAfter = month.at(-1)?.status === 'present' && month.at(-2)?.status === 'absent'
    ? absenceStreaks.at(-1)?.count || 0 : 0
  const latestEvent = workerEvents.sort((a, b) => String(b.event_timestamp || '').localeCompare(String(a.event_timestamp || '')))[0] || null
  const lastAttendance = [...month].reverse().find((item) => isAttendance(item.status))?.date || null
  const lastPunch = latest([latestEvent?.event_timestamp, ...month.map((item) => item.lastPunch)])
  const todayDetail = day(today)
  const monitoring = []
  if (currentAbsence >= 2) monitoring.push({ code: 'consecutive_absence', count: currentAbsence })
  if (weekCounts.absent >= 2) monitoring.push({ code: 'week_absence', count: weekCounts.absent })
  if (monthCounts.absent >= 3) monitoring.push({ code: 'month_absence', count: monthCounts.absent })
  if (monthCounts.halfDay >= 2) monitoring.push({ code: 'month_half_day', count: monthCounts.halfDay })
  if (returnedAfter >= 2) monitoring.push({ code: 'returned', count: returnedAfter })
  if (activation) monitoring.push({ code: 'activated_today' })
  if (worker.is_active === false && workerEvents.some((event) => eventDate(event.event_timestamp) === today)) monitoring.push({ code: 'inactive_punch_today' })
  const attendancePercentage = eligibleMonth.length
    ? ((monthCounts.present + (monthCounts.halfDay * 0.5)) / eligibleMonth.length) * 100
    : null

  return {
    worker, today: todayDetail, week, month, weekCounts, monthCounts,
    absenceDays, absenceStreaks, halfDays, longestAbsence, currentAbsence,
    attendancePercentage, lastAttendance, lastPunch, latestEvent,
    mappings: workerMappings.map((mapping) => ({
      ...mapping,
      latestPunch: latest(workerEvents.filter((event) => (
        key(event.device_id) === key(mapping.device_id)
        && key(event.device_employee_no || event.employeeNoString) === key(mapping.device_employee_no)
      )).map((event) => event.event_timestamp)),
    })),
    activation, monitoring,
  }
}
