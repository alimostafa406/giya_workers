const amount = (value) => Number(value) || 0

export const monthlyPayrollTeamSummary = (groups = []) => {
  const currencies = new Set()
  const rows = groups.map((group, index) => {
    const byCurrency = {}
    group.lines.forEach((line) => {
      const currency = line.currency || line.term?.currency_code || 'CDF'
      currencies.add(currency)
      const current = byCurrency[currency] || { salary: 0, transport: 0, overtime: 0, deductions: 0, total: 0 }
      current.salary += amount(line.monthlySalary)
      current.transport += amount(line.transportAmount)
      current.overtime += amount(line.overtimeAmount)
      current.deductions += amount(line.absenceDeduction) + amount(line.halfDayDeduction) + amount(line.deductionAmount) + amount(line.advanceAmount)
      current.total += amount(line.finalAmount)
      byCurrency[currency] = current
    })
    return { index: index + 1, id: group.id, name: group.name, workers: group.lines.length, byCurrency }
  })
  const totals = rows.reduce((result, row) => {
    Object.entries(row.byCurrency).forEach(([currency, values]) => {
      const current = result.byCurrency[currency] || { salary: 0, transport: 0, overtime: 0, deductions: 0, total: 0 }
      Object.keys(current).forEach((key) => { current[key] += values[key] })
      result.byCurrency[currency] = current
    })
    result.workers += row.workers
    return result
  }, { workers: 0, byCurrency: {} })
  return { rows, totals, currencies: [...currencies].sort() }
}
