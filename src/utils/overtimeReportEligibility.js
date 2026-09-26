// Report population only. Canonical overtime and payroll never consume this.
export const MINIMUM_REPORTABLE_OVERTIME_MINUTES = 120
export const isOvertimeReportEligible = ({ teamId, teamName, overtimeMinutes }, selectedTeamIds = []) => (
  teamName !== 'Chauffeur'
  && teamName !== 'Adminstration'
  && Boolean(teamId)
  && selectedTeamIds.map(String).includes(String(teamId))
  && Number.isFinite(Number(overtimeMinutes))
  && Number(overtimeMinutes) >= MINIMUM_REPORTABLE_OVERTIME_MINUTES
)
