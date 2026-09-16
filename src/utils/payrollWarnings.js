const missing = (value) => value === '' || value == null || !Number.isFinite(Number(value))

export const payrollConfigurationWarnings = (lines = [], paymentType) => (
  (Array.isArray(lines) ? lines : []).flatMap((line) => {
    const worker = line?.worker || {}
    const term = line?.term || {}
    const warnings = []
    const add = (field) => warnings.push({
      workerId: worker.id,
      workerName: worker.full_name || '-',
      employeeCode: worker.employee_code || '',
      teamName: worker.team_name || '',
      field,
    })

    if (paymentType === 'weekly' && missing(term.daily_rate)) add('dailyRate')
    if (paymentType === 'monthly' && missing(term.monthly_salary)) add('monthlySalary')
    if (missing(term.daily_transport_allowance)) add('transport')
    const eveningMinutes = Number(line.eveningOvertimeMinutes ?? line.calculation_snapshot?.evening_overtime_minutes ?? 0)
    if (eveningMinutes > 0 && missing(term.overtime_rate_per_hour)) add('overtimeRate')
    return warnings
  })
)
