import {useEffect,useState} from 'react'
import {biometricReviewRows,formatBiometricOvertimeDuration as duration} from '../../utils/biometricOvertimeReview'
import {decideBiometricOvertime} from '../../api/biometricOvertimeReviewApi'
import {calculateWeeklyOvertimePay} from '../../utils/weeklyPayrollOvertime'
import {formatPayrollMoney} from '../../utils/payrollCurrency'
import {getErrorMessage} from '../../api/axios'
import {parseWeeklyDuration} from '../../utils/weeklyManualOvertime'

const labels={pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض'}
const canAct=r=>!r.locked&&(r.stale||r.status==='pending')
export default function SundayOvertimeSection({date,sources=[],team='',search='',onSaved}){
 const [selected,setSelected]=useState([]),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [adjustments,setAdjustments]=useState({})
 const [status,setStatus]=useState('pending')
 useEffect(()=>{setSelected([]);setAdjustments({});setError('');setMessage('')},[date,sources])
 const rows=biometricReviewRows(sources).filter(r=>r.sunday_evidence&&r.work_date===date&&(!team||String(r.worker.team_id)===team)&&`${r.worker.full_name} ${r.worker.employee_code}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
 const visible=rows.filter(r=>status==='all'||status==='pending'?(status==='all'||r.stale||r.status==='pending'):status==='stale'?r.stale:!r.stale&&r.status===status)
 const actionable=visible.filter(canAct),chosen=actionable.filter(r=>selected.includes(r.worker.id))
 const minutesFor=r=>{const text=(adjustments[r.worker.id]?.duration??duration(r.approvedMinutes)).trim();const m=text.match(/^(\d+)\s*min$/i);return m?Number(m[1]):parseWeeklyDuration(text.replace('h',':'))}
 const groups=[...new Set(visible.map(r=>r.worker.team_id||'unassigned'))].map(id=>({id,rows:visible.filter(r=>(r.worker.team_id||'unassigned')===id)}))
 const decide=async(entries,decision)=>{
  if(saving||!entries.length)return
  entries=entries.map(r=>rows.find(current=>current.worker.id===r.worker.id)).filter(r=>r&&canAct(r)).map(r=>({...r,payableMinutes:minutesFor(r),adjustmentNote:adjustments[r.worker.id]?.note||''}))
  if(!entries.length)return
  if(entries.some(r=>!Number.isInteger(r.payableMinutes)||r.payableMinutes<1||r.payableMinutes>1440)){setError('أدخل مدة صحيحة مثل 5h00 أو 45 min');return}
  setSaving(true);setError('');setMessage('')
  try{for(let i=0;i<entries.length;i+=200)await decideBiometricOvertime(date,entries.slice(i,i+200),decision);await onSaved();setSelected([]);setMessage('تم حفظ القرارات')}
  catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}
 }
 const clock=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kinshasa',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):'—'
 const money=(value,currency)=>value==null||!currency?'—':formatPayrollMoney(value,{currency,paymentType:'weekly'})
 return <section className="sunday-hourly-review surface-card p-4" dir="rtl"><h2>إضافي الأحد</h2>
  <p className="text-sm">إضافي الأحد يبدأ حسب إعدادات العامل ويخضع للمراجعة. قبض الأحد والنقل مستقلان ويستحقان عند اكتمال الحضور.</p>
  <div className="flex flex-wrap gap-2 my-2">
   <label>الحالة<select className="input-base" value={status} disabled={saving} onChange={e=>{setStatus(e.target.value);setSelected([])}}>{[['pending','قيد المراجعة'],['approved','معتمد'],['rejected','مرفوض'],['stale','يحتاج مراجعة'],['all','الكل']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <button type="button" className="btn-secondary" disabled={saving||!actionable.length} onClick={()=>setSelected(actionable.map(r=>r.worker.id))}>اختيار الكل الظاهر</button>
   <button type="button" className="btn-primary" disabled={saving||!chosen.length} onClick={()=>decide(chosen,'approved')}>موافقة على المختارين</button>
   <button type="button" className="btn-secondary" disabled={saving||!chosen.length} onClick={()=>decide(chosen,'rejected')}>رفض المختارين</button>
  </div>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {groups.map(group=><article key={group.id} className="space-y-3 my-4"><h3 className="font-bold">{group.rows[0].worker.team_name||'بدون فريق'}</h3><div className="flex flex-wrap gap-2">
   <button type="button" className="btn-secondary" disabled={saving||!group.rows.some(canAct)} onClick={()=>setSelected(old=>[...new Set([...old,...group.rows.filter(canAct).map(r=>r.worker.id)])])}>اختيار كل عمال الفريق</button>
   <button type="button" className="btn-primary" disabled={saving||!group.rows.some(canAct)} onClick={()=>decide(group.rows.filter(canAct),'approved')}>موافقة على الفريق</button>
   <button type="button" className="btn-secondary" disabled={saving||!group.rows.some(r=>canAct(r)&&selected.includes(r.worker.id))} onClick={()=>decide(group.rows.filter(r=>selected.includes(r.worker.id)),'approved')}>موافقة على المختارين</button>
   <button type="button" className="btn-secondary" disabled={saving||!group.rows.some(r=>canAct(r)&&selected.includes(r.worker.id))} onClick={()=>decide(group.rows.filter(r=>selected.includes(r.worker.id)),'rejected')}>رفض المختارين</button>
  </div><div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr>{['اختيار','العامل','كود الموظف','الفريق','البصمة الصباحية','آخر بصمة','بداية إضافي الأحد','الوقت المحسوب','الوقت المعتمد','سعر الإضافي','المبلغ المتوقع','الحالة','القرار'].map(h=><th className="border p-2 text-start" key={h}>{h}</th>)}</tr></thead>
  <tbody>{group.rows.map(r=>{const pay=calculateWeeklyOvertimePay({eveningOvertimeMinutes:minutesFor(r)||0,overtimeHourlyRate:r.hourly_rate})
   return <tr key={r.worker.id} data-sunday-ot-worker={r.worker.id}>
    <td><input type="checkbox" aria-label={r.worker.full_name} disabled={saving||!canAct(r)} checked={canAct(r)&&selected.includes(r.worker.id)} onChange={()=>setSelected(old=>old.includes(r.worker.id)?old.filter(id=>id!==r.worker.id):[...old,r.worker.id])}/></td>
    <td>{r.worker.full_name}</td><td>{r.worker.employee_code}</td><td>{r.worker.team_name}</td><td><bdi dir="ltr">{clock(r.evidence.first_at)}</bdi></td><td><bdi dir="ltr">{clock(r.evidence.last_at)}</bdi></td>
    <td><bdi dir="ltr">{r.sunday_settings?.overtime_start||'14:00'}</bdi></td>
    <td><bdi dir="ltr">{duration(r.minutes)}</bdi></td>
    <td><input className="input-base" dir="ltr" aria-label={`الوقت المعتمد ${r.worker.full_name}`} disabled={saving||r.locked} value={adjustments[r.worker.id]?.duration??duration(r.approvedMinutes)} onChange={e=>setAdjustments(old=>({...old,[r.worker.id]:{...old[r.worker.id],duration:e.target.value}}))}/><input className="input-base" aria-label={`سبب التعديل ${r.worker.full_name}`} placeholder="سبب / ملاحظات" maxLength={1000} disabled={saving||r.locked} value={adjustments[r.worker.id]?.note||''} onChange={e=>setAdjustments(old=>({...old,[r.worker.id]:{...old[r.worker.id],note:e.target.value}}))}/></td>
    <td><bdi dir="ltr">{money(r.hourly_rate,r.currency)}</bdi></td><td><bdi dir="ltr">{money(pay.overtimePay,r.currency)}</bdi></td>
    <td>{labels[r.status]}{r.stale&&<small className="block">يحتاج مراجعة من جديد</small>}</td>
    <td><button type="button" className="btn-secondary" disabled={saving||!canAct(r)} onClick={()=>decide([r],'approved')}>موافقة</button> <button type="button" className="btn-secondary" disabled={saving||!canAct(r)} onClick={()=>decide([r],'rejected')}>رفض</button></td>
   </tr>})}</tbody></table></div></article>)}{!visible.length&&<p>لا يوجد إضافي أحد مؤهل</p>}
 </section>
}
