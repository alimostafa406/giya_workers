import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'

const workerKey = (value) => String(value || '')
const workDates = (start, end) => {
  const dates = []
  if (!start || !end) return dates
  for (const day = new Date(`${start}T12:00:00Z`); day <= new Date(`${end}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0) dates.push(day.toISOString().slice(0, 10))
  }
  return dates
}

export const buildWorkerControlSectionMetrics = ({ workers = [], attendance = [], events = [], alerts = [], today, weekStart, monthStart } = {}) => {
  const attendanceByWorker = new Map()
  attendance.forEach((row) => {
    const id = workerKey(row.worker_id)
    if (!attendanceByWorker.has(id)) attendanceByWorker.set(id, new Map())
    attendanceByWorker.get(id).set(row.attendance_date || row.date, row)
  })
  const eventsByWorker = new Map()
  events.forEach((event) => {
    const id = workerKey(event.worker_id)
    const previous = eventsByWorker.get(id)
    if (!previous || String(event.event_timestamp || '') > String(previous.event_timestamp || '')) eventsByWorker.set(id, event)
  })
  const monitoredIds = new Set(alerts.filter((alert) => alert.type !== 'activated_today' && alert.type !== 'inactive_punch').map((alert) => workerKey(alert.worker?.id)))
  const streakIds = new Set(alerts.filter((alert) => alert.type === 'consecutive_absence').map((alert) => workerKey(alert.worker?.id)))
  const weekDates = workDates(weekStart, today)
  const monthDates = workDates(monthStart, today)
  const teams = new Map()
  const halfDayRows = []

  workers.filter((worker) => isOperationalAttendanceWorkerOnDate(worker, today)).forEach((worker) => {
    const id = workerKey(worker.id)
    const rows = attendanceByWorker.get(id) || new Map()
    const eligibleWeek = weekDates.filter((date) => isOperationalAttendanceWorkerOnDate(worker, date))
    const eligibleMonth = monthDates.filter((date) => isOperationalAttendanceWorkerOnDate(worker, date))
    const weekHalf = eligibleWeek.filter((date) => rows.get(date)?.status === 'half_day').length
    const monthHalf = eligibleMonth.filter((date) => rows.get(date)?.status === 'half_day').length
    const todayRow = rows.get(today) || null
    if (todayRow?.status === 'half_day' || weekHalf >= 2 || monthHalf >= 2) {
      halfDayRows.push({ type: 'half_day_monitoring', worker, todayRow, weekHalf, monthHalf, lastPunch: eventsByWorker.get(id) || null })
    }

    const teamId = workerKey(worker.team_id)
    if (!teams.has(teamId)) teams.set(teamId, { id: teamId, name: worker.team?.name || worker.team_name, workers: [], active: 0, present: 0, halfDay: 0, absent: 0, notRecorded: 0, weekAbsent: 0, monthAbsent: 0, consecutive: 0, monitored: 0 })
    const team = teams.get(teamId)
    team.workers.push(worker)
    team.active += 1
    if (!todayRow) team.notRecorded += 1
    else if (todayRow.status === 'present') team.present += 1
    else if (todayRow.status === 'half_day') team.halfDay += 1
    else if (todayRow.status === 'absent') team.absent += 1
    // Match the existing V1 absence-monitoring totals: an eligible workday
    // without an attendance row contributes to period absence monitoring.
    team.weekAbsent += eligibleWeek.filter((date) => !rows.get(date) || rows.get(date)?.status === 'absent').length
    team.monthAbsent += eligibleMonth.filter((date) => !rows.get(date) || rows.get(date)?.status === 'absent').length
    if (streakIds.has(id)) team.consecutive += 1
    if (monitoredIds.has(id) || todayRow?.status === 'half_day' || weekHalf >= 2 || monthHalf >= 2) team.monitored += 1
  })

  halfDayRows.sort((a, b) => b.monthHalf - a.monthHalf || b.weekHalf - a.weekHalf || String(a.worker.full_name || '').localeCompare(String(b.worker.full_name || '')))
  return { halfDayRows, teamRows: [...teams.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))) }
}
