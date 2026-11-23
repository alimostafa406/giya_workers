import {useEffect,useState} from 'react'
import Modal from '../Modal/Modal'
import {getWorkerSundaySettings,saveWorkerSundaySettings} from '../../api/sundayPayrollApi'
import {getErrorMessage} from '../../api/axios'
import {currentBusinessDate} from '../../utils/payrollCalculations'
import {formatPayrollMoney} from '../../utils/payrollCurrency'
const timeFields=[['checkin_cutoff','آخر وقت دخول مقبول'],['shift_end','نهاية دوام الأحد'],['checkout_threshold','أقل وقت خروج مكتمل'],['overtime_start','بداية إضافي الأحد']]
export default function WorkerSundaySettingsModal({worker,onClose,onSaved}){
 const workerId=worker?.id
 const monthly=worker?.payment_type==='monthly',today=currentBusinessDate()
 const term=worker?.payroll_compensation_terms?.find(t=>t.payment_type===worker.payment_type&&t.effective_from<=today&&(!t.effective_to||t.effective_to>=today))
 const [values,setValues]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false)
 useEffect(()=>{let active=true;setValues(null);setError('');if(workerId)getWorkerSundaySettings(workerId).then(data=>{if(active)setValues(data)}).catch(e=>{if(active)setError(getErrorMessage(e))});return()=>{active=false}},[workerId])
 const set=(key,value)=>setValues(old=>({...old,[key]:value}))
 const save=async e=>{e.preventDefault();if(!values||saving)return;setSaving(true);setError('')
  try{await saveWorkerSundaySettings(worker.id,{...values,pay_multiplier:monthly?1:2,sunday_fixed_pay:monthly?values.sunday_fixed_pay??null:null,sunday_transport:values.sunday_transport??0,overtime_multiplier:values.overtime_multiplier??1},values.version||0);await onSaved();onClose()}catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}
 }
 return <Modal isOpen={Boolean(worker)} title={`إعدادات الأحد — ${worker?.full_name||''}`} onClose={()=>{if(!saving)onClose()}}>
  <p className="mb-3 text-sm text-(--muted)">إعدادات متكررة لكل أحد، تبدأ من الأحد القادم. التقارير والمدفوعات السابقة لا تتغير.</p>
  {error&&<p role="alert">{error}</p>}
  {values?<form onSubmit={save} className="space-y-3"><fieldset disabled={saving} className="space-y-3">
   <label className="flex gap-2"><input type="checkbox" checked={values.enabled} onChange={e=>set('enabled',e.target.checked)}/>يعمل يوم الأحد</label>
   <div className="grid grid-cols-2 gap-3">{timeFields.map(([key,label])=><label className="grid gap-1" key={key}>{label}<input type="time" className="input-base" required value={values[key]?.slice(0,5)||''} onChange={e=>set(key,e.target.value)}/></label>)}</div>
   <p className="text-sm font-bold">نوع القبض: {monthly?'شهري':'أسبوعي'} · طريقة قبض الأحد: {monthly?'مبلغ ثابت':'أجر اليوم × 2'}</p>
   {monthly?<label className="grid gap-1">قبض يوم الأحد<input type="number" className="input-base" min="0" step="0.01" value={values.sunday_fixed_pay??''} onChange={e=>set('sunday_fixed_pay',e.target.value)}/></label>:<p className="text-sm">أجر اليوم: <bdi dir="ltr">{term?.daily_rate!=null&&term?.currency_code?formatPayrollMoney(term.daily_rate,{currency:term.currency_code,paymentType:'weekly'}):'—'}</bdi></p>}
   {monthly&&(values.sunday_fixed_pay==null||values.sunday_fixed_pay==='')&&<p className="text-xs text-(--muted)">إعداد قبض الأحد مطلوب</p>}
   <p className="text-xs text-(--muted)">العملة: {term?.currency_code||'إعداد عملة التعويض مطلوب'}</p>
   <label className="grid gap-1">بدل نقل الأحد<input type="number" className="input-base" min="0" step="0.01" required value={values.sunday_transport??0} onChange={e=>set('sunday_transport',e.target.value)}/></label>
   <label className="grid gap-1">معامل إضافي الأحد<input type="number" className="input-base" min="0.001" max="10" step="0.001" required value={values.overtime_multiplier??1} onChange={e=>set('overtime_multiplier',e.target.value)}/></label>
   <label className="flex gap-2"><input type="checkbox" checked={values.overtime_requires_approval} onChange={e=>set('overtime_requires_approval',e.target.checked)}/>إضافي الأحد يحتاج موافقة</label>
   <p className="text-xs text-(--muted)">الصرف يبقى خاضعاً لمسار الإضافي المعتمد؛ هذا الإعداد لا يتجاوز موافقاته أو حماية الرواتب.</p>
   <label className="grid gap-1">ملاحظة<textarea className="input-base" maxLength={1000} value={values.note||''} onChange={e=>set('note',e.target.value)}/></label>
   {values.effective_from&&<p className="text-xs">ساري من: <bdi dir="ltr">{values.effective_from}</bdi></p>}
   <button className="btn-primary" type="submit">حفظ إعدادات الأحد</button>
  </fieldset></form>:!error&&<p role="status">جاري تحميل الإعدادات...</p>}
 </Modal>
}
