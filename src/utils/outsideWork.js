export const weekDays = (anchor) => {
  const date = new Date(`${anchor}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return []
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(date)
    day.setUTCDate(date.getUTCDate() + offset)
    return day.toISOString().slice(0, 10)
  })
}

export const durationMinutes = (start, end) => {
  const read = (value) => {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
    return Number(match[1]) * 60 + Number(match[2])
  }
  const first = read(start)
  const last = read(end)
  return first == null || last == null || last <= first ? null : last - first
}

export const formatDuration = (minutes) => minutes == null ? '—' : `${Number((minutes / 60).toFixed(2))} h`

export const formatClock = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return '—'
  const hour = Number(match[1])
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`
}

export const foremanKey = (movement) => movement.foreman_worker_id
  ? `worker:${movement.foreman_worker_id}` : `name:${String(movement.foreman_name || '').trim().toLocaleLowerCase()}`

export const isFinalOutsideWorkMovement = (movement) => (movement.status || 'final') === 'final'

export const weeklyForemanReport = (movements, key, days) => {
  const rows = movements.filter((movement) => isFinalOutsideWorkMovement(movement)
    && foremanKey(movement) === key && days.includes(movement.work_date))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.start_time.localeCompare(b.start_time))
  const totalMinutes = rows.reduce((sum, row) => sum + (durationMinutes(row.start_time, row.end_time) || 0), 0)
  const dayCount = new Set(rows.map((row) => row.work_date)).size
  return { rows, dayCount, movementCount: rows.length, totalMinutes,
    averageMinutes: dayCount ? totalMinutes / dayCount : 0 }
}

const timeInput = (value) => String(value || '').slice(0, 5)

export const outsideWorkForm = (movement = {}, date = '') => ({
  id: movement.id || null, work_date: movement.work_date ?? date, team_id: movement.team_id || '',
  status: movement.status || 'draft', foreman_worker_id: movement.foreman_worker_id || '',
  foreman_name: movement.foreman_name || '', start_time: timeInput(movement.start_time),
  end_time: timeInput(movement.end_time), note: movement.note || '',
  common_worker_start: timeInput(movement.common_worker_start), common_worker_end: timeInput(movement.common_worker_end),
  missing_worker_note: movement.missing_worker_note || '', entry_state: movement.entry_state || {},
  workers: (movement.outside_work_movement_workers || movement.workers || []).map((row) => ({
    worker_id: row.worker_id, worker_name: row.worker_name,
    start_time: timeInput(row.start_time), end_time: timeInput(row.end_time),
  })),
})

export const outsideWorkFinalError = (form) => {
  if (!form.work_date || !form.team_id) return 'required'
  if (!String(form.foreman_name || '').trim()) return 'selectForemanError'
  if (String(form.missing_worker_note || '').trim()) return 'unresolved'
  if (!form.workers.length) return 'selectWorkers'
  if (durationMinutes(form.start_time, form.end_time) == null
    || form.workers.some((row) => durationMinutes(row.start_time, row.end_time) == null)) return 'invalid'
  return ''
}

export const outsideWorkDefaultTimes = (date) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return Number.isNaN(day) || day === 0 ? { start: '', end: '' }
    : { start: '08:00', end: day === 6 ? '14:00' : '17:00' }
}

const timeFields = ['start_time', 'end_time', 'common_worker_start', 'common_worker_end']
const timeWasEdited = (form, field) => form.entry_state?.manual_times?.[field]
  ?? Boolean(form.id && form[field])

export const newOutsideWorkForm = (date) => {
  const defaults = outsideWorkDefaultTimes(date)
  return { ...outsideWorkForm({}, date), start_time: defaults.start, end_time: defaults.end,
    common_worker_start: defaults.start, common_worker_end: defaults.end,
    entry_state: { manual_times: Object.fromEntries(timeFields.map((field) => [field, false])) } }
}

const applyCommonTime = (form, field, next) => ({ ...form, [field]: next,
  workers: form.workers.map((row) => {
    const key = field === 'common_worker_start' ? 'start_time' : 'end_time'
    const override = form.entry_state?.overrides?.[row.worker_id]?.[key]
      || (row[key] && row[key] !== form[field])
    return override ? row : { ...row, [key]: next }
  }) })

export const editOutsideWorkTime = (form, field, next) => ({
  ...(field.startsWith('common_worker_') ? applyCommonTime(form, field, next) : { ...form, [field]: next }),
  entry_state: { ...form.entry_state, manual_times: { ...form.entry_state?.manual_times, [field]: true } },
})

export const changeOutsideWorkDate = (form, date) => {
  const defaults = outsideWorkDefaultTimes(date)
  let next = { ...form, work_date: date }
  for (const field of timeFields) {
    if (timeWasEdited(form, field)) continue
    const value = field === 'start_time' || field === 'common_worker_start' ? defaults.start : defaults.end
    next = field.startsWith('common_worker_') ? applyCommonTime(next, field, value) : { ...next, [field]: value }
  }
  return next
}
