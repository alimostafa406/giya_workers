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
  ? `worker:${movement.foreman_worker_id}` : `name:${movement.foreman_name.trim().toLocaleLowerCase()}`

export const weeklyForemanReport = (movements, key, days) => {
  const rows = movements.filter((movement) => foremanKey(movement) === key && days.includes(movement.work_date))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.start_time.localeCompare(b.start_time))
  const totalMinutes = rows.reduce((sum, row) => sum + (durationMinutes(row.start_time, row.end_time) || 0), 0)
  const dayCount = new Set(rows.map((row) => row.work_date)).size
  return { rows, dayCount, movementCount: rows.length, totalMinutes,
    averageMinutes: dayCount ? totalMinutes / dayCount : 0 }
}
