import { formatPayrollMoney } from './payrollCurrency.js'
import { formatEveningOvertimeMinutes, weeklyPayrollDisplayStatus, weeklyPayrollOvertimeForLine } from './weeklyPayrollOvertime.js'

const escapeHtml = (value) => String(value ?? '—').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const money = (amount, line) => formatPayrollMoney(amount, { currency: line.currency, paymentType: 'weekly' })
const formattedTotals = (totals) => Object.entries(totals || {}).map(([currency, amount]) => formatPayrollMoney(amount, { currency, paymentType: 'weekly' })).join(' · ') || '—'
const dayLabel = (date, language) => new Intl.DateTimeFormat(language === 'ar' ? 'ar' : language === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'short' }).format(new Date(`${date}T12:00:00`))

export const buildWeeklyPayrollAllTeamsHtml = ({ title, periodStart, periodEnd, groups, overallTotalsByCurrency, dates, labels, language = 'ar', direction = 'rtl' }) => {
  const workDates = dates.filter((date) => new Date(`${date}T12:00:00Z`).getUTCDay() !== 0)
  const headers = [labels.worker, ...workDates.map((date) => dayLabel(date, language)), labels.workDayPay, labels.overtimeHours, labels.overtimeAmount, labels.transport, labels.total]
  const sections = groups.map((group) => {
    const rows = group.lines.map((line) => {
      const overtime = weeklyPayrollOvertimeForLine(line)
      const baseRateConfigured = line.term?.daily_rate !== '' && line.term?.daily_rate != null
      const rateConfigured = line.term?.overtime_rate_per_hour !== '' && line.term?.overtime_rate_per_hour != null
      const transportConfigured = line.term?.daily_transport_allowance != null && line.term.daily_transport_allowance !== ''
      const cells = [
        `<strong>${escapeHtml(line.worker.full_name)}</strong><small>${escapeHtml(line.worker.employee_code || '—')}</small>`,
        ...workDates.map((date) => {
          const detail = line.details?.find((item) => item.date === date)
          return escapeHtml(labels.status[weeklyPayrollDisplayStatus(detail)])
        }),
        escapeHtml(baseRateConfigured ? money(line.attendanceWage, line) : '—'),
        escapeHtml(formatEveningOvertimeMinutes(overtime.eveningOvertimeMinutes)),
        escapeHtml(rateConfigured && Number(line.overtimeHours) > 0 && line.overtimeAmount != null ? money(line.overtimeAmount, line) : '—'),
        escapeHtml(transportConfigured ? money(line.transportAmount, line) : '—'),
        escapeHtml(money(line.finalAmount, line)),
      ]
      return `<tr>${cells.map((cell, index) => `<td${index === cells.length - 1 ? ' class="final"' : ''}>${cell}</td>`).join('')}</tr>`
    }).join('')
    return `<section class="team"><header class="team-header"><h2>${escapeHtml(group.name)}</h2><p>${escapeHtml(labels.workers)}: ${group.lines.length} · ${escapeHtml(labels.teamTotal)}: <bdi dir="ltr">${escapeHtml(formattedTotals(group.amountDueByCurrency))}</bdi></p></header><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></section>`
  }).join('')
  return `<!doctype html><html lang="${escapeHtml(language)}" dir="${direction === 'ltr' ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{margin:0;color:#172033;font-family:Arial,Tahoma,sans-serif;font-size:10px}
    h1,h2,p{margin:0}.summary{padding:0 0 10px;border-bottom:2px solid #334155}.summary h1{font-size:18px}.summary dl{display:flex;flex-wrap:wrap;gap:18px;margin:8px 0 0}.summary dt{color:#475569;font-size:9px}.summary dd{margin:2px 0 0;font-weight:800}
    .team{margin-top:13px}.team+.team{break-before:page;page-break-before:always}.team-header{padding:6px 8px;background:#e2e8f0;break-after:avoid;page-break-after:avoid}.team-header h2{font-size:14px}.team-header p{margin-top:3px;font-weight:700}
    table{width:100%;border-collapse:collapse;margin-top:5px}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:5px 4px;text-align:start;vertical-align:middle;font-size:9px}th{background:#f1f5f9;font-weight:800}td small{display:block;color:#64748b}.final{font-weight:800}bdi{white-space:nowrap}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><main><header class="summary"><h1>${escapeHtml(title)}</h1><dl><div><dt>${escapeHtml(labels.period)}</dt><dd dir="ltr">${escapeHtml(periodStart)} → ${escapeHtml(periodEnd)}</dd></div><div><dt>${escapeHtml(labels.teams)}</dt><dd>${groups.length}</dd></div><div><dt>${escapeHtml(labels.workers)}</dt><dd>${groups.reduce((count, group) => count + group.lines.length, 0)}</dd></div><div><dt>${escapeHtml(labels.overallTotal)}</dt><dd><bdi dir="ltr">${escapeHtml(formattedTotals(overallTotalsByCurrency))}</bdi></dd></div></dl></header>${sections}</main></body></html>`
}

export const printAllWeeklyPayrollTeams = (options) => {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  printWindow.document.write(buildWeeklyPayrollAllTeamsHtml(options))
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
  return true
}
