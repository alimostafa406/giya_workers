const asArray = (value) => (Array.isArray(value) ? value : [])

const attendanceSortValue = (row) => `${row?.attendance_date || row?.date || ''}|${row?.updated_at || row?.created_at || ''}`

export const buildInactiveWorkerRows = ({ workers = [], mappings = [], unresolvedEvents = [], attendance = [] } = {}) => {
  const mappingsByWorker = new Map()
  asArray(mappings).forEach((mapping) => {
    if (!mapping?.worker_id) return
    const workerId = String(mapping.worker_id)
    mappingsByWorker.set(workerId, [...(mappingsByWorker.get(workerId) || []), mapping])
  })

  const eventsByWorker = new Map()
  asArray(unresolvedEvents).forEach((event) => {
    if ((event?.resolution_reason && event.resolution_reason !== 'inactive_worker') || !event?.worker_id) return
    const workerId = String(event.worker_id)
    eventsByWorker.set(workerId, [...(eventsByWorker.get(workerId) || []), event])
  })

  const attendanceByWorker = new Map()
  asArray(attendance).forEach((row) => {
    if (!row?.worker_id) return
    const workerId = String(row.worker_id)
    attendanceByWorker.set(workerId, [...(attendanceByWorker.get(workerId) || []), row])
  })

  return asArray(workers)
    .filter((worker) => worker?.is_active === false)
    .map((worker) => {
      const workerEvents = eventsByWorker.get(String(worker.id)) || []
      const latestEvent = [...workerEvents].sort((left, right) => (
        new Date(right.event_timestamp || 0).getTime() - new Date(left.event_timestamp || 0).getTime()
      ))[0] || null
      const attendanceHistory = [...(attendanceByWorker.get(String(worker.id)) || [])]
        .sort((left, right) => attendanceSortValue(right).localeCompare(attendanceSortValue(left)))
      return {
        ...worker,
        biometricMappings: mappingsByWorker.get(String(worker.id)) || [],
        biometricEventsToday: workerEvents,
        latestBiometricEvent: latestEvent,
        attendanceHistory,
        latestAttendance: attendanceHistory[0] || null,
      }
    })
    .sort((left, right) => String(left.full_name || '').localeCompare(String(right.full_name || '')))
}

export const filterInactiveWorkerRows = (rows = [], { query = '', teamId = '', punch = '' } = {}) => {
  const normalized = String(query).trim().toLowerCase()
  return rows.filter((row) => {
    const matchesQuery = !normalized || [row.full_name, row.employee_code, row.team?.name, row.team_name,
      ...row.biometricMappings.flatMap((mapping) => [mapping.device_employee_no, mapping.device_id, mapping.device_name]),
    ].some((value) => String(value || '').toLowerCase().includes(normalized))
    const matchesTeam = !teamId || String(row.team_id || '') === String(teamId)
    const hasPunch = row.biometricEventsToday.length > 0
    const matchesPunch = !punch || (punch === 'yes' ? hasPunch : !hasPunch)
    return matchesQuery && matchesTeam && matchesPunch
  })
}
