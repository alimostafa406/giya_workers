const BUSINESS_TIME_ZONE = 'Africa/Kinshasa'

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const atNoon = (value) => new Date(`${value}T12:00:00`)

export const attendanceBusinessDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)

export const absenceWeekDates = (businessDate) => {
  const monday = atNoon(businessDate)
  const day = monday.getDay()
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1))
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return iso(date)
  })
}

export const hasAttendanceCheckIn = (row = {}) => (
  Boolean(row.worker_id && row.attendance_date && String(row.check_in || '').trim())
)

export const createAbsenceReportRefreshCoordinator = () => {
  let activeRefresh = null
  const run = async (key, load) => {
    if (activeRefresh) {
      if (activeRefresh.key === key) return activeRefresh.promise
      try { await activeRefresh.promise } catch { /* A different snapshot still receives its own attempt. */ }
      return run(key, load)
    }
    let promise
    promise = Promise.resolve().then(load).finally(() => {
      if (activeRefresh?.promise === promise) activeRefresh = null
    })
    activeRefresh = { key, promise }
    return promise
  }
  return run
}

const stateFor = (hasCheckIn, date, currentBusinessDate) => {
  if (date > currentBusinessDate) return 'future'
  return hasCheckIn ? 'morning_recorded' : 'morning_missing'
}

export const buildAbsenceReport = ({ workers = [], attendance = [], mode = 'today', selectedDate, businessDate = selectedDate, teamId = '' }) => {
  const dates = mode === 'week' ? absenceWeekDates(selectedDate) : [selectedDate]
  const workersById = new Map()
  workers.forEach((worker) => {
    if (worker?.id && !workersById.has(String(worker.id))) workersById.set(String(worker.id), worker)
  })
  const rosterWorkers = [...workersById.values()].filter((worker) => (
    worker.is_active !== false
    && (worker.staff_classification || 'normal') === 'normal'
    && (!teamId || String(worker.team_id || '') === String(teamId))
  ))
  const recordedCheckIns = new Set(attendance
    .filter((row) => hasAttendanceCheckIn(row) && dates.includes(row.attendance_date))
    .map((row) => `${String(row.worker_id)}::${row.attendance_date}`))
  const groups = new Map()

  rosterWorkers.forEach((worker) => {
    const states = dates.map((date) => {
      const hasCheckIn = recordedCheckIns.has(`${String(worker.id)}::${date}`)
      return { date, state: stateFor(hasCheckIn, date, businessDate) }
    })
    const missingMorningDays = states.filter((item) => item.state === 'morning_missing').length
    if (!missingMorningDays) return
    const team = worker.team || null
    const key = String(worker.team_id || 'unassigned')
    const group = groups.get(key) || { id: key, name: worker.team_name || team?.name || '—', workers: [] }
    group.workers.push({ id: worker.id, name: worker.full_name || '—', employeeCode: worker.employee_code || null, states, missingMorningDays })
    groups.set(key, group)
  })

  const teamGroups = [...groups.values()]
    .map((group) => ({ ...group, workers: group.workers.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const missingMorningWorkerIds = new Set(teamGroups.flatMap((group) => group.workers.map((worker) => String(worker.id))))
  return {
    mode,
    dates,
    groups: teamGroups,
    missingMorningWorkers: missingMorningWorkerIds.size,
    missingMorningDays: teamGroups.reduce((total, group) => total + group.workers.reduce((sum, worker) => sum + worker.missingMorningDays, 0), 0),
  }
}
