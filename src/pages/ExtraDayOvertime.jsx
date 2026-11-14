import React,{useEffect,useState} from 'react'
import {getExtraDayRules,getExtraDayReviews,getExtraDayTeams,saveExtraDayRule,decideExtraDays} from '../api/extraDayOvertimeApi'
import {getWorkersRequest} from '../api/workersApi'
import {kinshasaClock} from '../utils/attendanceOperationalGate'
import {getErrorMessage} from '../api/axios'
import {formatPayrollMoney} from '../utils/payrollCurrency'
import {formatBiometricOvertimeDuration as duration} from '../utils/biometricOvertimeReview'
const labels={pending:'قيد المراجعة',approved:'موافق عليه',rejected:'مرفوض',stale:'يحتاج مراجعة من جديد'}
const emptyRule=()=>({name:'',enabled:true,team_ids:[],worker_ids:[],start_date:'',end_date:'',start_time:'',window_end:'',minimum_end:'',minimum_minutes:'',notes:''})
const localTime=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kinshasa',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'—'
export default function ExtraDayOvertime({settings=false}) {
  const today=kinshasaClock().date
  const [rules,setRules]=useState([]),[workers,setWorkers]=useState([]),[rows,setRows]=useState([])
  const [teamOptions,setTeamOptions]=useState([])
  const [start,setStart]=useState(today),[end,setEnd]=useState(today),[status,setStatus]=useState('pending'),[ruleFilter,setRuleFilter]=useState('')
  const [form,setForm]=useState(emptyRule),[editing,setEditing]=useState(null),[selected,setSelected]=useState([])
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0)
  useEffect(()=>{let active=true;setLoading(true);setError('');setSelected([])
    Promise.all([getExtraDayRules(),settings?getWorkersRequest():Promise.resolve({data:[]}),settings?Promise.resolve([]):getExtraDayReviews(start,end),settings?getExtraDayTeams():Promise.resolve([])])
      .then(([r,w,s,t])=>{if(active){setRules(r);setWorkers(w.data);setRows(s);setTeamOptions(t)}}).catch(e=>{if(active)setError(getErrorMessage(e))}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[start,end,reload,settings])
  const change=(key,value)=>setForm(old=>({...old,[key]:value}))
  const toggle=(key,id)=>change(key,form[key].includes(id)?form[key].filter(v=>v!==id):[...form[key],id])
  const teams=teamOptions.map(team=>[team.id,team.name])
  const save=async e=>{e.preventDefault();setSaving(true);setError('');setMessage('')
    try{await saveExtraDayRule(form,editing?.id||null,editing?.version||0);setForm(emptyRule());setEditing(null);setReload(n=>n+1);setMessage('تم حفظ القاعدة')}
    catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}}
  const visible=rows.filter(r=>(!status||r.status===status)&&(!ruleFilter||r.rule_id===ruleFilter))
  const decide=async(entries,decision)=>{if(!entries.length||entries.length>200){setError('اختر من 1 إلى 200 سجل');return}setSaving(true);setError('');setMessage('')
    try{await decideExtraDays(entries,decision);setReload(n=>n+1);setMessage('تم حفظ القرارات')}
    catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}}
  const key=r=>`${r.rule_id}|${r.worker_id}|${r.work_date}`
  return <section dir="rtl" className="space-y-4"><h1 className="text-2xl font-bold">إضافي يوم كامل</h1>
    <p>علاوة يوم كامل بعد الموافقة فقط، دون إضافة يوم حضور. تحل محل الإضافي بالساعة لنفس التاريخ. يلزم إزالة أي إجمالي إضافي أسبوعي غير موزع على الأيام قبل الموافقة.</p>
    <nav className="flex gap-3"><a className="btn-secondary" href="/settings/attendance-overtime">إعدادات الإضافي</a><a className="btn-secondary" href="/attendance/double-overtime-review">مراجعة إضافي يوم كامل</a></nav>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {loading&&<p role="status">جاري التحميل...</p>}
    {settings?<><form onSubmit={save} className="surface-card space-y-3 p-4"><fieldset disabled={saving}>
      <h2 className="mb-3 font-bold">{editing?'تعديل القاعدة':'قاعدة مؤقتة جديدة'}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>اسم القاعدة<input required maxLength={150} className="input-base" value={form.name} onChange={e=>change('name',e.target.value)} /></label>
        <label>من تاريخ<input required className="input-base" type="date" value={form.start_date} onChange={e=>change('start_date',e.target.value)} /></label>
        <label>إلى تاريخ<input required className="input-base" type="date" min={form.start_date} value={form.end_date} onChange={e=>change('end_date',e.target.value)} /></label>
        <label>بداية نافذة الأدلة<input required className="input-base" type="time" value={form.start_time} onChange={e=>change('start_time',e.target.value)} /></label>
        <label>نهاية نافذة الأدلة<input required className="input-base" type="time" value={form.window_end} onChange={e=>change('window_end',e.target.value)} /></label>
        <label>الحد الأدنى لوقت النهاية<input className="input-base" type="time" value={form.minimum_end} onChange={e=>change('minimum_end',e.target.value)} /></label>
        <label>الحد الأدنى للمدة بالدقائق<input className="input-base" type="number" min={1} max={1440} value={form.minimum_minutes} onChange={e=>change('minimum_minutes',e.target.value)} /></label>
      </div><p className="my-2 text-sm">حدد حد نهاية أو مدة واحدة على الأقل. نهاية النافذة قبل بدايتها تعني اليوم التالي. تنتهي القاعدة تلقائياً بعد تاريخ النهاية، مع حفظ جميع القرارات.</p>
      <label className="block"><input type="checkbox" checked={form.enabled} onChange={e=>change('enabled',e.target.checked)} /> مفعلة</label>
      <div className="grid gap-3 sm:grid-cols-2"><fieldset className="max-h-48 overflow-y-auto rounded border p-2"><legend>الفرق المؤهلة</legend>{teams.map(([id,name])=><label className="block" key={id}><input type="checkbox" checked={form.team_ids.includes(id)} onChange={()=>toggle('team_ids',id)} /> {name}</label>)}</fieldset>
      <fieldset className="max-h-48 overflow-y-auto rounded border p-2"><legend>عمال إضافيون محددون</legend>{workers.filter(w=>w.staff_classification!=='special_staff').map(w=><label className="block" key={w.id}><input type="checkbox" checked={form.worker_ids.includes(w.id)} onChange={()=>toggle('worker_ids',w.id)} /> {w.full_name} #{w.employee_code}</label>)}</fieldset></div>
      <label className="block">ملاحظات<textarea className="input-base" maxLength={2000} value={form.notes} onChange={e=>change('notes',e.target.value)} /></label>
      <p>طريقة الدفع: +1 أجر يوم كامل</p><div className="flex gap-2"><button className="btn-primary" type="submit">حفظ القاعدة</button><button type="button" className="btn-secondary" onClick={()=>{setEditing(null);setForm(emptyRule())}}>إلغاء</button></div>
    </fieldset></form>
    <div className="surface-card overflow-x-auto p-3"><table className="w-full text-sm"><thead><tr>{['القاعدة','الفترة','الحالة','الإجراء'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rules.map(r=><tr key={r.id}><td>{r.name}</td><td><bdi>{r.start_date} → {r.end_date}</bdi></td><td>{!r.enabled?'معطلة':r.end_date<today?'منتهية':r.start_date>today?'قادمة':'نشطة'}</td><td><button type="button" className="btn-secondary" onClick={()=>{setEditing(r);setForm({...emptyRule(),...r,minimum_end:r.minimum_end||'',minimum_minutes:r.minimum_minutes??''})}}>تعديل / تفعيل</button></td></tr>)}</tbody></table></div></>:
    <><fieldset disabled={saving} className="surface-card flex flex-wrap items-end gap-3 p-3">
      <label>من تاريخ<input className="input-base" type="date" max={end} value={start} onChange={e=>e.target.value&&setStart(e.target.value)} /></label>
      <label>إلى تاريخ<input className="input-base" type="date" min={start} max={today} value={end} onChange={e=>e.target.value&&setEnd(e.target.value)} /></label>
      <label>القاعدة<select className="input-base" value={ruleFilter} onChange={e=>setRuleFilter(e.target.value)}><option value="">كل القواعد</option>{rules.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>الحالة<select className="input-base" value={status} onChange={e=>setStatus(e.target.value)}><option value="">الكل</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <button type="button" className="btn-secondary" onClick={()=>setReload(n=>n+1)}>تحديث الأدلة</button>
      <button type="button" className="btn-secondary" onClick={()=>setSelected(visible.filter(r=>!r.locked).map(key))}>اختيار الكل الظاهر</button>
      <button type="button" className="btn-primary" disabled={!selected.length} onClick={()=>decide(visible.filter(r=>selected.includes(key(r))&&!r.locked),'approved')}>موافقة على المختارين</button>
      <button type="button" className="btn-secondary" disabled={!selected.length} onClick={()=>decide(visible.filter(r=>selected.includes(key(r))&&!r.locked),'rejected')}>رفض المختارين</button>
    </fieldset><div className="surface-card overflow-x-auto p-3"><table className="w-full border-collapse text-sm"><thead><tr>{['اختيار','العامل / الكود','الفريق الدائم','التاريخ','القاعدة','الحضور','الأدلة','البداية','النهاية','المدة','أجر اليوم / العلاوة','الحالة','القرار'].map(h=><th className="border p-2" key={h}>{h}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={key(r)}>
      <td className="border p-2"><input type="checkbox" aria-label={`اختيار ${r.source.worker.full_name}`} disabled={r.locked||saving} checked={selected.includes(key(r))} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,key(r)])]:old.filter(k=>k!==key(r)))} /></td>
      <td className="border p-2">{r.source.worker.full_name} #{r.source.worker.employee_code}</td><td className="border p-2">{r.source.worker.team_name}</td><td className="border p-2">{r.work_date}</td><td className="border p-2">{r.review.rule_snapshot.name}</td><td className="border p-2">{r.source.attendance.status}</td>
      <td className="border p-2"><details><summary>{r.source.events.length} بصمات مؤكدة</summary>{r.source.events.map(e=><p key={e.id}><bdi dir="ltr">{e.device} / {e.employee_no} / {e.timestamp}</bdi></p>)}</details></td>
      <td className="border p-2"><bdi>{localTime(r.source.start)}</bdi></td><td className="border p-2"><bdi>{localTime(r.source.end)}</bdi></td><td className="border p-2"><bdi>{duration(r.source.duration_minutes)}</bdi></td>
      <td className="border p-2"><bdi>{r.source.configuration_error?'—':formatPayrollMoney(r.source.daily_wage,{currency:r.source.currency})}</bdi>{r.source.configuration_error&&<small className="block">{r.source.configuration_error}</small>}</td><td className="border p-2">{labels[r.status]}{r.locked&&<small className="block">فترة الرواتب مقفلة</small>}</td>
      <td className="border p-2"><div className="flex gap-2"><button type="button" className="btn-primary" disabled={saving||r.locked||!r.source.qualified||Boolean(r.source.configuration_error)} onClick={()=>decide([r],'approved')}>موافقة</button><button type="button" className="btn-secondary" disabled={saving||r.locked} onClick={()=>decide([r],'rejected')}>رفض</button></div></td>
    </tr>)}{!loading&&!visible.length&&<tr><td colSpan={13} className="p-4 text-center">لا توجد حالات مطابقة</td></tr>}</tbody></table></div></>}
  </section>
}
