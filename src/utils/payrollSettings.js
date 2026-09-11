const optionalNonNegativeAmount = (value, label) => {
  if (value === '' || value == null) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be a non-negative number.`)
  return amount
}

const hasValue = (value) => value !== '' && value != null

export const buildWorkerPayrollSettingsSavePlan = (worker, values, today) => {
  const effectiveFrom = values.effective_from || today
  const paymentType = values.payment_type
  const currencyCode = String(values.currency_code || '').trim().toUpperCase()

  if (!['weekly', 'monthly'].includes(paymentType)) {
    throw new Error('Payment type must be explicitly set to weekly or monthly.')
  }

  const monthlySalary = paymentType === 'monthly' ? optionalNonNegativeAmount(values.monthly_salary, 'Monthly salary') : null
  const dailyRate = paymentType === 'weekly' ? optionalNonNegativeAmount(values.daily_rate, 'Daily rate') : null
  const dailyTransportAllowance = optionalNonNegativeAmount(values.daily_transport_allowance, 'Transport allowance')
  const overtimeRate = optionalNonNegativeAmount(values.overtime_rate_per_hour, 'Overtime rate')

  if (effectiveFrom < today) {
    throw new Error('Effective date cannot be in the past.')
  }
  if (worker.payment_type && paymentType !== worker.payment_type && effectiveFrom !== today) {
    throw new Error('A payment-type change must take effect today so the worker profile and active compensation stay consistent.')
  }

  const hasCompensationInput = [
    paymentType === 'weekly' ? values.daily_rate : values.monthly_salary,
    values.daily_transport_allowance,
    values.overtime_rate_per_hour,
    values.overtime_start_time,
    paymentType === 'monthly' ? values.monthly_payroll_cycle_start_date : null,
  ].some(hasValue)
  const saveCompensation = values.save_compensation !== false && hasCompensationInput

  if (saveCompensation && !['CDF', 'USD'].includes(currencyCode)) {
    throw new Error('Currency must be explicitly set to CDF or USD when compensation details are saved.')
  }

  return {
    profilePayload: {
      payment_type: paymentType,
      monthly_salary: paymentType === 'monthly' ? monthlySalary : null,
    },
    compensationPayload: saveCompensation ? {
      worker_id: worker.id,
      payment_type: paymentType,
      effective_from: effectiveFrom,
      currency_code: currencyCode,
      daily_rate: paymentType === 'weekly' ? dailyRate : null,
      daily_transport_allowance: dailyTransportAllowance ?? 0,
      overtime_rate_per_hour: overtimeRate,
      overtime_start_time: values.overtime_start_time || null,
      monthly_salary: paymentType === 'monthly' ? monthlySalary : null,
      monthly_payroll_cycle_start_date: paymentType === 'monthly' ? values.monthly_payroll_cycle_start_date || null : null,
    } : null,
  }
}
