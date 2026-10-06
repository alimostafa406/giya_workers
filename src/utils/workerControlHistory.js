import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'
import { weeklyPayrollOvertimeForDetail } from './weeklyPayrollOvertime.js'

const iso = (date) => date.toISOString().slice(0, 10)
const addMonths = (value, count) => {
  const date = new Date(`${value}T12:00:00Z`)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + count)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return iso(date)
}

export const workerHistoryRange = (preset, today, customFrom = '', customTo = '') => {
  if (preset === 'custom') return { dateFrom: customFrom, dateTo: customTo }
  if (preset === 'this-month') return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today }
  const months = { 'last-month': 1, 'last-two-months': 2, 'last-three-months': 3 }[preset] || 1
  return { dateFrom: addMonths(today, -months), dateTo: today }
}

export const validWorkerHistoryRange = ({ dateFrom, dateTo }, today) => (
  /^\d{4}-\d{2}-\d{2}$/.test(dateFrom || '')
  && /^\d{4}-\d{2}-\d{2}$/.test(dateTo || '')
  && dateFrom <= dateTo && dateTo <= today
)

export const buildWorkerHistory = ({ worker, attendance = [], dateFrom, dateTo } = {}) => {
  if (!worker?.id || !dateFrom || !dateTo || dateFrom > dateTo) return { days: [], summary: { eligible: 0, present: 0, halfDay: 0, absent: 0, percentage: null } }
  const rows = new Map(attendance.filter((row) => String(row.worker_id) === String(worker.id)).map((row) => [row.attendance_date, row]))
  const days = []
  for (const date = new Date(`${dateFrom}T12:00:00Z`); iso(date) <= dateTo; date.setUTCDate(date.getUTCDate() + 1)) {
    const workday = iso(date)
    if (date.getUTCDay() === 0 || !isOperationalAttendanceWorkerOnDate(worker, workday)) continue
    const row = rows.get(workday) || null
    days.push({
      date: workday, status: row?.status || 'no_record', checkIn: row?.check_in || null, checkOut: row?.check_out || null,
      overtimeMinutes: row ? weeklyPayrollOvertimeForDetail({ date: workday, row, worker, status: row.status }).eveningOvertimeMinutes : 0,
      note: row?.note || null, source: row?.attendance_source || null,
    })
  }
  const summary = {
    eligible: days.length,
    present: days.filter((day) => day.status === 'present').length,
    halfDay: days.filter((day) => day.status === 'half_day').length,
    absent: days.filter((day) => day.status === 'absent').length,
    percentage: days.length ? (days.filter((day) => day.status === 'present').length + days.filter((day) => day.status === 'half_day').length * 0.5) / days.length * 100 : null,
  }
  return { days, summary }
}
