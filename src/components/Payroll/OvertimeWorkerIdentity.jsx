import { useTranslation } from '../../i18n/LanguageContext'

export default function OvertimeWorkerIdentity({ worker, biometricId, showCode = true }) {
  const { language } = useTranslation()
  const labels = { ar: { weekly: 'أسبوعي', monthly: 'شهري' }, en: { weekly: 'Weekly', monthly: 'Monthly' }, fr: { weekly: 'Hebdomadaire', monthly: 'Mensuel' } }
  return <><strong>{worker.full_name}</strong>{showCode && <small className="block"><bdi>{worker.employee_code || '—'}{biometricId && ` · #${biometricId.split(' · ').join(' · #')}`}</bdi></small>}
    {!showCode && biometricId && <small className="block"><bdi>#{biometricId.split(' · ').join(' · #')}</bdi></small>}
    {labels[language]?.[worker.payment_type] && <small className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{labels[language][worker.payment_type]}</small>}</>
}
