import { isOperationalAttendanceTeam } from './activeWorkers.js'
import { buildAbsenceReport } from './absenceReport.js'
import { savedSupervisorResults } from './supervisorMorningReview.js'
import { biometricIdsByWorker } from './dailyOperationalReports.js'

export const supervisorSheetTeams = (teams = []) => (Array.isArray(teams) ? teams : [])
  .filter((team) => team?.id && team.is_active !== false && isOperationalAttendanceTeam(team))
  .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))

export const buildSupervisorSheet = ({ workers = [], attendance = [], mappings = [], date, teamId = '', exactPopulation = false, preserveFinalSheet = false } = {}) => {
  if (!preserveFinalSheet) {
    const outside = new Set(attendance.filter(row => row.attendance_date === date
      && row.attendance_source === 'outside_work' && row.status === 'present'
      && row.manual_override === false && row.biometric_sync_metadata?.outside_work?.movement_ids?.length > 0)
      .map(row => String(row.worker_id)))
    workers = workers.filter(worker => !outside.has(String(worker.id)))
  }
  if (exactPopulation) {
    const groups = new Map()
    const ids = biometricIdsByWorker(mappings)
    for (const worker of new Map(workers.map((item) => [String(item.id), item])).values()) {
      if (teamId && String(worker.team_id) !== String(teamId)) continue
      const key = String(worker.team_id || 'unassigned')
      const group = groups.get(key) || { id: key, name: worker.team_name || '—', workers: [] }
      group.workers.push({ id: worker.id, name: worker.full_name || '—', employeeCode: worker.employee_code,
        biometricId: worker.biometric_id ?? ids.get(String(worker.id)) ?? '—' })
      groups.set(key, group)
    }
    const sorted = [...groups.values()].map((group) => ({ ...group, workers: group.workers.sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.name.localeCompare(b.name))
    return { groups: sorted, workerCount: sorted.reduce((sum, group) => sum + group.workers.length, 0) }
  }
  const saved = savedSupervisorResults(attendance, date)
  const report = buildAbsenceReport({ workers, attendance: attendance.filter((row) => !saved[String(row.worker_id)]), mappings, mode: 'today', selectedDate: date, businessDate: date, teamId })
  return { groups: report.groups, workerCount: report.missingMorningWorkers }
}
