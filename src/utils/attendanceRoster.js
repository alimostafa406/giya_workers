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
  workers = [], attendance = [], date, teamId = '', workerId = '', businessDate,
}) => {
  const attendanceByWorkerId = new Map()
  attendance.forEach((row) => {
    if (date && (row.attendance_date || row.date) !== date) return
    const key = workerKey(row.worker_id || row.worker?.id)
    if (key && isLaterRow(row, attendanceByWorkerId.get(key))) attendanceByWorkerId.set(key, row)
  })

  return workers
    .filter((worker) => (
      worker.is_active !== false
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
        roster_state: date === businessDate ? 'not_recorded' : isPastWorkday ? 'confirmed_absent' : 'not_applicable',
      }
    })
    .sort((left, right) => String(left.worker_name || left.worker?.full_name || '').localeCompare(String(right.worker_name || right.worker?.full_name || '')))
}

export const attendanceRosterCategory = (row) => {
  if (row.roster_state === 'not_recorded') return 'not_recorded'
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

export const summarizeAttendanceRoster = (rows = []) => rows.reduce((summary, row) => {
  const category = attendanceRosterCategory(row)
  summary.total += 1
  if (Object.hasOwn(summary, category)) summary[category] += 1
  return summary
}, { total: 0, present: 0, not_recorded: 0, absent: 0, review: 0, not_applicable: 0 })
