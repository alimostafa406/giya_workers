import React,{useEffect,useState} from 'react'
import {getExtraDayEndReviews,getExtraDayTeams,decideExtraDays} from '../api/extraDayOvertimeApi'
import {kinshasaClock} from '../utils/attendanceOperationalGate'
import {getErrorMessage} from '../api/axios'
import {formatPayrollMoney} from '../utils/payrollCurrency'
const labels={pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض',stale:'يحتاج مراجعة'}
const clockPattern=/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/
const localTime=value=>{
  if(!value)return '—'
  if(/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value))return value.slice(0,8).padEnd(8,':00')
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kinshasa',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value))
}
const evidenceDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kinshasa',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
const attendanceLabels={present:'حاضر',late:'متأخر',half_day:'½',absent:'غائب'}
const key=r=>`${r.worker_id}|${r.work_date}`
const actionable=r=>!r.locked&&['pending','stale'].includes(r.status)
export default function ExtraDayOvertime() {
  const today=kinshasaClock().date
  const [date,setDate]=useState(today),[team,setTeam]=useState(''),[teams,setTeams]=useState([]),[rows,setRows]=useState([]),[selected,setSelected]=useState([])
  const [end,setEnd]=useState('00:00:00'),[tolerance,setTolerance]=useState('30'),[request,setRequest]=useState(null)
  const [status,setStatus]=useState('pending')
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  useEffect(()=>{let active=true;getExtraDayTeams().then(value=>{if(active)setTeams(value)}).catch(e=>{if(active)setError(getErrorMessage(e))});return()=>{active=false}},[])
  useEffect(()=>{let active=true;setRows([]);setSelected([]);setError('');setMessage('');setLoading(Boolean(request))
    if(!request)return()=>{active=false}
    getExtraDayEndReviews(request.date,request.team,request.end,request.tolerance).then(value=>{if(active)setRows(value)}).catch(e=>{if(active)setError(getErrorMessage(e))}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[request])
  const change=(setter,value)=>{setter(value);setRequest(null)}
  const show=()=>setRequest({date,team,end,tolerance})
  const visible=request?rows.filter(r=>status==='all'||(status==='pending'?['pending','stale'].includes(r.status):r.status===status)):[]
  const decide=async(entries,decision)=>{
    if(saving||loading)return
    const current=entries.map(entry=>rows.find(r=>key(r)===key(entry))).filter(r=>r&&actionable(r)&&(decision!=='approved'||(r.source.qualified&&!r.source.configuration_error)))
    if(!current.length||current.length>200){setError('اختر من 1 إلى 200 سجل قابل للمراجعة');return}
    setSaving(true);setError('');setMessage('')
    try{
      await decideExtraDays(current,decision)
      setSelected([])
      setRows(old=>old.map(r=>current.some(entry=>key(entry)===key(r))?{...r,status:decision}:r))
      setMessage('تم حفظ القرارات بنجاح')
      try{setRows(await getExtraDayEndReviews(request.date,request.team,request.end,request.tolerance))}
      catch(e){setError(`تم الحفظ، تعذر تحديث القائمة: ${getErrorMessage(e)}`)}
    }
    catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}
  }
  const selectedRows=visible.filter(r=>selected.includes(key(r))&&actionable(r))
  const money=r=>r.source.configuration_error?'—':formatPayrollMoney(r.source.daily_wage,{currency:r.source.currency})
  return <section dir="rtl" className="space-y-4">
    <h1 className="text-2xl font-bold">إضافي يوم كامل</h1>
    <p className="text-sm">اختر التاريخ والفريق، ثم راجع الأدلة وحدد المستحقين. الموافقة تضيف أجر يوم كامل دون يوم حضور إضافي، وتحل محل الإضافي بالساعة لنفس التاريخ.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <fieldset disabled={saving} className="surface-card flex flex-wrap items-end gap-3 p-3">
      <label>التاريخ<input className="input-base" type="date" max={today} value={date} onChange={e=>change(setDate,e.target.value)} /></label>
      <label>الفريق<select className="input-base" value={team} onChange={e=>change(setTeam,e.target.value)}><option value="">اختر الفريق</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>نهاية العمل الخاص<input className="input-base" type="text" dir="ltr" inputMode="numeric" placeholder="HH:mm:ss" pattern="([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]" maxLength={8} value={end} onChange={e=>change(setEnd,e.target.value)} /></label>
      <label>سماح النهاية بالدقائق<input className="input-base" type="number" min="0" max="1440" step="1" value={tolerance} onChange={e=>change(setTolerance,e.target.value)} /></label>
      <label>الحالة<select className="input-base" value={status} onChange={e=>{setStatus(e.target.value);setSelected([])}}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="all">الكل</option></select></label>
      <button type="button" className="btn-primary" disabled={!date||!team||!clockPattern.test(end)||tolerance===''||!Number.isInteger(Number(tolerance))||Number(tolerance)<0||Number(tolerance)>1440||loading} onClick={show}>عرض العمال المستحقين</button>
      <button type="button" className="btn-secondary" disabled={loading||!visible.some(actionable)} onClick={()=>setSelected(visible.filter(actionable).map(key))}>اختيار الكل الظاهر</button>
      <button type="button" className="btn-primary" disabled={loading||!selectedRows.length||selectedRows.some(r=>!r.source.qualified||r.source.configuration_error)} onClick={()=>decide(selectedRows,'approved')}>موافقة على المختارين</button>
      <button type="button" className="btn-secondary" disabled={loading||!selectedRows.length} onClick={()=>decide(selectedRows,'rejected')}>رفض المختارين</button>
    </fieldset>
    {loading&&<p role="status">جاري التحميل...</p>}
    <div className="surface-card overflow-x-auto p-3"><table className="w-full border-collapse text-sm"><thead><tr>{['اختيار','العامل','كود الموظف','الفريق','الحضور','الدخول الفعلي','الخروج الفعلي','حد التأهل','أجر اليوم','العلاوة المقترحة','الحالة','الأدلة','القرار'].map(h=><th className="border p-2" key={h}>{h}</th>)}</tr></thead>
    <tbody>{visible.map(r=><tr key={key(r)}>
      <td className="border p-2"><input type="checkbox" aria-label={`اختيار ${r.source.worker.full_name}`} disabled={saving||!actionable(r)} checked={selected.includes(key(r))} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,key(r)])]:old.filter(k=>k!==key(r)))} /></td>
      <td className="border p-2">{r.source.worker.full_name}</td><td className="border p-2">{r.source.worker.employee_code}</td><td className="border p-2">{r.source.worker.team_name}</td>
      <td className="border p-2">{attendanceLabels[r.source.attendance.status]||r.source.attendance.status}</td>
      <td className="border p-2"><bdi>{localTime(r.source.start)}</bdi></td><td className="border p-2"><bdi>{localTime(r.source.end)}</bdi></td>
      <td className="border p-2"><bdi>{localTime(r.source.qualifying_threshold)}</bdi></td>
      <td className="border p-2"><bdi>{money(r)}</bdi></td><td className="border p-2"><bdi>{money(r)}</bdi>{r.source.configuration_error&&<small className="block">{r.source.configuration_error}</small>}</td>
      <td className="border p-2">{labels[r.status]}{r.locked&&<small className="block">فترة الرواتب مقفلة</small>}</td>
      <td className="border p-2"><details><summary>عرض الأدلة</summary>{r.source.rule?.session_settings&&<p>شروط المراجعة: <bdi>{localTime(r.source.rule.session_settings.end)}</bdi>، سماح {r.source.rule.session_settings.tolerance} دقيقة</p>}{(r.source.events||[]).map(e=><p key={e.id}><bdi dir="ltr">{e.device} / {e.employee_no} / <time dateTime={e.timestamp}>{evidenceDate(e.timestamp)} {localTime(e.timestamp)}</time></bdi></p>)}{(r.source.outside_work||[]).map(e=><p key={e.participant_id}>عمل خارجي نهائي <bdi>{localTime(e.start||e.shared_start)} → {localTime(e.end||e.shared_end)}</bdi></p>)}</details></td>
      <td className="border p-2"><div className="flex gap-2"><button type="button" className="btn-primary" disabled={saving||!actionable(r)||!r.source.qualified||Boolean(r.source.configuration_error)} onClick={()=>decide([r],'approved')}>موافقة</button><button type="button" className="btn-secondary" disabled={saving||!actionable(r)} onClick={()=>decide([r],'rejected')}>رفض</button></div></td>
    </tr>)}{!loading&&!visible.length&&<tr><td colSpan={13} className="p-4 text-center">{request?'لا توجد حالات مطابقة':'اختر التاريخ والفريق ثم اعرض العمال'}</td></tr>}</tbody></table></div>
  </section>
}
