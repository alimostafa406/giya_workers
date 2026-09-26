import { dailyReportData, operationalWeekDates } from './dailyReportCenter.js'

export const REPORT_TYPES = ['daily_attendance', 'daily_overtime']

// Publish only display fields; never leak raw metadata, payroll profiles or phones.
export const buildReportPublicationDays = (source) => operationalWeekDates(source.business_date)
  .filter(date => source.available_dates.includes(date))
  .map(date => {
    const report = dailyReportData({ date, businessDate: source.business_date,
      workers: source.workers, attendance: source.attendance, mappings: source.mappings,
      evidence: source.evidence, overtimeTeamIds: source.overtime_team_ids })
    const attendance = report.monitoringRows.map(row => ({
      worker_id: row.workerId, worker_name: row.workerName, employee_code: row.employeeCode,
      biometric_id: row.biometricId, team_id: row.worker.team_id, team_name: row.teamName,
      status: row.bucket, check_in: row.check_in || null, check_out: row.check_out || null,
      last_punch: row.lastPunch === '—' ? null : row.lastPunch,
    }))
    const overtime = report.overtime.map(row => {
      const worker = report.monitoringRows.find(item => item.id === row.id)
      return { worker_id: worker.workerId, worker_name: row.worker, biometric_id: row.biometricId,
        employee_code: worker.employeeCode, team_id: row.teamId, team_name: row.team,
        check_in: row.checkIn === '—' ? null : row.checkIn,
        check_out: row.checkOut === '—' ? null : row.checkOut, overtime_minutes: row.overtimeMinutes }
    })
    return { date, attendance, overtime }
  })
