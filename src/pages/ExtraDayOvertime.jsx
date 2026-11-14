import React,{useEffect,useState} from 'react'
import {getExtraDaySessionReviews,getExtraDayTeams,decideExtraDays} from '../api/extraDayOvertimeApi'
import {kinshasaClock} from '../utils/attendanceOperationalGate'
import {getErrorMessage} from '../api/axios'
import {formatPayrollMoney} from '../utils/payrollCurrency'
import {formatBiometricOvertimeDuration as duration} from '../utils/biometricOvertimeReview'
const labels={pending:'قيد المراجعة',approved:'موافق عليه',rejected:'مرفوض',stale:'يحتاج مراجعة من جديد'}
const localTime=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kinshasa',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'—'
const attendanceLabels={present:'حاضر',late:'متأخر',half_day:'½',absent:'غائب'}
const key=r=>`${r.worker_id}|${r.work_date}`
export default function ExtraDayOvertime() {
  const today=kinshasaClock().date
  const [date,setDate]=useState(today),[team,setTeam]=useState(''),[teams,setTeams]=useState([]),[rows,setRows]=useState([]),[selected,setSelected]=useState([])
  const [start,setStart]=useState(''),[end,setEnd]=useState(''),[tolerance,setTolerance]=useState(''),[request,setRequest]=useState(null)
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0)
  useEffect(()=>{let active=true;getExtraDayTeams().then(value=>{if(active)setTeams(value)}).catch(e=>{if(active)setError(getErrorMessage(e))});return()=>{active=false}},[])
  useEffect(()=>{let active=true;setRows([]);setSelected([]);setError('');setMessage('');setLoading(Boolean(request))
    if(!request)return()=>{active=false}
    getExtraDaySessionReviews(request.date,request.team,request.start,request.end,request.tolerance).then(value=>{if(active)setRows(value)}).catch(e=>{if(active)setError(getErrorMessage(e))}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[request,reload])
  const change=(setter,value)=>{setter(value);setRequest(null)}
  const show=()=>setRequest({date,team,start,end,tolerance})
  const visible=request?rows:[]
  const decide=async(entries,decision)=>{
    if(!entries.length||entries.length>200){setError('اختر من 1 إلى 200 سجل');return}
    setSaving(true);setError('');setMessage('')
    try{await decideExtraDays(entries,decision);setReload(n=>n+1)}
    catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}
  }
  const selectedRows=visible.filter(r=>selected.includes(key(r))&&!r.locked)
  const money=r=>r.source.configuration_error?'—':formatPayrollMoney(r.source.daily_wage,{currency:r.source.currency})
  return <section dir="rtl" className="space-y-4">
    <h1 className="text-2xl font-bold">إضافي يوم كامل</h1>
    <p className="text-sm">اختر التاريخ والفريق، ثم راجع الأدلة وحدد المستحقين. الموافقة تضيف أجر يوم كامل دون يوم حضور إضافي، وتحل محل الإضافي بالساعة لنفس التاريخ.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <fieldset disabled={saving} className="surface-card flex flex-wrap items-end gap-3 p-3">
      <label>التاريخ<input className="input-base" type="date" max={today} value={date} onChange={e=>change(setDate,e.target.value)} /></label>
      <label>الفريق<select className="input-base" value={team} onChange={e=>change(setTeam,e.target.value)}><option value="">اختر الفريق</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>بداية العمل الخاص<input className="input-base" type="time" value={start} onChange={e=>change(setStart,e.target.value)} /></label>
      <label>نهاية العمل الخاص<input className="input-base" type="time" value={end} onChange={e=>change(setEnd,e.target.value)} /></label>
      <label>سماح النهاية بالدقائق<input className="input-base" type="number" min="0" max="1440" step="1" value={tolerance} onChange={e=>change(setTolerance,e.target.value)} /></label>
      <button type="button" className="btn-primary" disabled={!date||!team||!start||!end||tolerance===''||!Number.isInteger(Number(tolerance))||Number(tolerance)<0||Number(tolerance)>1440||loading} onClick={show}>عرض العمال المستحقين</button>
      <button type="button" className="btn-secondary" disabled={loading||!visible.length} onClick={()=>setSelected(visible.filter(r=>!r.locked).map(key))}>اختيار الكل الظاهر</button>
      <button type="button" className="btn-primary" disabled={loading||!selectedRows.length||selectedRows.some(r=>!r.source.qualified||r.source.configuration_error)} onClick={()=>decide(selectedRows,'approved')}>موافقة على المختارين</button>
      <button type="button" className="btn-secondary" disabled={loading||!selectedRows.length} onClick={()=>decide(selectedRows,'rejected')}>رفض المختارين</button>
    </fieldset>
    {loading&&<p role="status">جاري التحميل...</p>}
    <div className="surface-card overflow-x-auto p-3"><table className="w-full border-collapse text-sm"><thead><tr>{['اختيار','العامل','كود الموظف','الفريق','الحضور','الدخول الفعلي','الخروج الفعلي','بداية العمل الخاص','حد التأهل','مدة العمل الخاص','أجر اليوم','العلاوة المقترحة','الحالة','الأدلة','القرار'].map(h=><th className="border p-2" key={h}>{h}</th>)}</tr></thead>
    <tbody>{visible.map(r=><tr key={key(r)}>
      <td className="border p-2"><input type="checkbox" aria-label={`اختيار ${r.source.worker.full_name}`} disabled={saving||r.locked} checked={selected.includes(key(r))} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,key(r)])]:old.filter(k=>k!==key(r)))} /></td>
      <td className="border p-2">{r.source.worker.full_name}</td><td className="border p-2">{r.source.worker.employee_code}</td><td className="border p-2">{r.source.worker.team_name}</td>
      <td className="border p-2">{attendanceLabels[r.source.attendance.status]||r.source.attendance.status}</td>
      <td className="border p-2"><bdi>{localTime(r.source.start)}</bdi></td><td className="border p-2"><bdi>{localTime(r.source.end)}</bdi></td>
      <td className="border p-2"><bdi>{localTime(r.source.special_start)}</bdi></td><td className="border p-2"><bdi>{localTime(r.source.qualifying_threshold)}</bdi></td><td className="border p-2"><bdi>{duration(r.source.duration_minutes)}</bdi></td>
      <td className="border p-2"><bdi>{money(r)}</bdi></td><td className="border p-2"><bdi>{money(r)}</bdi>{r.source.configuration_error&&<small className="block">{r.source.configuration_error}</small>}</td>
      <td className="border p-2">{labels[r.status]}{r.locked&&<small className="block">فترة الرواتب مقفلة</small>}</td>
      <td className="border p-2"><details><summary>عرض الأدلة</summary>{r.source.rule?.session_settings&&<p>شروط المراجعة: <bdi>{r.source.rule.session_settings.start} → {r.source.rule.session_settings.end}</bdi>، سماح {r.source.rule.session_settings.tolerance} دقيقة</p>}{(r.source.events||[]).map(e=><p key={e.id}><bdi dir="ltr">{e.device} / {e.employee_no} / {e.timestamp}</bdi></p>)}{(r.source.outside_work||[]).map(e=><p key={e.participant_id}>عمل خارجي نهائي <bdi>{e.start||e.shared_start} → {e.end||e.shared_end}</bdi></p>)}</details></td>
      <td className="border p-2"><div className="flex gap-2"><button type="button" className="btn-primary" disabled={saving||r.locked||!r.source.qualified||Boolean(r.source.configuration_error)} onClick={()=>decide([r],'approved')}>موافقة</button><button type="button" className="btn-secondary" disabled={saving||r.locked} onClick={()=>decide([r],'rejected')}>رفض</button></div></td>
    </tr>)}{!loading&&!visible.length&&<tr><td colSpan={15} className="p-4 text-center">{request?'لا توجد حالات مطابقة':'اختر التاريخ والفريق ووقت العمل والسماح ثم اعرض العمال'}</td></tr>}</tbody></table></div>
  </section>
}
