// Read-only presentation scope. A FINAL participant/date needs no supervisor action.
// Keep the original conflict records available as historical audit evidence.
export function outsideWorkAttendanceWarnings(conflicts = [], movements = [], date = '') {
 const finalDays = new Set()
 for (const movement of movements) {
  if (movement.status !== 'final') continue
  for (const worker of movement.outside_work_movement_workers || []) {
   finalDays.add(JSON.stringify([String(worker.worker_id), movement.work_date]))
  }
 }
 const result = { unresolved: [], history: [] }
 for (const row of conflicts) {
  if (date && row.attendance_date !== date) continue
  const key = JSON.stringify([String(row.worker_id), row.attendance_date])
  result[finalDays.has(key) ? 'history' : 'unresolved'].push(row)
 }
 return result
}
