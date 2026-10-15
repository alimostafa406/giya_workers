import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'
import { eligibleTeamForemen } from './teamForeman.js'

const byName = (a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''))

export const outsideWorkForemen = eligibleTeamForemen

export const outsideWorkEligibleWorkers = (workers = [], date = '') => workers
  .filter((worker) => isOperationalAttendanceWorkerOnDate(worker, date))
  .sort(byName)

export const searchOutsideWorkPeople = (workers = [], query = '', biometricIds = new Map()) => {
  const term = String(query).trim().toLocaleLowerCase()
  if (!term) return []
  return workers.filter((worker) => String(worker.full_name || '').toLocaleLowerCase().includes(term)
    || String(worker.employee_code || '').toLocaleLowerCase().includes(term)
    || String(biometricIds.get(String(worker.id)) || '').toLocaleLowerCase().includes(term))
}

export const outsideWorkTeamWorkers = (workers, date, teamId) => !teamId ? []
  : outsideWorkEligibleWorkers(workers, date).filter((worker) => String(worker.team_id) === String(teamId))

export const outsideWorkOtherWorkers = (workers, date, teamId, query, biometricIds) =>
  searchOutsideWorkPeople(outsideWorkEligibleWorkers(workers, date)
    .filter((worker) => !teamId || String(worker.team_id) !== String(teamId)), query, biometricIds)
