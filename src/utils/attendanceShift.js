export const isDayAttendanceShift = (worker = {}) => (worker.attendance_shift ?? 'day') === 'day'
export const attendanceShiftLabels = {
  ar: { title: 'نوع الدوام', day: 'نهاري', night: 'ليلي' },
  en: { title: 'Attendance shift', day: 'Day', night: 'Night' },
  fr: { title: 'Horaire de présence', day: 'Jour', night: 'Nuit' },
}
