import {useEffect,useState} from 'react'
import {biometricReviewRows,formatBiometricOvertimeDuration as duration} from '../../utils/biometricOvertimeReview'
import {decideBiometricOvertime,saveSundayEvidence} from '../../api/biometricOvertimeReviewApi'
import {calculateWeeklyOvertimePay} from '../../utils/weeklyPayrollOvertime'
import {formatPayrollMoney} from '../../utils/payrollCurrency'
import {getErrorMessage} from '../../api/axios'
import {parseWeeklyDuration} from '../../utils/weeklyManualOvertime'
import './SundayOvertimeSection.css'
import {sundayEvidenceTimestamp,suggestedSundayMinutes} from '../../utils/sundayApprovedEvidence'

const labels={pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض'}
const canAct=r=>!r.locked&&(r.stale||r.status==='pending')
export default function SundayOvertimeSection({date,sources=[],team='',search='',onSaved,dateControl}){
 const [selected,setSelected]=useState([]),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [adjustments,setAdjustments]=useState({})
 const [status,setStatus]=useState('pending')
 const [selectedTeam,setSelectedTeam]=useState('')
 useEffect(()=>{setSelectedTeam('')},[date])
 useEffect(()=>{setSelected([]);setAdjustments({});setError('');setMessage('')},[date,sources])
 const rows=biometricReviewRows(sources).filter(r=>r.sunday_evidence&&r.work_date===date&&(!team||String(r.worker.team_id)===team)&&`${r.worker.full_name} ${r.worker.employee_code}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
 const teams=[...new Map(rows.map(r=>[String(r.worker.team_id||'unassigned'),r.worker.team_name||'بدون فريق'])).entries()]
 const visible=rows.filter(r=>(!selectedTeam||String(r.worker.team_id||'unassigned')===selectedTeam)&&(status==='all'||(status==='pending'?(r.stale||r.status==='pending'):status==='stale'?r.stale:!r.stale&&r.status===status)))
 const actionable=visible.filter(canAct),chosen=actionable.filter(r=>selected.includes(r.worker.id))
 const minutesFor=r=>{const text=(adjustments[r.worker.id]?.duration??duration(r.approvedMinutes)).trim();const m=text.match(/^(\d+)\s*min$/i);return m?Number(m[1]):parseWeeklyDuration(text.replace('h',':'))}
 const groups=[...new Set(visible.map(r=>r.worker.team_id||'unassigned'))].map(id=>({id,rows:visible.filter(r=>(r.worker.team_id||'unassigned')===id)}))
 const evidenceClock=(r,key)=>clock(r.approved_evidence_valid&&r.approved_evidence?.[`approved_${key}_punch`]||r.evidence[`${key}_at`])
 const editEvidence=(r,key,value)=>setAdjustments(old=>{const draft={...old[r.worker.id],[key]:value,evidenceDirty:true}
  const minutes=suggestedSundayMinutes(date,draft.first??evidenceClock(r,'first'),draft.last??evidenceClock(r,'last'),r.sunday_settings?.overtime_start)
  return {...old,[r.worker.id]:{...draft,duration:minutes==null?'':duration(minutes)}}
 })
 const saveEvidence=async(r,reset=false)=>{
  if(saving||r.locked)return
  const draft=adjustments[r.worker.id]||{},first=sundayEvidenceTimestamp(date,draft.first??evidenceClock(r,'first')),last=sundayEvidenceTimestamp(date,draft.last??evidenceClock(r,'last')),minutes=minutesFor(r)
  if(!reset&&(!first||!last||new Date(first)>=new Date(last)||!Number.isInteger(minutes)||minutes<0||minutes>1440)){setError('أدخل أوقاتاً صحيحة بنظام 24 ساعة ومدة إضافي صحيحة');return}
  setSaving(true);setError('')
  try{await saveSundayEvidence(date,r,{first,last,minutes,note:draft.note||'',reset});await onSaved();setMessage('تم حفظ الدليل المعتمد — يلزم اعتماد الإضافي بشكل منفصل')}
  catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}
 }
 const decide=async(entries,decision)=>{
  if(saving||!entries.length)return
  entries=entries.map(r=>rows.find(current=>current.worker.id===r.worker.id)).filter(r=>r&&canAct(r)).map(r=>({...r,payableMinutes:minutesFor(r),adjustmentNote:adjustments[r.worker.id]?.note||''}))
  if(!entries.length)return
  if(entries.some(r=>adjustments[r.worker.id]?.evidenceDirty)){setError('احفظ تعديل البصمات المعتمدة قبل اعتماد الإضافي');return}
  if(entries.some(r=>!Number.isInteger(r.payableMinutes)||r.payableMinutes<1||r.payableMinutes>1440)){setError('أدخل مدة صحيحة مثل 5h00 أو 45 min');return}
  setSaving(true);setError('');setMessage('')
  try{for(let i=0;i<entries.length;i+=200)await decideBiometricOvertime(date,entries.slice(i,i+200),decision);await onSaved();setSelected([]);setMessage('تم حفظ القرارات')}
  catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}
 }
 const clock=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kinshasa',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):'—'
 const money=(value,currency)=>value==null||!currency?'—':formatPayrollMoney(value,{currency,paymentType:'weekly'})
 return <section className="sunday-hourly-review surface-card" dir="rtl"><h2>إضافي الأحد</h2>
  <p className="text-sm">إضافي الأحد يبدأ حسب إعدادات العامل ويخضع للمراجعة. قبض الأحد والنقل مستقلان ويستحقان عند اكتمال الحضور.</p>
  <fieldset className="sunday-ot-toolbar" disabled={saving}>
   <div className="sunday-ot-filters">{dateControl}
   <label>الفريق<select className="input-base" value={selectedTeam} onChange={e=>{setSelectedTeam(e.target.value);setSelected([])}}><option value="">كل الفرق</option>{teams.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <label>الحالة<select className="input-base" value={status} disabled={saving} onChange={e=>{setStatus(e.target.value);setSelected([])}}>{[['pending','قيد المراجعة'],['approved','معتمد'],['rejected','مرفوض'],['stale','يحتاج مراجعة'],['all','الكل']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   </div><div className="sunday-ot-actions">
   <button type="button" className="btn-secondary" disabled={saving||!actionable.length} onClick={()=>setSelected(actionable.map(r=>r.worker.id))}>اختيار الكل الظاهر</button>
   <button type="button" className="btn-primary" disabled={saving||!chosen.length} onClick={()=>decide(chosen,'approved')}>موافقة على المختارين</button>
   <button type="button" className="btn-secondary" disabled={saving||!chosen.length} onClick={()=>decide(chosen,'rejected')}>رفض المختارين</button>
  </div></fieldset>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {groups.map(group=><article key={group.id} className="sunday-ot-team" data-sunday-ot-team={group.id}><header className="sunday-ot-team-heading"><h3 className="font-bold">{group.rows[0].worker.team_name||'بدون فريق'}</h3><span className="text-xs text-(--muted)">عدد العمال: {group.rows.length}</span></header><div className="sunday-ot-actions">
   <button type="button" className="btn-secondary" disabled={saving||!group.rows.some(canAct)} onClick={()=>setSelected(old=>[...new Set([...old,...group.rows.filter(canAct).map(r=>r.worker.id)])])}>اختيار كل عمال الفريق</button>
   <button type="button" className="btn-primary" disabled={saving||!group.rows.some(canAct)} onClick={()=>decide(group.rows.filter(canAct),'approved')}>موافقة على الفريق</button>
   <button type="button" className="btn-secondary" disabled={saving||!group.rows.some(r=>canAct(r)&&selected.includes(r.worker.id))} onClick={()=>decide(group.rows.filter(r=>selected.includes(r.worker.id)),'approved')}>موافقة على المختارين</button>
   <button type="button" className="btn-secondary" disabled={saving||!group.rows.some(r=>canAct(r)&&selected.includes(r.worker.id))} onClick={()=>decide(group.rows.filter(r=>selected.includes(r.worker.id)),'rejected')}>رفض المختارين</button>
  </div><div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr>{['اختيار','العامل','كود الموظف','الفريق','أول بصمة أصلية','آخر بصمة أصلية','أول بصمة معتمدة','آخر بصمة معتمدة','بداية إضافي الأحد','الوقت المحسوب','وقت الإضافي المعتمد','سعر الإضافي','المبلغ المتوقع','الحالة','القرار'].map(h=><th className="border p-2 text-start" key={h}>{h}</th>)}</tr></thead>
  <tbody>{group.rows.map(r=>{const pay=calculateWeeklyOvertimePay({eveningOvertimeMinutes:minutesFor(r)||0,overtimeHourlyRate:r.hourly_rate})
   return <tr key={r.worker.id} data-sunday-ot-worker={r.worker.id}>
    <td><input type="checkbox" aria-label={r.worker.full_name} disabled={saving||!canAct(r)} checked={canAct(r)&&selected.includes(r.worker.id)} onChange={()=>setSelected(old=>old.includes(r.worker.id)?old.filter(id=>id!==r.worker.id):[...old,r.worker.id])}/></td>
    <td>{r.worker.full_name}</td><td>{r.worker.employee_code}</td><td>{r.worker.team_name}</td><td><bdi dir="ltr">{clock(r.evidence.first_at)}</bdi></td><td><bdi dir="ltr">{clock(r.evidence.last_at)}</bdi></td>
    {['first','last'].map((key)=><td key={key}><input className="input-base" dir="ltr" type="text" inputMode="text" placeholder="HH:mm:ss" aria-label={`${key==='first'?'أول':'آخر'} بصمة معتمدة ${r.worker.full_name}`} disabled={saving||r.locked} value={adjustments[r.worker.id]?.[key]??evidenceClock(r,key)} onChange={e=>editEvidence(r,key,e.target.value)}/></td>)}
    <td><bdi dir="ltr">{r.sunday_settings?.overtime_start||'14:00'}</bdi></td>
    <td><bdi dir="ltr">{duration(r.minutes)}</bdi></td>
    <td><input className="input-base" dir="ltr" aria-label={`الوقت المعتمد ${r.worker.full_name}`} disabled={saving||r.locked} value={adjustments[r.worker.id]?.duration??duration(r.approvedMinutes)} onChange={e=>setAdjustments(old=>({...old,[r.worker.id]:{...old[r.worker.id],duration:e.target.value}}))}/><input className="input-base" aria-label={`سبب التعديل ${r.worker.full_name}`} placeholder="سبب / ملاحظات" maxLength={1000} disabled={saving||r.locked} value={adjustments[r.worker.id]?.note||''} onChange={e=>setAdjustments(old=>({...old,[r.worker.id]:{...old[r.worker.id],note:e.target.value}}))}/></td>
    <td><bdi dir="ltr">{money(r.hourly_rate,r.currency)}</bdi></td><td><bdi dir="ltr">{money(pay.overtimePay,r.currency)}</bdi></td>
    <td>{labels[r.status]}{r.stale&&<small className="block">يحتاج مراجعة من جديد</small>}</td>
    <td><div className="sunday-ot-actions"><button type="button" className="btn-secondary" disabled={saving||r.locked} onClick={()=>saveEvidence(r)}>حفظ الدليل المعتمد</button><button type="button" className="btn-secondary" disabled={saving||r.locked||!r.approved_evidence} onClick={()=>saveEvidence(r,true)}>استرجاع من البصمة الأصلية</button><button type="button" className="btn-secondary" disabled={saving||!canAct(r)} onClick={()=>decide([r],'approved')}>موافقة</button> <button type="button" className="btn-secondary" disabled={saving||!canAct(r)} onClick={()=>decide([r],'rejected')}>رفض</button></div></td>
   </tr>})}</tbody></table></div></article>)}{!visible.length&&<p className="sunday-ot-empty" role="status">لا يوجد إضافي أحد مطابق للفلاتر الحالية</p>}
 </section>
}
