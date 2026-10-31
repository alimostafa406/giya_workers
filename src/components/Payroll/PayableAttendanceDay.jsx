import { payrollDayPresentation } from '../../utils/teamWeeklyReportDayOvertime'

// Shared by the operational payroll table and canonical team report. Both
// screen and print clone this same content; no clocks or totals are recalculated.
export default function PayableAttendanceDay({ line, date, statusText }) {
  const { status, duration } = payrollDayPresentation(line, date, statusText)
  return <><span>{status}</span>{duration && <> <bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{duration}</bdi></>}</>
}
