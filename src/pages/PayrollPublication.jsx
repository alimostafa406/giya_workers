import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getErrorMessage } from '../api/axios'
import { getCurrentWeeklyPayrollPublicationRequest, setCurrentWeeklyPayrollPublicationRequest } from '../api/payrollPublicationApi'
import { useTranslation } from '../i18n/LanguageContext'
import { formatPayrollMoney } from '../utils/payrollCurrency'
import { canPublishCurrentWeeklyPayroll, normalizeCurrentWeeklyPayrollPublication } from '../utils/payrollPublication'

const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'Africa/Kinshasa' }).format(new Date(`${value}T12:00:00+01:00`)) : '—'

export default function PayrollPublication() {
  const { t } = useTranslation()
  const [period, setPeriod] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPeriod(normalizeCurrentWeeklyPayrollPublication(await getCurrentWeeklyPayrollPublicationRequest()))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  const sent = period?.viewerVisible === true
  const publishable = canPublishCurrentWeeklyPayroll(period)

  const changePublication = async () => {
    if (!period || saving || (!sent && !publishable)) return
    const totals = period.totals.map((item) => formatPayrollMoney(item.amount, { currency: item.currency, paymentType: 'weekly' })).join(' · ') || '—'
    const prompt = sent
      ? t('payrollPublication.unpublishConfirm', { start: formatDate(period.weekStart), end: formatDate(period.weekEnd) })
      : t('payrollPublication.publishConfirm', { start: formatDate(period.weekStart), end: formatDate(period.weekEnd), workers: period.workerCount, teams: period.teamCount, totals })
    if (!window.confirm(prompt)) return
    setSaving(true)
    setError('')
    try {
      await setCurrentWeeklyPayrollPublicationRequest(!sent)
      await load()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  return <section className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-extrabold">{t('payrollPublication.title')}</h1><p className="mt-1 text-sm text-(--muted)">{t('payrollPublication.description')}</p></div>
      <Link className="btn-secondary" to="/payroll">{t('payrollPublication.back')}</Link>
    </header>
    {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
    {loading ? <div className="surface-card p-8 text-center text-(--muted)">{t('common.loading')}</div> : !period?.weekStart ? <div className="surface-card p-8 text-center text-(--muted)">{t('payrollPublication.unavailable')}</div> : <article className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-(--border) p-5">
        <div><p className="text-sm text-(--muted)">{t('payrollPublication.currentWeek')}</p><h2 className="mt-1 text-xl font-extrabold" dir="ltr">{formatDate(period.weekStart)} — {formatDate(period.weekEnd)}</h2></div>
        <span className={`status-badge ${sent ? 'status-badge--success' : 'status-badge--neutral'}`}>{t(`payrollPublication.${sent ? 'sent' : 'notSent'}`)}</span>
      </div>
      <div className="grid gap-px bg-(--border) sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white p-4"><span className="text-sm text-(--muted)">{t('payrollPublication.workers')}</span><strong className="mt-1 block text-2xl">{period.workerCount}</strong></div>
        <div className="bg-white p-4"><span className="text-sm text-(--muted)">{t('payrollPublication.teams')}</span><strong className="mt-1 block text-2xl">{period.teamCount}</strong></div>
        <div className="bg-white p-4"><span className="text-sm text-(--muted)">{t('payrollPublication.finalization')}</span><strong className="mt-1 block">{publishable ? t('payrollPublication.finalized') : t('payrollPublication.unfinished')}</strong></div>
        <div className="bg-white p-4"><span className="text-sm text-(--muted)">{t('payrollPublication.total')}</span><div className="mt-1 space-y-1 font-extrabold">{period.totals.length ? period.totals.map((item) => <div key={item.currency} dir="ltr">{formatPayrollMoney(item.amount, { currency: item.currency, paymentType: 'weekly' })}</div>) : '—'}</div></div>
      </div>
      <div className="p-5">
        {!sent && !publishable ? <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{t('payrollPublication.finalizeFirst')}</p> : null}
        <button className={sent ? 'btn-secondary' : 'btn-primary'} disabled={saving || (!sent && !publishable)} onClick={changePublication}>{saving ? t('common.saving') : t(`payrollPublication.${sent ? 'stopDisplay' : 'send'}`)}</button>
        <p className="mt-3 text-xs text-(--muted)">{t('payrollPublication.expirationNote')}</p>
      </div>
    </article>}
  </section>
}
