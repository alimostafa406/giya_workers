import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getEarlyMorningReviewsRequest,
  resolveEarlyMorningReviewRequest,
} from '../../api/earlyMorningReviewApi'
import {
  EARLY_MORNING_DECISIONS,
  indexEarlyMorningReviews,
  reviewDecisionLabel,
} from '../../utils/earlyMorningReview'

const dateTime = (value) => value
  ? new Intl.DateTimeFormat('ar-CD', {
    timeZone: 'Africa/Kinshasa', dateStyle: 'medium', timeStyle: 'medium',
  }).format(new Date(value))
  : '—'

const attendanceText = (row) => row
  ? `${row.status} · ${row.check_in || '—'} → ${row.check_out || '—'}${row.manual_override ? ' · محمي' : ''}`
  : 'لا يوجد سجل'

export default function EarlyMorningAttendanceReviewPanel() {
  const [status, setStatus] = useState('needs_review')
  const [snapshot, setSnapshot] = useState({ reviews: [], workers: [], attendance: [] })
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSnapshot(await getEarlyMorningReviewsRequest({ status }))
    } catch (requestError) {
      setError(requestError?.message || 'تعذر تحميل مراجعة البصمات المبكرة.')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])
  const rows = useMemo(() => indexEarlyMorningReviews(snapshot), [snapshot])

  const decide = async (row, decision) => {
    const prompt = decision === EARLY_MORNING_DECISIONS.currentDayCheckIn
      ? `اعتماد ${dateTime(row.event_timestamp)} كدخول ليوم ${row.current_work_date}؟`
      : decision === EARLY_MORNING_DECISIONS.previousWorkdayCheckOut
        ? `اعتماد ${dateTime(row.event_timestamp)} كخروج ليوم العمل ${row.previous_work_date}؟`
        : 'تجاهل هذه البصمة مع الاحتفاظ بالدليل الخام؟'
    if (!window.confirm(prompt)) return
    setSavingId(row.id)
    setError('')
    try {
      await resolveEarlyMorningReviewRequest(row.id, decision)
      await load()
    } catch (requestError) {
      setError(requestError?.message || 'تعذر حفظ قرار المراجعة.')
    } finally {
      setSavingId('')
    }
  }

  return <section className="surface-card p-5" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-extrabold">مراجعة البصمات بين 01:00 و05:59</h3>
        <p className="mt-1 text-sm text-(--muted)">لا تُسجل هذه البصمات تلقائيًا كدخول أو خروج. اختر المعنى الصحيح لكل دليل.</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className={status === 'needs_review' ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus('needs_review')}>بانتظار المراجعة</button>
        <button type="button" className={status === 'resolved' ? 'btn-primary' : 'btn-secondary'} onClick={() => setStatus('resolved')}>تمت المراجعة</button>
        <button type="button" className="btn-secondary" onClick={load}>تحديث</button>
      </div>
    </div>

    {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
    {loading ? <p className="mt-4 text-sm text-(--muted)">جارٍ التحميل...</p> : null}
    {!loading && !rows.length ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-(--muted)">لا توجد بصمات في هذه الحالة.</p> : null}

    <div className="mt-4 space-y-3">
      {rows.map((row) => <article key={row.id} className="rounded-xl border border-(--border) p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-extrabold">{row.worker?.full_name || row.device_name || 'هوية غير مربوطة'}</p>
            <p className="mt-1 text-sm text-(--muted)">{row.worker?.employee_code ? `#${row.worker.employee_code} · ` : ''}{row.device_id} · {row.device_employee_no}</p>
          </div>
          <span className={`status-badge ${row.review_status === 'needs_review' ? 'status-badge--warning' : 'status-badge--success'}`}>
            {row.review_status === 'needs_review' ? 'يحتاج مراجعة' : reviewDecisionLabel(row.review_decision)}
          </span>
        </div>
        <p className="mt-3 font-mono text-sm" dir="ltr">{dateTime(row.event_timestamp)}{row.event_serial ? ` · serial ${row.event_serial}` : ''}</p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3"><strong>يوم العمل السابق · {row.previous_work_date}</strong><p className="mt-1 text-(--muted)">{attendanceText(row.previousAttendance)}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><strong>يوم البصمة · {row.current_work_date}</strong><p className="mt-1 text-(--muted)">{attendanceText(row.currentAttendance)}</p></div>
        </div>
        {row.review_status === 'needs_review' ? <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={savingId === row.id || !row.worker_id} onClick={() => decide(row, EARLY_MORNING_DECISIONS.currentDayCheckIn)}>تسجيل دخول اليوم</button>
          <button type="button" className="btn-secondary" disabled={savingId === row.id || !row.worker_id} onClick={() => decide(row, EARLY_MORNING_DECISIONS.previousWorkdayCheckOut)}>تسجيل خروج ليوم العمل السابق</button>
          <button type="button" className="btn-secondary" disabled={savingId === row.id} onClick={() => decide(row, EARLY_MORNING_DECISIONS.ignored)}>تجاهل البصمة</button>
          {!row.worker_id ? <span className="self-center text-xs font-bold text-amber-700">لا يمكن تطبيق حضور دون ربط مؤكد وآمن.</span> : null}
        </div> : <p className="mt-3 text-xs text-(--muted)">راجعها المسؤول في {dateTime(row.reviewed_at)}</p>}
      </article>)}
    </div>
  </section>
}
