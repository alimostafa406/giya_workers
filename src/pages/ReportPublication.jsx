import { useCallback, useEffect, useState } from 'react'
import { getReportPublication, publishReportPublication, stopReportPublication } from '../api/reportPublicationApi.js'
import { getErrorMessage } from '../api/axios'
import { useTranslation } from '../i18n/LanguageContext'
import { useAuthStore } from '../store/authStore'

export default function ReportPublication() {
  const { t } = useTranslation()
  const admin = useAuthStore(state => state.admin)
  const [period, setPeriod] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setPeriod(await getReportPublication()) } catch (cause) { setError(getErrorMessage(cause)) }
  }, [])
  useEffect(() => { if (admin?.is_active) load() }, [admin?.is_active, load])
  const change = async (publish) => {
    if (busy || !window.confirm(t(`reportPublication.${publish ? 'publishConfirm' : 'stopConfirm'}`))) return
    setBusy(true); setError('')
    try { setPeriod(await (publish ? publishReportPublication() : stopReportPublication())) }
    catch (cause) { setError(getErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  if (!admin?.is_active) return null
  return <section className="space-y-5">
    <header><h1 className="text-2xl font-extrabold">{t('reportPublication.title')}</h1><p className="mt-2 text-(--muted)">{t('reportPublication.description')}</p></header>
    {error && <p role="alert" className="alert alert--error">{error}</p>}
    {!period ? <p>{t('common.loading')}</p> : <article className="surface-card space-y-4 p-5">
      <h2 className="font-bold">{t('reportPublication.currentWeek')}</h2>
      <p dir="ltr">{period.period_start} → {period.period_end}</p>
      <p role="status" className="font-bold">{t(`reportPublication.${period.published ? 'published' : 'unpublished'}`)}</p>
      {period.published_at && <p>{t('reportPublication.publishedAt')}: <time>{period.published_at}</time> · {t('reportPublication.version')}: {period.version}</p>}
      <p>{t('reportPublication.availableDates')}: {period.available_dates.join(' · ') || '—'}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => change(true)}>{t(`reportPublication.${period.published ? 'republish' : 'publish'}`)}</button>
        <button type="button" className="btn-secondary" disabled={busy || !period.published} onClick={() => change(false)}>{t('reportPublication.stop')}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={load}>{t('reportPublication.refresh')}</button>
      </div>
      <p className="text-sm text-(--muted)">{t('reportPublication.snapshotNote')}</p>
    </article>}
  </section>
}
