export const isActiveWorker = (worker) => worker?.is_active === true

export const OPERATIONAL_ATTENDANCE_EXCLUDED_TEAM = 'Adminstration'

export const isOperationalAttendanceTeam = (team) => {
  const name = typeof team === 'string' ? team : team?.name
  return name !== OPERATIONAL_ATTENDANCE_EXCLUDED_TEAM
}

export const isOperationalAttendanceWorker = (worker, team = null) => {
  const suppliedTeamName = typeof team === 'string' ? team : team?.name
  const workerTeamName = typeof worker?.team === 'string' ? worker.team : worker?.team?.name
  const teamName = suppliedTeamName ?? workerTeamName ?? worker?.team_name
  return isActiveWorker(worker) && isOperationalAttendanceTeam(teamName)
}

export const activeWorkersOnly = (workers = []) => (
  (Array.isArray(workers) ? workers : []).filter(isActiveWorker)
)
