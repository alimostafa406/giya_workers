const clock = (value) => String(value || '').slice(0, 8)

// Review must compare attendance evidence, not just monetary totals: a changed
// checkout can change overtime hours even when the hourly rate is missing.
export const staleWeeklyPayrollWorkerIds = (storedLines = [], canonicalLines = []) => {
  const savedByWorker = new Map(storedLines.map(line => [String(line.worker?.id), line]))
  return canonicalLines.filter(line => {
    const saved = savedByWorker.get(String(line.worker?.id))
    if (!saved || saved.details?.length !== line.details?.length) return true
    if (Number(saved.eveningOvertimeMinutes || 0) !== Number(line.eveningOvertimeMinutes || 0)) return true
    const days = new Map(saved.details.map(detail => [detail.date, detail]))
    return line.details.some(detail => {
      const old = days.get(detail.date)
      return !old || old.status !== detail.status
        || clock(old.row?.check_in) !== clock(detail.row?.check_in)
        || clock(old.row?.check_out) !== clock(detail.row?.check_out)
    })
  }).map(line => String(line.worker.id))
}
