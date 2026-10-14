import { isOperationalAttendanceTeam } from './activeWorkers.js'
import { buildAbsenceReport } from './absenceReport.js'
import { savedSupervisorResults } from './supervisorMorningReview.js'

export const supervisorSheetTeams = (teams = []) => (Array.isArray(teams) ? teams : [])
  .filter((team) => team?.id && team.is_active !== false && isOperationalAttendanceTeam(team))
  .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))

export const buildSupervisorSheet = ({ workers = [], attendance = [], mappings = [], date, teamId = '' } = {}) => {
  const saved = savedSupervisorResults(attendance, date)
  const report = buildAbsenceReport({ workers, attendance: attendance.filter((row) => !saved[String(row.worker_id)]), mappings, mode: 'today', selectedDate: date, businessDate: date, teamId })
  return { groups: report.groups, workerCount: report.missingMorningWorkers }
}
