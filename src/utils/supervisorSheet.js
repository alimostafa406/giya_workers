import { isOperationalAttendanceTeam, isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'
import { biometricIdsByWorker } from './dailyOperationalReports.js'

export const supervisorSheetTeams = (teams = []) => (Array.isArray(teams) ? teams : [])
  .filter((team) => team?.id && team.is_active !== false && isOperationalAttendanceTeam(team))
  .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))

export const buildSupervisorSheet = ({ workers = [], teams = [], mappings = [], date, teamId = '' } = {}) => {
  const availableTeams = supervisorSheetTeams(teams)
  const teamsById = new Map(availableTeams.map((team) => [String(team.id), team]))
  const biometricIds = biometricIdsByWorker(mappings)
  const rowsByTeam = new Map(availableTeams.map((team) => [String(team.id), []]))
  const seenWorkerIds = new Set()

  for (const worker of Array.isArray(workers) ? workers : []) {
    const workerId = String(worker?.id || '')
    const workerTeamId = String(worker?.team_id || '')
    const team = teamsById.get(workerTeamId)
    if (!workerId || seenWorkerIds.has(workerId) || !team || (teamId && workerTeamId !== String(teamId))) continue
    if ((worker.staff_classification || 'normal') !== 'normal' || !isOperationalAttendanceWorkerOnDate(worker, date, team)) continue
    seenWorkerIds.add(workerId)
    rowsByTeam.get(workerTeamId).push({
      id: workerId,
      name: worker.full_name || '—',
      employeeCode: worker.employee_code || '—',
      biometricId: biometricIds.get(workerId) || '—',
    })
  }

  const groups = availableTeams
    .filter((team) => !teamId || String(team.id) === String(teamId))
    .map((team) => ({ id: String(team.id), name: team.name, workers: rowsByTeam.get(String(team.id))
      .sort((left, right) => left.name.localeCompare(right.name)) }))
  return { groups, workerCount: groups.reduce((count, group) => count + group.workers.length, 0) }
}
