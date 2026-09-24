import { useMemo, useState } from 'react'
import { recoverWorkerWeekAttendanceRequest } from '../api/workerWeekAttendanceRecoveryApi'
import { useTranslation } from '../i18n/LanguageContext'

const isoDate = (value) => value.toISOString().slice(0, 10)
const mondayFor = (value = new Date()) => { const date = new Date(value); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return isoDate(date) }
const saturdayFor = (monday) => { const date = new Date(`${monday}T12:00:00`); date.setDate(date.getDate() + 5); return isoDate(date) }
const attendanceText = (value = {}) => !value?.status ? '—' : `${value.status}${value.check_in ? ` · ${String(value.check_in).slice(0, 5)}` : ''}${value.check_out ? `–${String(value.check_out).slice(0, 5)}` : ''}`

export default function WorkerWeekAttendanceRecovery({ worker, disabled, onRecovered }) {
  const { t } = useTranslation()
  const [weekStart, setWeekStart] = useState(mondayFor())
  const [busy, setBusy] = useState(false); const [result, setResult] = useState(null); const [error, setError] = useState('')
  const validWeek = useMemo(() => new Date(`${weekStart}T12:00:00`).getDay() === 1, [weekStart])
  const weekEnd = validWeek ? saturdayFor(weekStart) : ''
  const recover = async () => {
    if (!validWeek || !worker?.id || !window.confirm(t('workers.recoverWeekConfirm', { start: weekStart, end: weekEnd }))) return
    setBusy(true); setError(''); setResult(null)
    try { const next = await recoverWorkerWeekAttendanceRequest({ workerId: worker.id, weekStartDate: weekStart }); setResult(next); await onRecovered?.() } catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('workers.recoverWeekFailed')) } finally { setBusy(false) }
  }
  return <section className="mt-5 border-t border-(--border) pt-4" data-worker-week-attendance-recovery>
    <h3 className="font-extrabold">{t('workers.recoverWeekAttendance')}</h3><p className="mt-1 text-sm text-(--muted)">{t('workers.recoverWeekHint')}</p>
    <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-sm font-semibold">{t('workers.recoverWeekStart')}<input className="input-base mt-1" type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} /></label><p className="pb-2 text-sm text-(--muted)">{validWeek ? `${weekStart} → ${weekEnd}` : t('workers.recoverWeekMondayRequired')}</p><button type="button" className="btn-primary px-3 py-2" disabled={disabled || busy || !validWeek} onClick={recover}>{busy ? t('common.saving') : t('workers.recoverWeekAttendance')}</button></div>
    {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    {result ? <div className="mt-4 overflow-x-auto"><p className="mb-2 text-sm font-bold">{t('workers.recoverySummary', { recovered: result.recovered, unchanged: result.unchanged, skipped: result.skipped })}</p><table className="w-full min-w-160 border-collapse text-xs"><thead><tr className="bg-(--surface-soft)"><th className="border border-(--border) p-2">{t('payroll.day')}</th><th className="border border-(--border) p-2">{t('workers.recoveryBefore')}</th><th className="border border-(--border) p-2">{t('workers.recoveryEvidence')}</th><th className="border border-(--border) p-2">{t('workers.recoveryAfter')}</th><th className="border border-(--border) p-2">{t('common.status')}</th></tr></thead><tbody>{result.days?.map((day) => <tr key={day.date}><td className="border border-(--border) p-2">{day.date}</td><td className="border border-(--border) p-2">{attendanceText(day.before)}</td><td className="border border-(--border) p-2" dir="ltr">{day.evidence?.map((event) => String(event.timestamp || '').slice(11, 16)).filter(Boolean).join(', ') || '—'}</td><td className="border border-(--border) p-2">{attendanceText(day.after)}</td><td className="border border-(--border) p-2">{day.result}{day.warnings?.length ? ` · ${day.warnings.join(', ')}` : ''}</td></tr>)}</tbody></table></div> : null}
  </section>
}
