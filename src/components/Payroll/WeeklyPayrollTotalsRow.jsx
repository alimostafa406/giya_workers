import { useTranslation } from '../../i18n/LanguageContext'
import { weeklyPayrollTeamFooter } from '../../utils/weeklyPayrollTeamFooter'
import { formatEveningOvertimeMinutes } from '../../utils/weeklyPayrollOvertime'
import { formatPayrollMoney } from '../../utils/payrollCurrency'

export default function WeeklyPayrollTotalsRow({ lines, dayCount }) {
  const { t, language } = useTranslation()
  const footer = weeklyPayrollTeamFooter(lines)
  const wageByCurrency = {}
  lines.forEach(line=>{
    const currency=line.currency || line.term?.currency_code || 'CDF'
    wageByCurrency[currency]=(wageByCurrency[currency] || 0)+(Number(line.attendanceWage) || 0)
  })
  const money = (field) => footer.currencies.map(currency=><span key={currency} className="block whitespace-nowrap" dir="ltr">{formatPayrollMoney(field==='wages' ? wageByCurrency[currency] : footer.byCurrency[currency][field],{currency,paymentType:'weekly'})}</span>)
  const count = (key) => lines.reduce((sum,line)=>sum+(Number(line[key]) || 0),0)
  return <tfoot className="bg-slate-100 font-extrabold print:table-row-group"><tr data-weekly-team-total className="border-t-2 border-slate-400 break-inside-avoid">
    <th scope="row" colSpan={dayCount+1} className="px-3 py-3 text-start">
      {{ar:'إجمالي الفرقة',en:'Team total',fr:'Total de l’équipe'}[language] || 'Team total'}
      <span className="mt-1 block text-xs font-medium">{t('payroll.workers')}: {lines.length} · {t('payroll.presentDays')}: {count('presentDays')} · {t('payroll.halfDays')}: {count('halfDays')} · {t('payroll.absentDays')}: {count('absentDays')}</span>
    </th>
    <td className="px-2 py-3 text-center" data-total="wages">{money('wages')}</td>
    <td className="px-2 py-3 text-center" dir="ltr" data-total="overtime-hours">{formatEveningOvertimeMinutes(footer.eveningOvertimeMinutes)}</td>
    <td className="px-2 py-3 text-center" data-total="overtime-amount">{money('overtimePay')}</td>
    <td className="px-2 py-3 text-center" data-total="transport">{money('transport')}</td>
    <td className="px-2 py-3 text-center" data-total="payable">{money('payrollTotal')}</td>
  </tr></tfoot>
}
