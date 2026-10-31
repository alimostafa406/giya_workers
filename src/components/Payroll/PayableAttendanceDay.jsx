import { weeklyPayrollDisplayStatus } from '../../utils/weeklyPayrollOvertime'
import { formatTeamReportDayOvertime, isOutsideWorkReportDay, teamReportDayOvertime } from '../../utils/teamWeeklyReportDayOvertime'

// Shared by the operational payroll table and canonical team report. Both
// screen and print clone this same content; no clocks or totals are recalculated.
export default function PayableAttendanceDay({ line, date, statusText, outsideWorkAsPresent = false }) {
  const detail = line.details?.find(detail => detail.date === date)
  const day = line.payableOvertimeDays?.find(day => day.date === date)
  const outside = weeklyPayrollDisplayStatus(detail) === 'present' && isOutsideWorkReportDay(detail, day)
  const duration = formatTeamReportDayOvertime(teamReportDayOvertime(line, date))
  return <><span>{outside && !outsideWorkAsPresent ? 'O' : statusText}</span>{duration && <> <bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{duration}</bdi></>}</>
}
