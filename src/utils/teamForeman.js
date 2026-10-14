import { isSpecialStaffWorker } from './workerTeamEligibility.js'

export const eligibleTeamForemen = (workers = []) => workers
  .filter((worker) => worker.is_active === true && isSpecialStaffWorker(worker))
  .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))

export const resolveTeamForeman = (team, workers = []) => eligibleTeamForemen(workers)
  .find((worker) => String(worker.id) === String(team?.foreman_worker_id || '')) || null

export const selectOutsideWorkTeam = (current, teamId, teams, workers) => {
  const foreman = resolveTeamForeman(teams.find((team) => String(team.id) === String(teamId)), workers)
  return { ...current, team_id: teamId, foreman_worker_id: foreman?.id || '',
    foreman_name: foreman?.full_name || '',
    entry_state: { ...current.entry_state, teamSearch: '', otherSearch: '', foremanSearch: '' } }
}

export const teamForemanLabels = {
  ar: { title: 'معلم الفريق', none: 'لا يوجد معلم مرتبط بهذا الفريق' },
  en: { title: 'Team Foreman', none: 'No foreman is linked to this team' },
  fr: { title: 'Chef d’équipe', none: 'Aucun chef n’est associé à cette équipe' },
}
