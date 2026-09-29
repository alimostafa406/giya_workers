import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'

const key = (value) => String(value || '')
const dates = (from, to) => {
  const result = []
  for (const day = new Date(`${from}T12:00:00`); day <= new Date(`${to}T12:00:00`); day.setDate(day.getDate() + 1)) {
    if (day.getDay() !== 0) result.push(day.toISOString().slice(0, 10))
  }
  return result
}
const absent = (row) => !row || row.status === 'absent'

export const buildWorkerControlAlerts = ({ workers = [], attendance: rows = [], events = [], activated = [], today, weekStart, monthStart } = {}) => {
  const alerts = []
  const attendanceByWorker = new Map()
  const lastAttendanceByWorker = new Map()
  rows.forEach((row) => {
    const id = key(row.worker_id)
    if (!attendanceByWorker.has(id)) attendanceByWorker.set(id, new Map())
    const workerRows = attendanceByWorker.get(id)
    const date = row.attendance_date || row.date
    // The former Array.find selected the first row for a worker/date.
    if (!workerRows.has(date)) workerRows.set(date, row)
    const previous = lastAttendanceByWorker.get(id)
    if (row.status !== 'absent' && (!previous || String(row.attendance_date) > String(previous.attendance_date))) {
      lastAttendanceByWorker.set(id, row)
    }
  })
  const eventsByWorker = new Map()
  events.forEach((event) => {
    const id = key(event.worker_id)
    if (!eventsByWorker.has(id)) eventsByWorker.set(id, [])
    eventsByWorker.get(id).push(event)
  })

  workers.filter((worker) => (worker.staff_classification || 'normal') === 'normal').forEach((worker) => {
    const id = key(worker.id)
    const workerRows = attendanceByWorker.get(id) || new Map()
    const month = dates(monthStart, today).filter((date) => isOperationalAttendanceWorkerOnDate(worker, date))
    if (!month.length) return
    const week = dates(weekStart, today).filter((date) => isOperationalAttendanceWorkerOnDate(worker, date))
    const monthRows = month.map((date) => workerRows.get(date))
    const weekAbsent = week.filter((date) => absent(workerRows.get(date))).length
    const monthAbsent = monthRows.filter(absent).length
    const half = monthRows.filter((row) => row?.status === 'half_day').length
    let streak = 0
    let longest = 0
    monthRows.forEach((row) => {
      streak = absent(row) ? streak + 1 : 0
      longest = Math.max(longest, streak)
    })
    const todayRow = workerRows.get(today)
    const lastAttendance = lastAttendanceByWorker.get(id)
    const lastPunch = [...(eventsByWorker.get(id) || [])].sort((a, b) => String(b.event_timestamp).localeCompare(String(a.event_timestamp)))[0]
    const base = { worker, todayRow, longest, weekAbsent, monthAbsent, half, lastAttendance, lastPunch }
    if (longest >= 3) alerts.push({ ...base, type: 'consecutive_absence', severity: 'critical' })
    else if (longest >= 2) alerts.push({ ...base, type: 'consecutive_absence', severity: 'warning' })
    if (weekAbsent >= 2) alerts.push({ ...base, type: 'weekly_absence', severity: 'warning' })
    if (monthAbsent >= 5) alerts.push({ ...base, type: 'monthly_absence', severity: 'critical' })
    else if (monthAbsent >= 3) alerts.push({ ...base, type: 'monthly_absence', severity: 'watch' })
    if (todayRow?.status === 'present') {
      let previousAbsent = 0
      for (let index = monthRows.length - 2; index >= 0 && absent(monthRows[index]); index--) previousAbsent += 1
      if (previousAbsent >= 2) alerts.push({ ...base, type: 'returned_after_absence', severity: 'watch', longest: previousAbsent })
    }
  })
  workers.filter((worker) => worker.is_active === false).forEach((worker) => {
    const workerEvents = eventsByWorker.get(key(worker.id)) || []
    workerEvents.forEach((lastPunch) => alerts.push({ worker, lastPunch, type: 'inactive_punch', severity: 'critical' }))
  })
  activated.forEach((worker) => alerts.push({ worker, type: 'activated_today', severity: 'info' }))
  return alerts
}
