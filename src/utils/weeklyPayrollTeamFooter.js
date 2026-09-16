import { weeklyPayrollOvertimeForLine } from './weeklyPayrollOvertime.js'

const amount = (value) => Number(value) || 0

export const weeklyPayrollTeamFooter = (lines = []) => {
  const byCurrency = {}
  let eveningOvertimeMinutes = 0

  lines.forEach((line) => {
    eveningOvertimeMinutes += weeklyPayrollOvertimeForLine(line).eveningOvertimeMinutes
    const currency = line.currency || line.term?.currency_code || 'CDF'
    const current = byCurrency[currency] || { transport: 0, overtimePay: 0, payrollTotal: 0 }
    current.transport += amount(line.transportAmount)
    current.overtimePay += amount(line.overtimeAmount)
    current.payrollTotal += amount(line.finalAmount)
    byCurrency[currency] = current
  })

  return { eveningOvertimeMinutes, byCurrency, currencies: Object.keys(byCurrency).sort() }
}

export const positiveWeeklyPayrollFooterAmounts = (footer, key) => (
  footer.currencies
    .map((currency) => [currency, Number(footer.byCurrency[currency]?.[key]) || 0])
    .filter(([, value]) => value > 0)
)
