import { mergeAttendanceRoster } from './attendanceRoster.js'

const MORNING_START_MINUTES = 7 * 60
const MORNING_END_MINUTES = 9 * 60
const BUSINESS_TIME_ZONE = 'Africa/Kinshasa'

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const atNoon = (value) => new Date(`${value}T12:00:00`)

const metadataFor = (row) => {
  if (!row?.biometric_sync_metadata) return null
  if (typeof row.biometric_sync_metadata !== 'string') return row.biometric_sync_metadata
  try { return JSON.parse(row.biometric_sync_metadata) } catch { return null }
}

const timeMinutes = (value) => {
  const match = String(value || '').match(/(?:T|^)(\d{2}):(\d{2})/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

const eventMinutes = (value) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return timeMinutes(value)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(parsed)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null
}

const withinMorningWindow = (minutes) => (
  minutes !== null && minutes >= MORNING_START_MINUTES && minutes <= MORNING_END_MINUTES
)

export const hasValidMorningBiometricPunch = (row = {}) => {
  const metadata = metadataFor(row)
  const observedEvent = metadata?.check_in_event_timestamp
  if (observedEvent && withinMorningWindow(eventMinutes(observedEvent))) return true

  // The Hikvision resolver writes check_in only for a 07:00-09:00 event. The
  // source guard prevents manual attendance from masquerading as biometrics.
  return row.attendance_source === 'biometric' && withinMorningWindow(timeMinutes(row.check_in))
}

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

const stateFor = (row, date, businessDate) => {
  if (date > businessDate) return 'future'
  return hasValidMorningBiometricPunch(row) ? 'morning_recorded' : 'morning_missing'
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
  return {
    mode,
    dates,
    groups: teamGroups,
    missingMorningWorkers: teamGroups.reduce((total, group) => total + group.workers.length, 0),
    missingMorningDays: teamGroups.reduce((total, group) => total + group.workers.reduce((sum, worker) => sum + worker.missingMorningDays, 0), 0),
  }
}
