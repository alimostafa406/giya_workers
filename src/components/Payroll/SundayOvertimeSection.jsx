import {useEffect,useState} from 'react'
import {biometricReviewRows,formatBiometricOvertimeDuration as duration} from '../../utils/biometricOvertimeReview'
import {decideBiometricOvertime} from '../../api/biometricOvertimeReviewApi'
import {calculateWeeklyOvertimePay} from '../../utils/weeklyPayrollOvertime'
import {formatPayrollMoney} from '../../utils/payrollCurrency'
import {getErrorMessage} from '../../api/axios'

const labels={pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض'}
export default function SundayOvertimeSection({date,sources=[],team='',search='',onSaved}){
 const [selected,setSelected]=useState([]),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 useEffect(()=>{setSelected([]);setError('');setMessage('')},[date,sources])
 const rows=biometricReviewRows(sources).filter(r=>r.sunday_evidence&&r.work_date===date&&(!team||String(r.worker.team_id)===team)&&`${r.worker.full_name} ${r.worker.employee_code}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
 const actionable=rows.filter(r=>!r.locked),chosen=actionable.filter(r=>selected.includes(r.worker.id))
 const decide=async(entries,decision)=>{
  if(saving||!entries.length)return
  setSaving(true);setError('');setMessage('')
  try{await decideBiometricOvertime(date,entries,decision);await onSaved();setSelected([]);setMessage('تم حفظ القرارات')}
  catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}
 }
 const clock=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kinshasa',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):'—'
 const money=(value,currency)=>value==null||!currency?'—':formatPayrollMoney(value,{currency,paymentType:'weekly'})
 return <section className="sunday-hourly-review surface-card p-4" dir="rtl"><h2>إضافي الأحد</h2>
  <p className="text-sm">إضافي الأحد يبدأ حسب إعدادات العامل ويخضع للمراجعة. قبض الأحد والنقل مستقلان ويستحقان عند اكتمال الحضور.</p>
  <div className="flex flex-wrap gap-2 my-2">
   <button type="button" className="btn-secondary" disabled={saving||!actionable.length} onClick={()=>setSelected(actionable.map(r=>r.worker.id))}>اختيار الكل الظاهر</button>
   <button type="button" className="btn-primary" disabled={saving||!chosen.length} onClick={()=>decide(chosen,'approved')}>موافقة على المختارين</button>
   <button type="button" className="btn-secondary" disabled={saving||!chosen.length} onClick={()=>decide(chosen,'rejected')}>رفض المختارين</button>
  </div>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <div className="overflow-x-auto"><table><thead><tr>{['اختيار','العامل','كود الموظف','الفريق','الخروج الفعلي','مدة إضافي الأحد','سعر الإضافي بالساعة','مبلغ الإضافي المقترح','الحالة','القرار'].map(h=><th key={h}>{h}</th>)}</tr></thead>
  <tbody>{rows.map(r=>{const pay=calculateWeeklyOvertimePay({eveningOvertimeMinutes:r.approvedMinutes,overtimeHourlyRate:r.hourly_rate})
   return <tr key={r.worker.id} data-sunday-ot-worker={r.worker.id}>
    <td><input type="checkbox" aria-label={r.worker.full_name} disabled={saving||r.locked} checked={selected.includes(r.worker.id)} onChange={()=>setSelected(old=>old.includes(r.worker.id)?old.filter(id=>id!==r.worker.id):[...old,r.worker.id])}/></td>
    <td>{r.worker.full_name}</td><td>{r.worker.employee_code}</td><td>{r.worker.team_name}</td><td><bdi dir="ltr">{clock(r.evidence.last_at)}</bdi></td>
    <td><bdi dir="ltr">{duration(r.minutes)}</bdi>{r.approvedMinutes!==r.minutes&&<small className="block">المعتمد: {duration(r.approvedMinutes)}</small>}</td>
    <td><bdi dir="ltr">{money(r.hourly_rate,r.currency)}</bdi></td><td><bdi dir="ltr">{money(pay.overtimePay,r.currency)}</bdi></td>
    <td>{labels[r.status]}{r.stale&&<small className="block">يحتاج مراجعة من جديد</small>}</td>
    <td><button type="button" className="btn-secondary" disabled={saving||r.locked||r.status==='approved'} onClick={()=>decide([r],'approved')}>موافقة</button> <button type="button" className="btn-secondary" disabled={saving||r.locked||r.status==='rejected'} onClick={()=>decide([r],'rejected')}>رفض</button></td>
   </tr>})}</tbody></table></div>{!rows.length&&<p>لا يوجد إضافي أحد مؤهل</p>}
 </section>
}
