import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'

const workerKey = (value) => String(value || '')

const isCompanyWorkday = (date) => {
  if (!date) return false
  const weekday = new Date(`${date}T12:00:00`).getDay()
  return weekday >= 1 && weekday <= 6
}

const isLaterRow = (candidate, current) => {
  if (!current) return true
  const candidateTimestamp = candidate.updated_at || candidate.created_at || ''
  const currentTimestamp = current.updated_at || current.created_at || ''
  if (candidateTimestamp || currentTimestamp) {
    if (!candidateTimestamp) return false
    if (!currentTimestamp) return true
    return String(candidateTimestamp) > String(currentTimestamp)
  }
  return String(candidate.id || '') > String(current.id || '')
}

export const mergeAttendanceRoster = ({
  workers = [], attendance = [], biometricEvidence = [], date, teamId = '', workerId = '', businessDate,
}) => {
  const attendanceByWorkerId = new Map()
  attendance.forEach((row) => {
    if (date && (row.attendance_date || row.date) !== date) return
    const key = workerKey(row.worker_id || row.worker?.id)
    if (key && isLaterRow(row, attendanceByWorkerId.get(key))) attendanceByWorkerId.set(key, row)
  })
  const biometricEvidenceWorkerIds = new Set(
    biometricEvidence
      .filter((row) => (row.attendance_date || row.date) === date)
      .map((row) => workerKey(row.worker_id || row.workerId))
      .filter(Boolean),
  )

  return workers
    .filter((worker) => (
      isOperationalAttendanceWorkerOnDate(worker, date)
      && (worker.staff_classification || 'normal') === 'normal'
      && (!teamId || workerKey(worker.team_id) === workerKey(teamId))
      && (!workerId || workerKey(worker.id) === workerKey(workerId))
    ))
    .map((worker) => {
      const attendanceRow = attendanceByWorkerId.get(workerKey(worker.id)) || null
      if (attendanceRow) {
        return { ...attendanceRow, worker, team: worker.team || attendanceRow.team, is_virtual: false }
      }
      const isPastWorkday = date < businessDate && isCompanyWorkday(date)
      const hasPendingBiometricEvidence = date === businessDate && biometricEvidenceWorkerIds.has(workerKey(worker.id))
      return {
        id: `roster-${worker.id}-${date}`,
        worker_id: worker.id,
        attendance_date: date,
        date,
        worker,
        team: worker.team || null,
        worker_name: worker.full_name || '—',
        team_name: worker.team_name || worker.team?.name || '—',
        status: isPastWorkday ? 'absent' : null,
        check_in: null,
        check_out: null,
        note: null,
        is_virtual: true,
        roster_state: date === businessDate
          ? hasPendingBiometricEvidence ? 'biometric_pending' : 'not_recorded'
          : isPastWorkday ? 'confirmed_absent' : 'not_applicable',
      }
    })
    .sort((left, right) => String(left.worker_name || left.worker?.full_name || '').localeCompare(String(right.worker_name || right.worker?.full_name || '')))
}

export const attendanceRosterCategory = (row) => {
  if (row.roster_state === 'not_recorded') return 'not_recorded'
  if (row.roster_state === 'biometric_pending') return 'review'
  if (row.roster_state === 'not_applicable') return 'not_applicable'
  if (row.status === 'pending' || row.status === 'in_progress') return 'review'
  if (row.status === 'present' || row.status === 'late' || row.status === 'half_day') return 'present'
  if (row.status === 'absent') return 'absent'
  return 'not_applicable'
}

export const operationalAttendanceStatus = (row = {}) => {
  if (row.status !== 'late') return row.status
  return row.check_out ? 'present' : 'half_day'
}

// Summary/display classification only. Unfinished or unknown canonical states
// are not recorded as a completed attendance outcome; never invent attendance.
// Keep the original row/status so review information remains inspectable.
export const dailyAttendanceBucket = (row = {}) => {
  const status = operationalAttendanceStatus(row)
  return ['present', 'half_day', 'absent'].includes(status) ? status : 'not_recorded'
}

export const summarizeDailyAttendanceRoster = (rows = []) => rows.reduce((counts, row) => {
  counts.total += 1
  counts[dailyAttendanceBucket(row)] += 1
  return counts
}, { total: 0, present: 0, half_day: 0, absent: 0, not_recorded: 0 })

export const summarizeAttendanceRoster = (rows = []) => rows.reduce((summary, row) => {
  const category = attendanceRosterCategory(row)
  summary.total += 1
  if (Object.hasOwn(summary, category)) summary[category] += 1
  return summary
}, { total: 0, present: 0, not_recorded: 0, absent: 0, review: 0, not_applicable: 0 })
