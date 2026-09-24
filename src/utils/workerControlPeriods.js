import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'

const isoDate = (date) => date.toISOString().slice(0, 10)

export const workerControlPeriods = (today) => {
  const monday = new Date(`${today}T12:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const saturday = new Date(monday)
  saturday.setUTCDate(saturday.getUTCDate() + 5)
  return { weekStart: isoDate(monday), weekEnd: isoDate(saturday), monthStart: `${today.slice(0, 7)}-01`, monthEnd: today }
}

// Use the existing operational eligibility and no-row-as-absence monitoring rule.
// Historical attendance is supplied in one bulk read, not queried per worker.
export const currentConsecutiveAbsenceDates = ({ worker, rowsByDate, today, monthStart }) => {
  const knownDates = [...rowsByDate.keys()].sort()
  const firstKnown = knownDates[0]
  const created = worker.created_at?.slice(0, 10)
  const firstEligible = worker.operational_start_date
    || (created && firstKnown ? (created < firstKnown ? created : firstKnown) : created || firstKnown || monthStart)
  const dates = []
  for (const day = new Date(`${today}T12:00:00Z`); isoDate(day) >= firstEligible; day.setUTCDate(day.getUTCDate() - 1)) {
    if (day.getUTCDay() === 0) continue
    const date = isoDate(day)
    if (!isOperationalAttendanceWorkerOnDate(worker, date)) break
    const row = rowsByDate.get(date)
    if (row && row.status !== 'absent') break
    dates.push(date)
  }
  return dates
}
