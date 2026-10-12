import { isOperationalAttendanceTeam } from './activeWorkers.js'
import { buildAbsenceReport } from './absenceReport.js'

export const supervisorSheetTeams = (teams = []) => (Array.isArray(teams) ? teams : [])
  .filter((team) => team?.id && team.is_active !== false && isOperationalAttendanceTeam(team))
  .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))

export const buildSupervisorSheet = ({ workers = [], attendance = [], mappings = [], date, teamId = '' } = {}) => {
  const report = buildAbsenceReport({ workers, attendance, mappings, mode: 'today', selectedDate: date, businessDate: date, teamId })
  return { groups: report.groups, workerCount: report.missingMorningWorkers }
}
