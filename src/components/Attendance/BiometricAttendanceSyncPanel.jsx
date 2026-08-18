import { useEffect, useMemo, useState } from 'react'
import Table from '../Table/Table'

const helperUrl = import.meta.env.VITE_LOCAL_HIKVISION_HELPER_URL
  || (import.meta.env.DEV ? 'http://127.0.0.1:8765' : '')

const officeToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
const testOnlyDate = '2026-08-10'
const initialDate = () => {
  const current = officeToday()
  if (current !== testOnlyDate) return current
  const nextDay = new Date(`${current}T12:00:00+01:00`)
  nextDay.setDate(nextDay.getDate() + 1)
  return nextDay.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
}
const labels = { present: 'حاضر', half_day: 'نصف يوم', absent: 'غائب', pending: 'معلّق', unmapped: 'غير مربوط', needs_review: 'يحتاج مراجعة', manual_protected: 'محمي يدويًا', special_staff: 'موظف خاص' }

function BiometricAttendanceSyncPanel({ onApplied }) {
  const [date, setDate] = useState(initialDate)
  const [helperState, setHelperState] = useState('checking')
  const [hikvisionState, setHikvisionState] = useState('unknown')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [lastPreview, setLastPreview] = useState('')
  const [lastApply, setLastApply] = useState('')

  const checkHealth = async () => {
    if (!helperUrl) { setHelperState('unavailable'); return }
    try {
      const response = await fetch(`${helperUrl}/health`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'helper unavailable')
      setHelperState('connected')
      setHikvisionState(data.hikvision_reachable === true ? 'reachable' : data.hikvision_reachable === false ? 'unavailable' : 'unknown')
    } catch {
      setHelperState('unavailable')
      setHikvisionState('unknown')
    }
  }
  useEffect(() => { checkHealth() }, [])

  const request = async (path, body) => {
    if (!helperUrl) throw new Error('المساعد المحلي غير متاح. افتح اللوحة من لابتوب المكتب.')
    const response = await fetch(`${helperUrl}${path}`, { method: 'POST', body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.status !== 'ok') throw new Error(data.message || data.code || `فشلت العملية بحالة ${response.status}.`)
    setHelperState('connected')
    setHikvisionState(data.hikvision_reachable === false ? 'unavailable' : 'reachable')
    return data
  }
  const preview = async () => {
    if (date === testOnlyDate) { setError('2026-08-10 تاريخ اختبار فقط ولا يمكن معاينته أو تطبيقه.'); return }
    setLoading(true); setError('')
    try { const data = await request('/attendance/preview', { date }); setResult(data); setLastPreview(new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })) } catch (err) { setError(err.message || 'تعذرت معاينة الحضور.') } finally { setLoading(false) }
  }
  const apply = async () => {
    if (date === testOnlyDate) { setError('2026-08-10 تاريخ اختبار فقط ولا يمكن تطبيقه.'); return }
    if (!window.confirm(`سيتم تطبيق حضور البصمة لتاريخ ${date} فقط. لن تُعدّل السجلات اليدوية. متابعة؟`)) return
    setLoading(true); setError('')
    try { const data = await request('/attendance/apply', { date, confirm: true }); setResult(data); setLastApply(new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })); onApplied?.() } catch (err) { setError(err.message || 'تعذرت مزامنة الحضور.') } finally { setLoading(false) }
  }

  const rows = useMemo(() => result?.proposals || [], [result])
  const columns = [
    { key: 'name', header: 'العامل', render: (row) => row.full_name || '-' },
    { key: 'classification', header: 'الفئة', render: (row) => row.classification === 'special_staff' ? 'موظف خاص' : 'عامل عادي' },
    { key: 'checkIn', header: 'الدخول المقترح', render: (row) => row.check_in || '-' },
    { key: 'checkOut', header: 'الخروج المقترح', render: (row) => row.check_out || '-' },
    { key: 'status', header: 'الحالة المقترحة', render: (row) => row.proposed_status || '-' },
  ]

  return <div className="surface-card mb-5 p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-extrabold">مزامنة حضور جهاز البصمة</h3><p className="mt-1 text-sm text-(--muted)">تشغيل يدوي محلي فقط؛ لا توجد مزامنة تلقائية أو استيراد تاريخي.</p></div><div className="flex flex-wrap gap-2"><span className={`status-badge ${helperState === 'connected' ? 'status-badge--success' : 'status-badge--neutral'}`}>المساعد: {helperState === 'connected' ? 'متصل' : helperState === 'checking' ? 'جارٍ الفحص' : 'غير متصل'}</span><span className={`status-badge ${hikvisionState === 'reachable' ? 'status-badge--success' : 'status-badge--neutral'}`}>Hikvision: {hikvisionState === 'reachable' ? 'متاح' : hikvisionState === 'unavailable' ? 'غير متاح' : 'غير مفحوص'}</span></div></div><div className="mt-4 flex flex-wrap items-end gap-3"><label className="block text-sm font-bold">تاريخ العمل<input type="date" min={officeToday()} className="input-base mt-2" value={date} onChange={(event) => setDate(event.target.value)} /></label><button type="button" className="btn-secondary" disabled={loading || !helperUrl} onClick={preview}>{loading ? 'جاري التنفيذ...' : 'معاينة حضور جهاز البصمة'}</button><button type="button" className="btn-primary" disabled={loading || !helperUrl} onClick={apply}>{loading ? 'جاري التنفيذ...' : 'مزامنة حضور اليوم'}</button>{lastPreview ? <span className="text-xs text-(--muted)">آخر معاينة: {lastPreview}</span> : null}{lastApply ? <span className="text-xs font-semibold text-emerald-700">آخر مزامنة ناجحة: {lastApply}</span> : null}</div>{error ? <p className="alert alert--error mt-4">{error}</p> : null}{result ? <><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(result.counts || {}).map(([key, value]) => <div key={key} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-(--muted)">{labels[key] || key}</p><p className="mt-1 font-extrabold">{value}</p></div>)}</div><div className="mt-4"><Table columns={columns} data={rows} loading={false} emptyMessage="لا توجد صفوف مقترحة للتاريخ المحدد" /></div></> : null}</div>
}

export default BiometricAttendanceSyncPanel
