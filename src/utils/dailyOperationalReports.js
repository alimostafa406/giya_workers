import { isActiveWorker } from './activeWorkers.js'
import { weeklyPayrollOvertimeForDetail } from './weeklyPayrollOvertime.js'

const normalActiveWorker = (worker) => (
  isActiveWorker(worker) && (worker?.staff_classification || 'normal') === 'normal'
)

const metadata = (row) => {
  if (!row?.biometric_sync_metadata) return null
  if (typeof row.biometric_sync_metadata === 'object') return row.biometric_sync_metadata
  try { return JSON.parse(row.biometric_sync_metadata) } catch { return null }
}

export const attendanceStatusKey = (row = {}) => {
  const status = String(row.status || '').trim()
  return status || 'not_recorded'
}

export const isAttendanceException = (row = {}) => (
  attendanceStatusKey(row) !== 'present' || metadata(row)?.late_arrival === true
)

const reportRow = (row) => ({
  id: row.id,
  worker: row.worker_name || row.worker?.full_name || '—',
  employeeCode: row.worker?.employee_code || row.employee_code || '—',
  team: row.team_name || row.team?.name || '—',
  status: attendanceStatusKey(row),
  checkIn: row.check_in || '—',
  checkOut: row.check_out || '—',
  note: String(row.note || '').trim() || '—',
})

const boundedActiveNormalRows = (attendance = []) => (Array.isArray(attendance) ? attendance : [])
  .filter((row) => normalActiveWorker(row.worker))

export const buildDailyAttendanceExceptions = ({ attendance = [] } = {}) => (
  boundedActiveNormalRows(attendance)
    .filter(isAttendanceException)
    .map(reportRow)
    .sort((left, right) => left.team.localeCompare(right.team) || left.worker.localeCompare(right.worker))
)

export const buildDailyOvertimeReport = ({ attendance = [], date } = {}) => (
  boundedActiveNormalRows(attendance)
    .map((row) => ({ ...reportRow(row), overtimeMinutes: weeklyPayrollOvertimeForDetail({ date, status: row.status, row }).eveningOvertimeMinutes }))
    .filter((row) => row.overtimeMinutes > 0)
    .sort((left, right) => left.team.localeCompare(right.team) || left.worker.localeCompare(right.worker))
)

export const yesterdayFromBusinessDate = (businessDate) => {
  const value = new Date(`${businessDate}T12:00:00`)
  value.setDate(value.getDate() - 1)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
