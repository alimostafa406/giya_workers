import { useEffect, useMemo, useState } from 'react'
import { loadWorkerControlHistoryRows } from '../api/workerControlData'
import { useTranslation } from '../i18n/LanguageContext'
import { translations } from '../i18n/translations'
import { useAuthStore } from '../store/authStore'
import { buildWorkerHistory, validWorkerHistoryRange, workerHistoryRange } from '../utils/workerControlHistory'
import { formatEveningOvertimeMinutes } from '../utils/weeklyPayrollOvertime'

const dateText = (date) => date?.split('-').reverse().join('/') || '—'
const fallbackTranslation = (key) => key.split('.').reduce((value, part) => value?.[part], translations.ar) || key
const timeText = (value) => {
  if (!value) return '—'
  if (!String(value).includes('T')) return String(value).slice(0, 5)
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kinshasa', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant)
}

export default function WorkerControlAttendanceHistory({ worker, today }) {
  const context = useTranslation()
  const t = context?.t || fallbackTranslation
  const authKey = useAuthStore((state) => state.user?.id || state.admin?.id || '')
  const [preset, setPreset] = useState('this-month')
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 7)}-01`)
  const [customTo, setCustomTo] = useState(today)
  const [range, setRange] = useState(() => workerHistoryRange('this-month', today))
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    loadWorkerControlHistoryRows({ workerId: worker.id, dateFrom: range.dateFrom, dateTo: range.dateTo, authKey })
      .then((response) => { if (current) setAttendance(response.data || []) })
      .catch((failure) => { if (current) setError(failure?.message || t('workerControlHistory.loadError')) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [worker.id, range.dateFrom, range.dateTo, authKey, t])

  const history = useMemo(() => buildWorkerHistory({ worker, attendance, dateFrom: range.dateFrom, dateTo: range.dateTo }), [worker, attendance, range])
  const visible = filter === 'all' ? history.days : history.days.filter((day) => day.status === filter)
  const choosePreset = (value) => { setPreset(value); if (value !== 'custom') setRange(workerHistoryRange(value, today)) }
  const applyCustom = () => {
    const next = workerHistoryRange('custom', today, customFrom, customTo)
    if (!validWorkerHistoryRange(next, today)) { setError(t('workerControlHistory.invalidRange')); return }
    setError('')
    setRange(next)
  }
  const status = (value) => t(`workerControlHistory.status.${value}`) || value

  return <section className="border-t border-(--border) py-7" data-testid="worker-attendance-history">
    <h3 className="mb-4 text-xl font-extrabold">{t('workerControlHistory.title')}</h3>
    <div className="mb-4 flex flex-wrap gap-2">{['this-month', 'last-month', 'last-two-months', 'last-three-months', 'custom'].map((value) => <button key={value} type="button" className={preset === value ? 'btn-primary' : 'btn-secondary'} aria-pressed={preset === value} onClick={() => choosePreset(value)}>{t(`workerControlHistory.range.${value}`)}</button>)}</div>
    {preset === 'custom' ? <div className="mb-4 flex flex-wrap items-end gap-3"><label className="text-sm">{t('workerControlHistory.dateFrom')}<input type="date" className="input-base mt-1 block" value={customFrom} max={today} onChange={(event) => setCustomFrom(event.target.value)} /></label><label className="text-sm">{t('workerControlHistory.dateTo')}<input type="date" className="input-base mt-1 block" value={customTo} max={today} onChange={(event) => setCustomTo(event.target.value)} /></label><button type="button" className="btn-primary" onClick={applyCustom}>{t('workerControlHistory.apply')}</button></div> : null}
    <p className="mb-4 text-sm text-(--muted)" dir="ltr">{dateText(range.dateFrom)} → {dateText(range.dateTo)}</p>
    {error ? <p className="alert alert--error mb-4">{error}</p> : null}
    {loading ? <p>{t('common.loading')}</p> : <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['eligible', history.summary.eligible], ['present', history.summary.present], ['halfDay', history.summary.halfDay], ['absent', history.summary.absent], ['percentage', history.summary.percentage === null ? '—' : `${history.summary.percentage.toFixed(1)}%`]].map(([key, value]) => <div key={key} className="rounded-lg bg-(--surface-subtle) p-3"><p className="text-sm text-(--muted)">{t(`workerControlHistory.summary.${key}`)}</p><b className="mt-1 block">{value}</b></div>)}</div>
      <div className="mb-4 flex flex-wrap gap-2">{['all', 'absent', 'half_day', 'present'].map((value) => <button type="button" key={value} className={filter === value ? 'btn-primary' : 'btn-secondary'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`workerControlHistory.filter.${value}`)} ({value === 'all' ? history.days.length : history.days.filter((day) => day.status === value).length})</button>)}</div>
      <div className="overflow-x-auto rounded-xl border border-(--border)"><table className="min-w-full text-sm md:text-base"><thead className="bg-(--surface-subtle)"><tr>{['date', 'weekday', 'status', 'checkIn', 'checkOut', 'overtime', 'note'].map((key) => <th key={key} className="whitespace-nowrap px-4 py-3 text-start">{t(`workerControlHistory.column.${key}`)}</th>)}</tr></thead><tbody>{visible.map((day) => <tr key={day.date} className={`border-t border-(--border) ${day.status === 'absent' ? 'bg-amber-50/50' : ''}`}><td className="whitespace-nowrap px-4 py-3" dir="ltr">{dateText(day.date)}</td><td className="whitespace-nowrap px-4 py-3">{t(`workerControlHistory.weekday.${new Date(`${day.date}T12:00:00Z`).getUTCDay()}`)}</td><td className="whitespace-nowrap px-4 py-3 font-semibold">{status(day.status)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkIn)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkOut)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{formatEveningOvertimeMinutes(day.overtimeMinutes)}</td><td className="px-4 py-3">{day.note || day.source || '—'}</td></tr>)}</tbody></table>{!visible.length ? <p className="p-5 text-(--muted)">{t('workerControlHistory.empty')}</p> : null}</div>
    </>}
  </section>
}
