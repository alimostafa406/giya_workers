import { isOperationalAttendanceWorker } from './activeWorkers.js'
import { weeklyPayrollOvertimeForDetail } from './weeklyPayrollOvertime.js'

const normalActiveWorker = (row) => (
  isOperationalAttendanceWorker(row?.worker, row?.team || row?.team_name)
  && (row?.worker?.staff_classification || 'normal') === 'normal'
)

export const attendanceStatusKey = (row = {}) => {
  const status = String(row.status || '').trim()
  return status || 'not_recorded'
}

export const isAttendanceException = (row = {}) => {
  const status = attendanceStatusKey(row)
  const hasMissingCheckout = Boolean(row.check_in) && !row.check_out

  // A completed automatic day is canonicalized to `present`, even when its
  // audit metadata retains an informational late-arrival flag. Supervisors
  // need only non-present states and genuinely incomplete punch records.
  return status !== 'present' || hasMissingCheckout
}

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
  .filter(normalActiveWorker)

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
