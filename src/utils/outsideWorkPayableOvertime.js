import { durationMinutes, foremanOvertimeMinutes, outsideWorkDefaultTimes } from './outsideWork.js'

// One worker/date contribution: merge overlapping intervals across movements
// (including a worker also recorded as foreman), never pay the same minute twice.
export function outsideWorkOvertimeDays(worker, dates, movements = []) {
  const byDate = new Map()
  for (const movement of movements) {
    if (movement.status !== 'final' || !dates.includes(movement.work_date)) continue
    const participant = (movement.outside_work_movement_workers || []).find((p) => String(p.worker_id) === String(worker.id))
    const ranges = []
    if (participant) ranges.push({ start: participant.start_time ?? movement.common_worker_start,
      end: participant.end_time ?? movement.common_worker_end, foreman: false })
    if (String(movement.foreman_worker_id) === String(worker.id)) ranges.push({ start: movement.start_time, end: movement.end_time, foreman: true })
    for (const range of ranges) {
      if (durationMinutes(range.start, range.end) == null) continue
      const normalEnd = outsideWorkDefaultTimes(movement.work_date, { foreman: range.foreman }).end
      const minutes = range.foreman ? foremanOvertimeMinutes(movement.work_date, range.end) : durationMinutes(normalEnd, range.end) || 0
      if (!minutes) continue
      const end = Number(String(range.end).slice(0, 2)) * 60 + Number(String(range.end).slice(3, 5))
      const start = range.foreman ? end - minutes : Math.max(end - minutes, Number(String(range.start).slice(0, 2)) * 60 + Number(String(range.start).slice(3, 5)))
      const entries = byDate.get(movement.work_date) || []
      entries.push({ start, end, movement_id: movement.id })
      byDate.set(movement.work_date, entries)
    }
  }
  return dates.map((date) => {
    const ranges = (byDate.get(date) || []).sort((a, b) => a.start - b.start)
    let minutes = 0, previousEnd = -1
    for (const range of ranges) { minutes += Math.max(0, range.end - Math.max(range.start, previousEnd)); previousEnd = Math.max(previousEnd, range.end) }
    return { date, minutes, movement_ids: [...new Set(ranges.map((r) => r.movement_id))] }
  })
}
