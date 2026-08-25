import { attendanceRosterCategory, mergeAttendanceRoster } from './attendanceRoster.js'

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const atNoon = (value) => new Date(`${value}T12:00:00`)

export const attendanceBusinessDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Kinshasa', year: 'numeric', month: '2-digit', day: '2-digit',
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

const stateFor = (row, date, businessDate) => {
  if (date > businessDate) return 'future'
  const category = attendanceRosterCategory(row)
  if (category === 'absent') return 'absent'
  if (category === 'present') return row.status === 'half_day' ? 'half_day' : 'present'
  if (category === 'review') return 'review'
  if (category === 'not_recorded') return 'not_recorded'
  return 'not_applicable'
}

export const buildAbsenceReport = ({ workers = [], attendance = [], mode = 'today', businessDate, teamId = '' }) => {
  const dates = mode === 'week' ? absenceWeekDates(businessDate) : [businessDate]
  const workersById = new Map()
  workers.forEach((worker) => {
    if (worker?.id && !workersById.has(String(worker.id))) workersById.set(String(worker.id), worker)
  })
  const rosterWorkers = [...workersById.values()].filter((worker) => (
    worker.is_active !== false
    && (worker.staff_classification || 'normal') === 'normal'
    && (!teamId || String(worker.team_id || '') === String(teamId))
  ))
  const dayRows = new Map(dates.map((date) => [date, mergeAttendanceRoster({
    workers: rosterWorkers, attendance, date, teamId, businessDate,
  })]))
  const groups = new Map()

  rosterWorkers.forEach((worker) => {
    const states = dates.map((date) => {
      const row = (dayRows.get(date) || []).find((item) => String(item.worker_id) === String(worker.id))
      return { date, state: stateFor(row || {}, date, businessDate) }
    })
    const absenceDays = states.filter((item) => item.state === 'absent').length
    if (!absenceDays) return
    const team = worker.team || null
    const key = String(worker.team_id || 'unassigned')
    const group = groups.get(key) || { id: key, name: worker.team_name || team?.name || '—', workers: [] }
    group.workers.push({ id: worker.id, name: worker.full_name || '—', employeeCode: worker.employee_code || null, states, absenceDays })
    groups.set(key, group)
  })

  const teamGroups = [...groups.values()]
    .map((group) => ({ ...group, workers: group.workers.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    mode,
    dates,
    groups: teamGroups,
    absentWorkers: teamGroups.reduce((total, group) => total + group.workers.length, 0),
    absenceDays: teamGroups.reduce((total, group) => total + group.workers.reduce((sum, worker) => sum + worker.absenceDays, 0), 0),
  }
}
