import { useMemo } from 'react'
import { useTranslation } from '../../i18n/LanguageContext'
import { formatPayrollMoney } from '../../utils/payrollCurrency'
import { weeklyPayrollTeamSummary } from '../../utils/weeklyPayrollTeamSummary'
import { payrollTeamId } from '../../utils/payrollTeamSelection'
export default function WeeklyPayrollTeamSummary({ groups, selectedTeamId = '', onSelectTeam }) {
  const { t } = useTranslation(); const summary = useMemo(() => weeklyPayrollTeamSummary(groups), [groups])
  const values = (byCurrency, key, hideZero = false) => {
    const entries = summary.currencies.filter((currency) => !hideZero || Number(byCurrency[currency]?.[key] || 0) !== 0)
    return entries.length ? entries.map((currency) => <span className="block" dir="ltr" key={currency}>{formatPayrollMoney(byCurrency[currency]?.[key] || 0, { currency, paymentType: 'weekly' })}</span>) : '—'
  }
  return <div className="weekly-team-summary-wrap"><table className="weekly-team-summary"><thead><tr><th>{t('payroll.summaryNumber')}</th><th className="summary-team">{t('payroll.summaryTeam')}</th><th>{t('payroll.summaryEffectif')}</th><th>{t('payroll.summaryWorkDayPay')}</th><th>{t('payroll.transport')}</th><th>{t('payroll.summaryOvertime')}</th><th>{t('payroll.summaryLate')}</th><th>{t('payroll.total')}</th></tr></thead><tbody>{summary.rows.map((row) => <tr className={payrollTeamId(row.id) === payrollTeamId(selectedTeamId) ? 'is-selected' : ''} key={row.id}><td>{row.index}</td><td className="summary-team"><button type="button" onClick={() => onSelectTeam(payrollTeamId(row.id))}>{row.name}</button></td><td>{row.workers}</td><td>{values(row.byCurrency, 'workDayPay')}</td><td>{values(row.byCurrency, 'transport', true)}</td><td>{values(row.byCurrency, 'overtime', true)}</td><td>—</td><td className="summary-final">{values(row.byCurrency, 'total', true)}</td></tr>)}</tbody><tfoot><tr><th colSpan="2">{t('payroll.total')}</th><th>{summary.totals.workers}</th><th>{values(summary.totals.byCurrency, 'workDayPay')}</th><th>{values(summary.totals.byCurrency, 'transport', true)}</th><th>{values(summary.totals.byCurrency, 'overtime', true)}</th><th>—</th><th>{values(summary.totals.byCurrency, 'total')}</th></tr></tfoot></table></div>
}
