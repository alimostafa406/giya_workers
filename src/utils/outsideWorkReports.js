import { foremanKey, foremanOvertimeMinutes, isFinalOutsideWorkMovement } from './outsideWork.js'
import { outsideWorkOvertimeDays } from './outsideWorkPayableOvertime.js'

// Date-only operational dates are calendar values, not UTC instants. Reading
// the weekday at UTC noon avoids host-timezone shifts of YYYY-MM-DD strings.
export const isOutsideWorkSunday = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '')
  && new Date(`${date}T12:00:00Z`).getUTCDay() === 0

// Report selection only: reuse the existing overtime rule and persisted participants.
export function outsideWorkReport(rows, { from, to, status = 'final', type = 'comprehensive', selected = '', dayFilter = 'all', specificDates = [] }, workersById = new Map()) {
  const exact = new Set(specificDates)
  const movements = rows.filter(row => row.work_date >= from && row.work_date <= to
    && (status === 'all' || (status === 'final' ? isFinalOutsideWorkMovement(row) : row.status === 'draft')))
    .filter(row => exact.size ? exact.has(row.work_date) : dayFilter !== 'sundays' || isOutsideWorkSunday(row.work_date))
    .filter(row => type === 'comprehensive' || (selected && (
      (type === 'foreman' && foremanKey(row) === selected)
      || (type === 'worker' && (row.outside_work_movement_workers || []).some(w => String(w.worker_id) === selected))
      || (type === 'destination' && String(row.team_id) === selected)
      || (type === 'team' && (String(row.team_id) === selected || (row.outside_work_movement_workers || []).some(w => String(workersById.get(String(w.worker_id))?.team_id) === selected))))))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || String(a.start_time || '').localeCompare(String(b.start_time || '')) || String(a.id).localeCompare(String(b.id)))
    .map(row => ({ ...row, foremanOvertimeMinutes: foremanOvertimeMinutes(row.work_date, row.end_time),
      participants: (row.outside_work_movement_workers || []).filter(w => type !== 'worker' || String(w.worker_id) === selected)
        .map(w => ({ ...w, outsideWorkOvertimeMinutes: outsideWorkOvertimeDays({ id: w.worker_id }, [row.work_date], [row])[0].minutes })) }))
  const byDate = new Map()
  for (const row of movements) {
    if (!byDate.has(row.work_date)) byDate.set(row.work_date, [])
    byDate.get(row.work_date).push(row)
  }
  const groups = [...byDate].map(([date, movements]) => ({ date, movements }))
  const participants = movements.flatMap(row => row.participants)
  const workerOvertimeMinutes = [...new Set(participants.map(w => String(w.worker_id)))].reduce((sum, id) => sum
    + outsideWorkOvertimeDays({ id }, groups.map(g => g.date), movements).reduce((total, day) => total + day.minutes, 0), 0)
  return { rows: movements, groups, dayCount: groups.length, movementCount: movements.length,
    sundayCount: groups.filter(g => isOutsideWorkSunday(g.date)).length,
    workerDayCount: new Set(movements.flatMap(row => row.participants.map(w => `${w.worker_id}|${row.work_date}`))).size,
    workerOvertimeMinutes,
    participationCount: participants.length, workerCount: new Set(participants.map(w => w.worker_id)).size,
    totalOvertimeMinutes: movements.reduce((sum, row) => sum + row.foremanOvertimeMinutes, 0) }
}
