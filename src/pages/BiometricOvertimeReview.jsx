import { useEffect, useState } from 'react'
import { getBiometricOvertimeReviews, decideBiometricOvertime } from '../api/biometricOvertimeReviewApi'
import { biometricReviewRows, biometricReviewTitle } from '../utils/biometricOvertimeReview'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { getErrorMessage } from '../api/axios'

const labels = { pending: 'قيد المراجعة', approved: 'موافق عليه', rejected: 'مرفوض' }
const hours = (minutes) => `${Number((minutes / 60).toFixed(2))} h`
const dayAfter = (date, offset) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+offset); return d.toISOString().slice(0,10) }
export default function BiometricOvertimeReview({ report } = {}) {
  const today = kinshasaClock().date
  const requested = new URLSearchParams(window.location.search).get('date')
  const [localDate, setLocalDate] = useState(requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today ? requested : today)
  const date = report?.date || localDate
  const setDate = report?.setDate || setLocalDate
  const [sources, setSources] = useState([]), [team, setTeam] = useState(''), [status, setStatus] = useState('pending')
  const [selected, setSelected] = useState([]), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true; setLoading(true); setSources([]); setSelected([])
    getBiometricOvertimeReviews(date).then((rows) => { if(active) setSources(rows) }).catch((e) => { if(active) setError(getErrorMessage(e)) }).finally(() => { if(active) setLoading(false) })
    return () => { active = false }
  }, [date,reload])
  const reviewRows = biometricReviewRows(sources)
  // Preserve the report's existing population, ordering and useful display columns.
  // Only genuine canonical biometric sources receive decision controls.
  const rows = report ? report.rows.map((display) => {
    const review = reviewRows.find((r) => String(r.attendance.id) === String(display.id))
    return review ? { ...review, display } : { display, worker: { id: `report-${display.id}`, full_name: display.worker, team_id: display.teamId, team_name: display.team }, attendance: {}, minutes: display.overtimeMinutes, status: 'unavailable', locked: true }
  }) : reviewRows
  const visible = rows.filter((r) => (!team || String(r.worker.team_id) === team) && (!status || r.status === status))
  const teams = [...new Map(rows.map((r) => [String(r.worker.team_id),r.worker.team_name])).entries()]
  const changeDate = (next) => { if(next && next<=today && !saving) { setDate(next); setMessage(''); setError('') } }
  const decide = async (entries, decision) => {
    if (!entries.length || saving || loading) return
    setSaving(true); setError(''); setMessage('')
    try {
      // Every chunk is atomic; retain earlier successful decisions if a later chunk fails.
      for(let i=0;i<entries.length;i+=200) {
        const chunk = entries.slice(i,i+200)
        const saved = await decideBiometricOvertime(date,chunk,decision)
        setSources((old) => old.map((source) => {
          const entry = chunk.find((r) => String(r.worker.id) === String(source.worker.id))
          if (!entry) return source
          const result = saved?.find((r) => String(r.worker_id) === String(source.worker.id))
          return { ...source, review: { ...source.review, decision, minutes: entry.minutes, source_fingerprint: entry.source_fingerprint, version: result?.version ?? (source.review?.version || 0)+1 } }
        }))
      }
      setMessage('تم حفظ القرارات'); setSelected([])
    } catch(e) { setError(getErrorMessage(e)); setReload((n)=>n+1) }
    finally { setSaving(false) }
  }
  const selectedVisible = visible.filter((r)=>selected.includes(r.worker.id)&&!r.locked)
  const busy = loading || report?.loading
  return <section dir="rtl" className={`space-y-4 ${report ? 'daily-report-print-root' : ''}`}><h1 className="text-2xl font-bold">{report?.title || biometricReviewTitle}</h1>
    {report && <><style>{'@media print { @page { size: A4 landscape; margin: 12mm; } .biometric-review-controls { display: none !important; } }'}</style><p>{report.formattedDate}</p></>}
    <p className="text-sm text-(--muted)">الإضافي من البصمة لا يُصرف تلقائياً. أي تغيير في دليل البصمة يتطلب مراجعة جديدة.</p>
    <fieldset disabled={saving} className="biometric-review-controls surface-card flex flex-wrap items-end gap-3 p-4">
      <button type="button" className="btn-secondary" onClick={()=>changeDate(dayAfter(date,-1))}>اليوم السابق</button>
      <label>التاريخ<input type="date" className="input-base" max={today} value={date} onChange={(e)=>changeDate(e.target.value)} /></label>
      <button type="button" className="btn-secondary" disabled={date>=today} onClick={()=>changeDate(dayAfter(date,1))}>اليوم التالي</button>
      <label>الفريق<select className="input-base" value={team} onChange={(e)=>setTeam(e.target.value)}><option value="">كل الفرق</option>{teams.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>الحالة<select className="input-base" value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">كل الحالات</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <button type="button" className="btn-secondary" onClick={()=>setReload((n)=>n+1)}>إعادة التحميل</button>
      {report && <button type="button" className="btn-secondary" disabled={busy} onClick={()=>window.print()}>طباعة</button>}
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-4">{[['pending','بانتظار المراجعة'],['approved','موافق عليه'],['rejected','مرفوض']].map(([key,label])=><p key={key} className="surface-card p-3">{label}: <strong>{rows.filter((r)=>r.status===key).length}</strong></p>)}<p className="surface-card p-3">إجمالي الساعات الموافق عليها: <bdi dir="ltr">{hours(rows.filter((r)=>r.status==='approved').reduce((sum,r)=>sum+r.minutes,0))}</bdi></p></div>
    {(error || report?.error) && <p role="alert">{error || report.error}</p>}{message && <p role="status">{message}</p>}
    {busy ? <p role="status">جاري التحميل...</p> : <fieldset disabled={saving} className="surface-card p-3">
      <div className="biometric-review-controls mb-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={()=>setSelected((old)=>[...new Set([...old,...visible.filter((r)=>!r.locked).map((r)=>r.worker.id)])])}>اختيار الكل</button>
      <button type="button" className="btn-primary" disabled={!selectedVisible.length} onClick={()=>decide(selectedVisible,'approved')}>موافقة على المحددين</button>
      <button type="button" className="btn-secondary" disabled={!selectedVisible.length} onClick={()=>decide(selectedVisible,'rejected')}>رفض المحددين</button>
      <button type="button" className="btn-secondary" onClick={()=>setSelected([])}>إلغاء الاختيار</button></div>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr>{['اختيار','العامل','الكود',...(report ? ['رقم البصمة'] : []),'الفريق','وقت الدخول','وقت الخروج','الإضافي المحسوب من البصمة',...(report ? ['ملاحظات'] : []),'الحالة','القرار'].map((h)=><th key={h} className={`border p-2 text-start ${['اختيار','القرار'].includes(h)?'biometric-review-controls':''}`}>{h}</th>)}</tr></thead><tbody>
      {visible.map((r)=><tr key={r.worker.id}><td className="biometric-review-controls border p-2"><input type="checkbox" aria-label={r.worker.full_name} disabled={r.locked} checked={selected.includes(r.worker.id)} onChange={()=>setSelected((old)=>old.includes(r.worker.id)?old.filter((id)=>id!==r.worker.id):[...old,r.worker.id])} /></td>
      <td className="border p-2">{r.worker.full_name}{r.worker.payment_type==='monthly'&&<small className="block">شهري — إضافي فقط</small>}</td><td className="border p-2">{r.worker.employee_code || '—'}</td>{report && <td className="border p-2"><bdi dir="ltr">{r.display.biometricId}</bdi></td>}<td className="border p-2">{r.worker.team_name}</td>
      <td className="border p-2"><bdi dir="ltr">{r.display?.checkIn || r.attendance.check_in||'—'}</bdi></td><td className="border p-2"><bdi dir="ltr">{r.display?.checkOut || r.attendance.check_out||'—'}</bdi></td><td className="border p-2"><bdi dir="ltr">{hours(r.minutes)}</bdi></td>{report && <td className="border p-2">{r.display.note}</td>}
      <td className="border p-2">{r.stale ? 'يحتاج مراجعة من جديد' : labels[r.status] || '—'}{r.stale&&<small className="block text-amber-700">تغير دليل البصمة — يلزم إعادة المراجعة</small>}{r.locked&&r.status!=='unavailable'&&<small className="block">فترة الرواتب مقفلة</small>}</td>
      <td className="biometric-review-controls border p-2">{r.status!=='unavailable'&&<div className="flex gap-2"><button type="button" className="btn-primary" disabled={r.locked} onClick={()=>decide([r],'approved')}>موافقة</button><button type="button" className="btn-secondary" disabled={r.locked} onClick={()=>decide([r],'rejected')}>رفض</button></div>}</td></tr>)}
      {!visible.length&&<tr><td colSpan={report ? 11 : 9} className="p-4 text-center">لا يوجد وقت إضافي مطابق للبحث</td></tr>}</tbody></table></div>
    </fieldset>}
  </section>
}
