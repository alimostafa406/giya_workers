import { foremanKey, foremanOvertimeMinutes, isFinalOutsideWorkMovement } from './outsideWork.js'

// Report selection only: reuse the existing overtime rule and persisted participants.
export function outsideWorkReport(rows, { from, to, status = 'final', type = 'comprehensive', selected = '' }, workersById = new Map()) {
  const movements = rows.filter(row => row.work_date >= from && row.work_date <= to
    && (status === 'all' || (status === 'final' ? isFinalOutsideWorkMovement(row) : row.status === 'draft')))
    .filter(row => type === 'comprehensive' || (selected && (
      (type === 'foreman' && foremanKey(row) === selected)
      || (type === 'worker' && (row.outside_work_movement_workers || []).some(w => String(w.worker_id) === selected))
      || (type === 'team' && (String(row.team_id) === selected || (row.outside_work_movement_workers || []).some(w => String(workersById.get(String(w.worker_id))?.team_id) === selected))))))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || String(a.start_time || '').localeCompare(String(b.start_time || '')) || String(a.id).localeCompare(String(b.id)))
    .map(row => ({ ...row, foremanOvertimeMinutes: foremanOvertimeMinutes(row.work_date, row.end_time),
      participants: (row.outside_work_movement_workers || []).filter(w => type !== 'worker' || String(w.worker_id) === selected) }))
  const byDate = new Map()
  for (const row of movements) {
    if (!byDate.has(row.work_date)) byDate.set(row.work_date, [])
    byDate.get(row.work_date).push(row)
  }
  const groups = [...byDate].map(([date, movements]) => ({ date, movements }))
  const participants = movements.flatMap(row => row.participants)
  return { rows: movements, groups, dayCount: groups.length, movementCount: movements.length,
    participationCount: participants.length, workerCount: new Set(participants.map(w => w.worker_id)).size,
    totalOvertimeMinutes: movements.reduce((sum, row) => sum + row.foremanOvertimeMinutes, 0) }
}
