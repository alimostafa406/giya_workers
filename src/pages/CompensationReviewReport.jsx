import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPayrollSettingsWorkersRequest } from '../api/payrollSettingsApi'
import { useTranslation } from '../i18n/LanguageContext'
import { getErrorMessage } from '../api/axios'
import { buildCompensationReviewSections } from '../utils/compensationReview'
import { formatPayrollMoney } from '../utils/payrollCurrency'

const displayMoney = (value, currency) => (
  value == null ? '—' : formatPayrollMoney(value, { currency })
)

function CompensationTeamTable({ group, paymentType, t }) {
  const isMonthly = paymentType === 'monthly'
  return <section className="compensation-review-team">
    <h3>{t('common.team')}: {group.name}</h3>
    <table>
      <colgroup>
        <col className="compensation-review-worker-column" />
        <col className="compensation-review-amount-column" />
        <col className="compensation-review-amount-column" />
        <col className="compensation-review-notes-column" />
      </colgroup>
      <thead><tr>
        <th>{t('common.worker')}</th>
        <th>{t(isMonthly ? 'payroll.monthlySalary' : 'payroll.dailyRate')}</th>
        <th>{t('payroll.transportAllowance')}</th>
        <th>{t('payroll.reviewNotes')}</th>
      </tr></thead>
      <tbody>{group.workers.map((worker) => <tr key={worker.id}>
        <td><strong>{worker.name}</strong>{worker.employeeCode ? <small>#{worker.employeeCode}</small> : null}</td>
        <td dir="ltr">{displayMoney(isMonthly ? worker.monthlySalary : worker.dailyRate, worker.currency)}</td>
        <td dir="ltr">{displayMoney(worker.transportAllowance, worker.currency)}</td>
        <td aria-label={t('payroll.reviewNotes')} />
      </tr>)}</tbody>
    </table>
  </section>
}

function CompensationSection({ title, groups, paymentType, t }) {
  if (!groups.length) return null
  return <section className="compensation-review-section">
    <h2>{title}</h2>
    {groups.map((group) => <CompensationTeamTable key={`${paymentType}-${group.id}`} group={group} paymentType={paymentType} t={t} />)}
  </section>
}

export default function CompensationReviewReport() {
  const { t, direction } = useTranslation()
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    getPayrollSettingsWorkersRequest()
      .then((result) => {
        if (mounted) setWorkers(Array.isArray(result.data) ? result.data : [])
      })
      .catch((requestError) => {
        if (mounted) setError(getErrorMessage(requestError))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [])

  const report = useMemo(() => buildCompensationReviewSections(workers), [workers])

  return <section dir={direction}>
    <div className="compensation-review-screen-only mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-extrabold">{t('payroll.compensationReview')}</h2>
        <p className="mt-1 text-sm text-(--muted)">{t('payroll.compensationReviewDescription')}</p>
      </div>
      <div className="flex gap-2">
        <Link className="btn-secondary" to="/payroll">{t('payroll.back')}</Link>
        <button type="button" className="btn-primary" disabled={loading || Boolean(error) || !report.workerCount} onClick={() => window.print()}>{t('payroll.printCompensationReview')}</button>
      </div>
    </div>

    {error ? <p className="compensation-review-screen-only alert alert--error">{error}</p> : null}
    {loading ? <p className="compensation-review-screen-only py-10 text-center text-sm text-(--muted)">{t('common.loading')}</p> : null}

    {!loading && !error ? <article className="compensation-review-print-root">
      <header className="compensation-review-header">
        <h1>{t('payroll.compensationReview')}</h1>
        <p>{t('payroll.compensationReviewPurpose')}</p>
        <p>{t('payroll.compensationReviewWorkerCount', { count: report.workerCount })}</p>
      </header>

      <CompensationSection title={t('payroll.weeklyWorkersReview')} groups={report.weeklyGroups} paymentType="weekly" t={t} />
      <CompensationSection title={t('payroll.monthlyWorkersReview')} groups={report.monthlyGroups} paymentType="monthly" t={t} />
      {!report.workerCount ? <p className="compensation-review-empty">{t('payroll.noWorkers')}</p> : null}
    </article> : null}
  </section>
}
