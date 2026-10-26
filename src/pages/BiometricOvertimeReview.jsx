import { useEffect, useState } from 'react'
import { getBiometricOvertimeReviews, decideBiometricOvertime } from '../api/biometricOvertimeReviewApi'
import { biometricReviewRows, biometricReviewTitle } from '../utils/biometricOvertimeReview'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { getErrorMessage } from '../api/axios'

const labels = { pending: 'قيد المراجعة', approved: 'موافق عليه', rejected: 'مرفوض' }
const hours = (minutes) => `${Number((minutes / 60).toFixed(2))} h`
const dayAfter = (date, offset) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+offset); return d.toISOString().slice(0,10) }
export default function BiometricOvertimeReview() {
  const today = kinshasaClock().date
  const requested = new URLSearchParams(window.location.search).get('date')
  const [date, setDate] = useState(requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today ? requested : today)
  const [sources, setSources] = useState([]), [team, setTeam] = useState(''), [status, setStatus] = useState('pending')
  const [selected, setSelected] = useState([]), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true; setLoading(true); setSources([]); setSelected([])
    getBiometricOvertimeReviews(date).then((rows) => { if(active) setSources(rows) }).catch((e) => { if(active) setError(getErrorMessage(e)) }).finally(() => { if(active) setLoading(false) })
    return () => { active = false }
  }, [date,reload])
  const rows = biometricReviewRows(sources)
  const visible = rows.filter((r) => (!team || String(r.worker.team_id) === team) && (!status || r.status === status))
  const teams = [...new Map(rows.map((r) => [String(r.worker.team_id),r.worker.team_name])).entries()]
  const changeDate = (next) => { if(next && next<=today && !saving) { setDate(next); setMessage(''); setError('') } }
  const decide = async (entries, decision) => {
    if (!entries.length || saving || loading) return
    setSaving(true); setError(''); setMessage('')
    try {
      // Every chunk is atomic; retain earlier successful decisions if a later chunk fails.
      for(let i=0;i<entries.length;i+=200) await decideBiometricOvertime(date,entries.slice(i,i+200),decision)
      setMessage('تم حفظ القرارات'); setSelected([])
    } catch(e) { setError(getErrorMessage(e)) }
    finally { setSaving(false); setReload((n)=>n+1) }
  }
  return <section dir="rtl" className="space-y-4"><h1 className="text-2xl font-bold">{biometricReviewTitle}</h1>
    <p className="text-sm text-(--muted)">الإضافي من البصمة لا يُصرف تلقائياً. أي تغيير في دليل البصمة يتطلب مراجعة جديدة.</p>
    <fieldset disabled={saving} className="surface-card flex flex-wrap items-end gap-3 p-4">
      <button type="button" className="btn-secondary" onClick={()=>changeDate(dayAfter(date,-1))}>اليوم السابق</button>
      <label>التاريخ<input type="date" className="input-base" max={today} value={date} onChange={(e)=>changeDate(e.target.value)} /></label>
      <button type="button" className="btn-secondary" disabled={date>=today} onClick={()=>changeDate(dayAfter(date,1))}>اليوم التالي</button>
      <label>الفريق<select className="input-base" value={team} onChange={(e)=>setTeam(e.target.value)}><option value="">كل الفرق</option>{teams.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>الحالة<select className="input-base" value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">كل الحالات</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <button type="button" className="btn-secondary" onClick={()=>setReload((n)=>n+1)}>إعادة التحميل</button>
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-4">{[['pending','بانتظار المراجعة'],['approved','موافق عليه'],['rejected','مرفوض']].map(([key,label])=><p key={key} className="surface-card p-3">{label}: <strong>{rows.filter((r)=>r.status===key).length}</strong></p>)}<p className="surface-card p-3">إجمالي الساعات الموافق عليها: <bdi dir="ltr">{hours(rows.filter((r)=>r.status==='approved').reduce((sum,r)=>sum+r.minutes,0))}</bdi></p></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">جاري التحميل...</p> : <fieldset disabled={saving} className="surface-card p-3">
      <div className="mb-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={()=>setSelected((old)=>[...new Set([...old,...visible.filter((r)=>!r.locked).map((r)=>r.worker.id)])])}>اختيار الكل</button>
      <button type="button" className="btn-primary" disabled={!selected.length} onClick={()=>decide(rows.filter((r)=>selected.includes(r.worker.id)&&!r.locked),'approved')}>موافقة على المحددين</button>
      <button type="button" className="btn-secondary" disabled={!selected.length} onClick={()=>decide(rows.filter((r)=>selected.includes(r.worker.id)&&!r.locked),'rejected')}>رفض المحددين</button>
      <button type="button" className="btn-secondary" onClick={()=>setSelected([])}>إلغاء الاختيار</button></div>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr>{['اختيار','العامل','الكود','الفريق','وقت الدخول','وقت الخروج','الإضافي المحسوب من البصمة','الحالة','القرار'].map((h)=><th key={h} className="border p-2 text-start">{h}</th>)}</tr></thead><tbody>
      {visible.map((r)=><tr key={r.worker.id}><td className="border p-2"><input type="checkbox" aria-label={r.worker.full_name} disabled={r.locked} checked={selected.includes(r.worker.id)} onChange={()=>setSelected((old)=>old.includes(r.worker.id)?old.filter((id)=>id!==r.worker.id):[...old,r.worker.id])} /></td>
      <td className="border p-2">{r.worker.full_name}{r.worker.payment_type==='monthly'&&<small className="block">شهري — إضافي فقط</small>}</td><td className="border p-2">{r.worker.employee_code}</td><td className="border p-2">{r.worker.team_name}</td>
      <td className="border p-2"><bdi dir="ltr">{r.attendance.check_in||'—'}</bdi></td><td className="border p-2"><bdi dir="ltr">{r.attendance.check_out||'—'}</bdi></td><td className="border p-2"><bdi dir="ltr">{hours(r.minutes)}</bdi></td>
      <td className="border p-2">{labels[r.status]}{r.stale&&<small className="block text-amber-700">تغير دليل البصمة — يلزم إعادة المراجعة</small>}{r.locked&&<small className="block">فترة الرواتب مقفلة</small>}</td>
      <td className="border p-2"><div className="flex gap-2"><button type="button" className="btn-primary" disabled={r.locked} onClick={()=>decide([r],'approved')}>موافقة</button><button type="button" className="btn-secondary" disabled={r.locked} onClick={()=>decide([r],'rejected')}>رفض</button></div></td></tr>)}
      {!visible.length&&<tr><td colSpan={9} className="p-4 text-center">لا يوجد وقت إضافي مطابق للبحث</td></tr>}</tbody></table></div>
    </fieldset>}
  </section>
}
