import {useEffect,useState} from 'react'
import {getExtraDayTeams} from '../api/extraDayOvertimeApi'
import {getManualOvertimeExceptions,saveManualOvertimeException} from '../api/manualOvertimeExceptionApi'
import {getErrorMessage} from '../api/axios'
import {kinshasaClock} from '../utils/attendanceOperationalGate'
import {formatPayrollMoney} from '../utils/payrollCurrency'
import {manualExceptionAmounts} from '../utils/manualOvertimeException'
export default function ManualOvertimeExceptions(){
 const today=kinshasaClock().date
 const [date,setDate]=useState(today),[team,setTeam]=useState(''),[worker,setWorker]=useState(''),[teams,setTeams]=useState([]),[data,setData]=useState(null)
 const [days,setDays]=useState('1'),[hours,setHours]=useState('0'),[minutes,setMinutes]=useState('0'),[note,setNote]=useState('')
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0)
 useEffect(()=>{let active=true;getExtraDayTeams().then(rows=>{if(active)setTeams(rows)}).catch(e=>{if(active)setError(getErrorMessage(e))});return()=>{active=false}},[])
 useEffect(()=>{let active=true;setData(null);setError('');setDays('1');setHours('0');setMinutes('0');setNote('')
  if(!team||!date)return()=>{active=false}
  setLoading(true);getManualOvertimeExceptions(date,team,worker).then(result=>{if(!active)return;setData(result);const row=result.entries.find(e=>e.worker_id===worker);if(row){setDays(String(row.extra_days));setHours(String(Math.floor(row.extra_minutes/60)));setMinutes(String(row.extra_minutes%60));setNote(row.note)}}).catch(e=>{if(active)setError(getErrorMessage(e))}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[date,team,worker,reload])
 const existing=data?.entries.find(e=>e.worker_id===worker),totalMinutes=Number(hours)*60+Number(minutes)
 const amounts=manualExceptionAmounts(data?.rates,days,totalMinutes)
 const money=n=>data?.rates?.currency?formatPayrollMoney(n,{currency:data.rates.currency,paymentType:'weekly'}):'—'
 const valid=worker&&data?.rates?.currency&&(Number(days)===0||data.rates.daily_wage!=null)&&(totalMinutes===0||data.rates.hourly_rate!=null)&&!data.locked&&!loading&&!saving&&note.trim()&&Number.isInteger(Number(days))&&Number(days)>=0&&Number(days)<=31&&Number.isInteger(Number(hours))&&Number.isInteger(Number(minutes))&&Number(hours)>=0&&Number(minutes)>=0&&Number(minutes)<60&&totalMinutes<=1440&&(Number(days)>0||totalMinutes>0)
 const save=async clear=>{if(saving||loading||!worker||!note.trim())return;setSaving(true);setError('');setMessage('');try{await saveManualOvertimeException({p_worker:worker,p_date:date,p_team:team,p_days:Number(days),p_minutes:totalMinutes,p_note:note.trim(),p_version:existing?.version||0,p_rate_fingerprint:data?.rates?.fingerprint||null,p_clear:clear});setReload(n=>n+1);setMessage(clear?'تم إلغاء الاستثناء مع حفظ السجل':'تم حفظ الاستثناء اليدوي')}catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}}
 return <section dir="rtl" className="space-y-4"><h1 className="text-2xl font-bold">استثناء إضافي يدوي — أيام وساعات</h1>
  <p>أجر الأيام الإضافية والساعات الإضافية يُحسبان منفصلين. لا ينشئ هذا الإدخال حضوراً أو بصمات. لأيام الاثنين–السبت؛ الأحد عبر عمل يوم الأحد.</p>
  <p className="text-sm">إذا كان يوم الدوبل معتمداً مسبقاً، أدخل صفر أيام لإضافة الساعات الاستثنائية فقط. أي مبلغ متداخل يُمنع قبل الحفظ.</p>
  <fieldset disabled={saving} className="surface-card flex flex-wrap items-end gap-3 p-4">
   <label>التاريخ<input className="input-base" type="date" max={today} value={date} onChange={e=>{setDate(e.target.value);setWorker('')}}/></label>
   <label>الفريق<select className="input-base" value={team} onChange={e=>{setTeam(e.target.value);setWorker('')}}><option value="">اختر الفريق</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
   <label>العامل<select className="input-base" value={worker} disabled={loading} onChange={e=>setWorker(e.target.value)}><option value="">اختر العامل</option>{(data?.workers||[]).map(w=><option key={w.id} value={w.id}>{w.full_name} #{w.employee_code}</option>)}</select></label>
   <button type="button" className="btn-secondary" disabled={!team||loading} onClick={()=>setReload(n=>n+1)}>إعادة التحميل</button>
  </fieldset>
  {loading&&<p role="status">جاري التحميل...</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {worker&&data?.rates&&<fieldset disabled={loading||saving||data.locked} className="surface-card grid gap-3 p-4 sm:grid-cols-3">
   <label>أيام إضافية كاملة<input className="input-base" type="number" min="0" max="31" step="1" value={days} onChange={e=>setDays(e.target.value)}/></label>
   <label>ساعات إضافية<input className="input-base" type="number" min="0" max="24" step="1" value={hours} onChange={e=>setHours(e.target.value)}/></label>
   <label>دقائق إضافية<input className="input-base" type="number" min="0" max="59" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
   <p>أجر اليوم: <bdi dir="ltr">{data.rates.daily_wage==null?'—':money(data.rates.daily_wage)}</bdi></p><p>سعر ساعة الإضافي: <bdi dir="ltr">{data.rates.hourly_rate==null?'—':money(data.rates.hourly_rate)}</bdi></p>
   <label className="sm:col-span-3">الملاحظة / السبب<textarea className="input-base w-full" maxLength="1000" required value={note} onChange={e=>setNote(e.target.value)}/></label>
   <p>مبلغ الأيام: <bdi dir="ltr">{money(amounts.fullDay)}</bdi></p><p>مبلغ الساعات: <bdi dir="ltr">{money(amounts.hourly)}</bdi></p><strong>الإجمالي: <bdi dir="ltr">{money(amounts.total)}</bdi></strong>
   <button type="button" className="btn-primary" disabled={!valid} onClick={()=>save(false)}>حفظ الاستثناء</button><button type="button" className="btn-secondary" disabled={!existing?.active||!note.trim()} onClick={()=>save(true)}>إلغاء الاستثناء وحفظ السجل</button>
  </fieldset>}
  {data?.locked&&<p role="alert">مسير الراتب مقفل؛ لا يمكن تعديل الاستثناء.</p>}
  <div className="surface-card overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['العامل','التاريخ','الأيام الإضافية','الساعات الإضافية','مبلغ الأيام','مبلغ الساعات','الإجمالي','الحالة','السجل'].map(t=><th key={t} className="border p-2">{t}</th>)}</tr></thead><tbody>{(data?.entries||[]).map(e=><tr key={e.id}><td className="border p-2"><button type="button" onClick={()=>{setWorker(e.worker_id);setReload(n=>n+1)}}>{e.worker_name} #{e.employee_code} — تعديل</button></td><td>{e.work_date}</td><td>{e.extra_days}</td><td><bdi dir="ltr">{Math.floor(e.extra_minutes/60)}h{String(e.extra_minutes%60).padStart(2,'0')}</bdi></td>{['full_day_amount','hourly_amount','total_amount'].map(key=><td key={key}><bdi dir="ltr">{formatPayrollMoney(e[key],{currency:e.currency_code})}</bdi></td>)}<td>{e.active?'معتمد يدوياً':'ملغى'}</td><td><details><summary>سجل التغييرات ({e.version})</summary>{e.history.map((h,i)=><p key={i}>{h.action} · {h.at} · {h.reason} · {h.actor}</p>)}</details></td></tr>)}</tbody></table></div>
 </section>
}
