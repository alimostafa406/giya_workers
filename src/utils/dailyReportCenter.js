import { buildDailyAttendanceExceptions, buildDailyOvertimeReport } from './dailyOperationalReports.js'

const parseDate = (date) => new Date(`${date}T12:00:00Z`)
const dateKey = (date) => date.toISOString().slice(0, 10)

export const operationalWeekDates = (today) => {
  const monday = parseDate(today)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return Array.from({ length: 6 }, (_, index) => {
    const day = new Date(monday)
    day.setUTCDate(monday.getUTCDate() + index)
    return dateKey(day)
  })
}

export const adjacentOperationalDate = (date, direction) => {
  const day = parseDate(date)
  do { day.setUTCDate(day.getUTCDate() + (direction < 0 ? -1 : 1)) } while (day.getUTCDay() === 0)
  return dateKey(day)
}

export const dailyReportData = ({ date, workers = [], attendance = [], mappings = [], evidence = [] }) => {
  const dayAttendance = attendance.filter((row) => (row.attendance_date || row.date) === date)
  const exceptions = buildDailyAttendanceExceptions({ date, workers, attendance: dayAttendance, mappings, evidence })
  const overtime = buildDailyOvertimeReport({ date, attendance: dayAttendance, mappings })
  return {
    exceptions,
    overtime,
    counts: {
      exceptions: exceptions.length,
      absent: exceptions.filter((row) => row.status === 'absent').length,
      halfDay: exceptions.filter((row) => row.status === 'half_day').length,
      notRecorded: exceptions.filter((row) => row.isVirtual).length,
      overtimeWorkers: overtime.length,
      overtimeMinutes: overtime.reduce((total, row) => total + row.overtimeMinutes, 0),
    },
  }
}
