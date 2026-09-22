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

const exceptionStatus = (row = {}) => {
  const status = attendanceStatusKey(row)
  return row.check_in && !row.check_out && status === 'present' ? 'half_day' : status
}

export const isAttendanceException = (row = {}) => {
  // A completed automatic day is canonicalized to `present`, even when its
  // audit metadata retains an informational late-arrival flag. Supervisors
  // need only non-present states and genuinely incomplete punch records.
  return exceptionStatus(row) !== 'present'
}

const reportRow = (row, biometricIds = new Map()) => ({
  id: row.id,
  worker: row.worker_name || row.worker?.full_name || '—',
  biometricId: biometricIds.get(workerKey(row.worker_id || row.worker?.id)) || '—',
  team: row.team_name || row.team?.name || '—',
  status: exceptionStatus(row),
  checkIn: row.check_in || '—',
  checkOut: row.check_out || '—',
  note: String(row.note || '').trim() || '—',
})

const boundedActiveNormalRows = (attendance = []) => (Array.isArray(attendance) ? attendance : [])
  .filter(normalActiveWorker)

const workerKey = (value) => String(value || '')

const biometricIdsByWorker = (mappings = []) => {
  const idsByWorker = new Map()
  ;(Array.isArray(mappings) ? mappings : []).forEach((mapping) => {
    const workerId = workerKey(mapping?.worker_id)
    const biometricId = String(mapping?.device_employee_no || '').trim()
    if (!workerId || !biometricId || mapping?.is_active !== true || mapping?.mapping_review_state !== 'confirmed') return
    idsByWorker.set(workerId, new Set([...(idsByWorker.get(workerId) || []), biometricId]))
  })
  return new Map([...idsByWorker.entries()].map(([workerId, ids]) => [
    workerId,
    [...ids].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).join(' · '),
  ]))
}

const isLaterAttendanceRow = (candidate, current) => {
  if (!current) return true
  const candidateTimestamp = candidate.updated_at || candidate.created_at || ''
  const currentTimestamp = current.updated_at || current.created_at || ''
  if (candidateTimestamp || currentTimestamp) return String(candidateTimestamp) > String(currentTimestamp)
  return String(candidate.id || '') > String(current.id || '')
}

const rosterAttendanceRows = ({ workers = [], attendance = [], date } = {}) => {
  const attendanceByWorkerId = new Map()
  ;(Array.isArray(attendance) ? attendance : []).forEach((row) => {
    if (date && (row.attendance_date || row.date) !== date) return
    const key = workerKey(row.worker_id || row.worker?.id)
    if (key && isLaterAttendanceRow(row, attendanceByWorkerId.get(key))) attendanceByWorkerId.set(key, row)
  })

  const rosterWorkers = Array.isArray(workers) && workers.length
    ? workers
    : [...attendanceByWorkerId.values()]
      .filter((row) => row.worker)
      .map((row) => ({
        ...row.worker,
        team: row.worker.team || row.team,
        team_name: row.worker.team_name || row.team_name || row.team?.name,
      }))

  return rosterWorkers
    .filter((worker) => (
      isOperationalAttendanceWorker(worker)
      && (worker.staff_classification || 'normal') === 'normal'
    ))
    .map((worker) => {
      const attendanceRow = attendanceByWorkerId.get(workerKey(worker.id))
      if (attendanceRow) {
        return {
          ...attendanceRow,
          worker: attendanceRow.worker || worker,
          worker_name: attendanceRow.worker_name || worker.full_name,
          team: attendanceRow.team || worker.team,
          team_name: attendanceRow.team_name || worker.team_name || worker.team?.name,
        }
      }
      return {
        id: `daily-exception-${worker.id}-${date || 'selected-date'}`,
        worker_id: worker.id,
        attendance_date: date || null,
        worker,
        worker_name: worker.full_name,
        team: worker.team || null,
        team_name: worker.team_name || worker.team?.name,
        status: 'absent',
        check_in: null,
        check_out: null,
        note: null,
        is_virtual: true,
      }
    })
}

export const buildDailyAttendanceExceptions = ({ workers = [], attendance = [], mappings = [], date } = {}) => {
  const biometricIds = biometricIdsByWorker(mappings)
  return rosterAttendanceRows({ workers, attendance, date })
    .filter(isAttendanceException)
    .map((row) => reportRow(row, biometricIds))
    .sort((left, right) => left.team.localeCompare(right.team) || left.worker.localeCompare(right.worker))
}

export const buildDailyOvertimeReport = ({ attendance = [], mappings = [], date } = {}) => {
  const biometricIds = biometricIdsByWorker(mappings)
  return boundedActiveNormalRows(attendance)
    .map((row) => ({ ...reportRow(row, biometricIds), overtimeMinutes: weeklyPayrollOvertimeForDetail({ date, status: row.status, row }).eveningOvertimeMinutes }))
    .filter((row) => row.overtimeMinutes > 0)
    .sort((left, right) => left.team.localeCompare(right.team) || left.worker.localeCompare(right.worker))
}

export const yesterdayFromBusinessDate = (businessDate) => {
  const value = new Date(`${businessDate}T12:00:00`)
  value.setDate(value.getDate() - 1)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
