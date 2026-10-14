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
export const hasOutsideWorkForeman = (movement) => Boolean(movement.foreman_worker_id || String(movement.foreman_name || '').trim())

// Outside-work reporting only; not the attendance/payroll overtime engine.
export const foremanOvertimeMinutes = (date, end) => {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  if (Number.isNaN(weekday) || weekday === 0) return 0
  return durationMinutes(weekday === 6 ? '14:00' : '17:00', end) || 0
}

export const weeklyForemanReport = (movements, key, days) => {
  const rows = movements.filter((movement) => isFinalOutsideWorkMovement(movement) && hasOutsideWorkForeman(movement)
    && foremanKey(movement) === key && days.includes(movement.work_date))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || String(a.start_time || '').localeCompare(String(b.start_time || '')))
    .map((row) => ({ ...row, foremanOvertimeMinutes: foremanOvertimeMinutes(row.work_date, row.end_time) }))
  const totalOvertimeMinutes = rows.reduce((sum, row) => sum + row.foremanOvertimeMinutes, 0)
  const dayCount = new Set(rows.map((row) => row.work_date)).size
  return { rows, dayCount, movementCount: rows.length, totalOvertimeMinutes }
}

const timeInput = (value) => String(value || '').slice(0, 5)
const savedWorkerTime = (movement, field, common) => {
  if (movement[common] != null && movement[common] !== '') return timeInput(movement[common])
  const values = [...new Set((movement.outside_work_movement_workers || movement.workers || []).map((row) => timeInput(row[field])))]
  return values.length === 1 ? values[0] : ''
}

export const outsideWorkForm = (movement = {}, date = '') => ({
  id: movement.id || null, work_date: movement.work_date ?? date, team_id: movement.team_id || '',
  status: movement.status || 'draft', foreman_worker_id: movement.foreman_worker_id || '',
  foreman_name: movement.foreman_name || '', start_time: timeInput(movement.start_time),
  end_time: timeInput(movement.end_time), note: movement.note || '',
  common_worker_start: savedWorkerTime(movement, 'start_time', 'common_worker_start'), common_worker_end: savedWorkerTime(movement, 'end_time', 'common_worker_end'),
  missing_worker_note: movement.missing_worker_note || '', entry_state: movement.entry_state || {},
  workers: (movement.outside_work_movement_workers || movement.workers || []).map((row) => ({
    worker_id: row.worker_id, worker_name: row.worker_name,
    start_time: timeInput(row.start_time), end_time: timeInput(row.end_time),
  })),
})

export const outsideWorkFinalError = (form) => {
  if (!form.work_date || !form.team_id) return 'required'
  if (form.entry_state?.time_model === 'shared' && !form.foreman_worker_id) return 'selectForemanError'
  if (hasOutsideWorkForeman(form) && durationMinutes(form.start_time, form.end_time) == null) return 'invalid'
  if (!form.workers.length) return 'selectWorkers'
  if (form.workers.some((row) => durationMinutes(row.start_time, row.end_time) == null)) return 'invalid'
  return ''
}

export const outsideWorkDefaultTimes = (date) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return Number.isNaN(day) || day === 0 ? { start: '', end: '' }
    : { start: '08:00', end: day === 6 ? '14:00' : '17:00' }
}

export const newOutsideWorkForm = (date) => {
  const defaults = outsideWorkDefaultTimes(date)
  return { ...outsideWorkForm({}, date), start_time: defaults.start, end_time: defaults.end,
    common_worker_start: defaults.start, common_worker_end: defaults.end,
    entry_state: { time_model: 'shared', manual_times: { start_time: false, end_time: false,
      common_worker_start: false, common_worker_end: false } } }
}

export const addOutsideWorkWorkers = (form, workers) => {
  const ids = new Set(form.workers.map((row) => String(row.worker_id)))
  const added = []
  const overrides = { ...form.entry_state?.overrides }
  for (const worker of workers) {
    if (ids.has(String(worker.id))) continue
    ids.add(String(worker.id))
    added.push({ worker_id: worker.id, worker_name: worker.full_name, start_time: form.common_worker_start, end_time: form.common_worker_end })
    overrides[worker.id] = { start_time: false, end_time: false }
  }
  return { ...form, workers: [...form.workers, ...added], entry_state: { ...form.entry_state, overrides } }
}

export const editOutsideWorkTime = (form, field, next) => ({
  ...form, [field]: next,
  workers: field.startsWith('common_worker_') ? form.workers.map((row) => ({ ...row,
    [field === 'common_worker_start' ? 'start_time' : 'end_time']: next })) : form.workers,
  entry_state: { ...form.entry_state, manual_times: { ...form.entry_state?.manual_times, [field]: true } },
})

export const changeOutsideWorkDate = (form, date) => {
  const defaults = outsideWorkDefaultTimes(date)
  let next = { ...form, work_date: date }
  for (const field of ['start_time', 'end_time', 'common_worker_start', 'common_worker_end']) {
    const workerField = field === 'common_worker_start' ? 'start_time' : 'end_time'
    if (form.id && field.startsWith('common_worker_') && form.workers.some((row) => row[workerField] !== form[field])) continue
    const edited = form.entry_state?.manual_times?.[field] ?? Boolean(form.id)
    if (edited) continue
    const time = field === 'start_time' || field === 'common_worker_start' ? defaults.start : defaults.end
    const manual = next.entry_state.manual_times
    next = editOutsideWorkTime(next, field, time)
    next.entry_state = { ...next.entry_state, manual_times: manual }
  }
  return next
}
