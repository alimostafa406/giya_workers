import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'
import { weeklyPayrollOvertimeForDetail } from './weeklyPayrollOvertime.js'
import { isOvertimeReportEligible } from './overtimeReportEligibility.js'

const normalActiveWorker = (row, date = '') => (
  isOperationalAttendanceWorkerOnDate(row?.worker, date, row?.team || row?.team_name)
  && (row?.worker?.staff_classification || 'normal') === 'normal'
)

export const attendanceStatusKey = (row = {}) => {
  const status = String(row.status || '').trim()
  return status || 'not_recorded'
}

const exceptionStatus = (row = {}) => {
  const status = attendanceStatusKey(row)
  // A canonical full-day present row is authoritative even when its valid
  // attendance model does not require checkout (for example Chauffeur).
  // Retain the defensive one-punch exception only for legacy/partial rows
  // that were marked present without a full-day fraction.
  const canonicalFullDay = Number(row.attendance_day_fraction) === 1
  return row.check_in && !row.check_out && status === 'present' && !canonicalFullDay ? 'half_day' : status
}

export const isAttendanceException = (row = {}) => {
  // A completed automatic day is canonicalized to `present`, even when its
  // audit metadata retains an informational late-arrival flag. Supervisors
  // need only non-present states and genuinely incomplete punch records.
  return exceptionStatus(row) !== 'present'
}

const reportRow = (row, biometricIds = new Map()) => ({
  id: row.id,
  isVirtual: row.is_virtual === true,
  worker: row.worker_name || row.worker?.full_name || '—',
  biometricId: biometricIds.get(workerKey(row.worker_id || row.worker?.id)) || '—',
  team: row.team_name || row.team?.name || '—',
  status: exceptionStatus(row),
  checkIn: row.check_in || '—',
  checkOut: row.check_out || '—',
  note: String(row.note || '').trim() || '—',
})

const boundedActiveNormalRows = (attendance = [], date = '') => (Array.isArray(attendance) ? attendance : [])
  .filter((row) => normalActiveWorker(row, date))

const workerKey = (value) => String(value || '')

const clockValue = (timestamp) => {
  const instant = new Date(timestamp)
  if (Number.isNaN(instant.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kinshasa', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)
  const value = (type) => parts.find((part) => part.type === type)?.value
  const hour = value('hour'); const minute = value('minute'); const second = value('second')
  return hour && minute && second ? `${hour}:${minute}:${second}` : null
}

const clockSeconds = (value) => {
  const match = String(value || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0) : null
}

export const latestPunchesByWorker = (evidence = [], date) => {
  const latest = new Map()
  ;(Array.isArray(evidence) ? evidence : []).forEach((event) => {
    if (date && String(event?.attendance_date || '') !== date) return
    const workerId = workerKey(event?.worker_id)
    const clock = clockValue(event?.event_timestamp)
    if (!workerId || !clock || clockSeconds(clock) == null) return
    const current = latest.get(workerId)
    if (!current || clockSeconds(clock) > clockSeconds(current)) latest.set(workerId, clock)
  })
  return latest
}

export const biometricIdsByWorker = (mappings = []) => {
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
      isOperationalAttendanceWorkerOnDate(worker, date)
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

export const buildDailyAttendanceExceptions = ({ workers = [], attendance = [], evidence = [], mappings = [], date } = {}) => {
  const biometricIds = biometricIdsByWorker(mappings)
  const latestPunches = latestPunchesByWorker(evidence, date)
  return rosterAttendanceRows({ workers, attendance, date })
    .filter(isAttendanceException)
    .map((row) => {
      const checkInSeconds = clockSeconds(row.check_in)
      const latestPunch = latestPunches.get(workerKey(row.worker_id || row.worker?.id)) || null
      return {
        ...reportRow(row, biometricIds),
        lastPunch: checkInSeconds != null && latestPunch && clockSeconds(latestPunch) > checkInSeconds ? latestPunch : '—',
      }
    })
    .sort((left, right) => left.team.localeCompare(right.team) || left.worker.localeCompare(right.worker))
}

export const buildDailyOvertimeReport = ({ attendance = [], mappings = [], date, overtimeTeamIds = [] } = {}) => {
  const biometricIds = biometricIdsByWorker(mappings)
  return boundedActiveNormalRows(attendance, date)
    .filter((row) => !date || (row.attendance_date || row.date) === date)
    .map((row) => ({ ...reportRow(row, biometricIds), teamId: row.worker?.team_id || row.team_id || row.team?.id, overtimeMinutes: weeklyPayrollOvertimeForDetail({ date, status: row.status, row }).eveningOvertimeMinutes }))
    .filter((row) => isOvertimeReportEligible({ teamId: row.teamId, teamName: row.team, overtimeMinutes: row.overtimeMinutes }, overtimeTeamIds))
    .sort((left, right) => left.team.localeCompare(right.team) || left.worker.localeCompare(right.worker))
}

export const yesterdayFromBusinessDate = (businessDate) => {
  const value = new Date(`${businessDate}T12:00:00`)
  value.setDate(value.getDate() - 1)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
