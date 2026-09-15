import { useTranslation } from '../../i18n/LanguageContext'
import { payrollTeamId } from '../../utils/payrollTeamSelection'

export default function PayrollTeamCards({ groups = [], onOpenTeam }) {
  const { t } = useTranslation()
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-payroll-team-cards>{groups.map((group) => <button key={group.id} type="button" className="surface-card flex items-center justify-between gap-3 p-4 text-start transition hover:border-(--primary) hover:shadow-sm" onClick={() => onOpenTeam(payrollTeamId(group.id))}><strong className="text-base">{group.name}</strong><span className="status-badge status-badge--neutral">{group.lines.length} {t('payroll.workers')}</span></button>)}</div>
}
