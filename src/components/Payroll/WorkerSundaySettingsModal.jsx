import {useEffect,useState} from 'react'
import Modal from '../Modal/Modal'
import {getWorkerSundaySettings,saveWorkerSundaySettings} from '../../api/sundayPayrollApi'
import {getErrorMessage} from '../../api/axios'
const timeFields=[['checkin_cutoff','آخر وقت دخول مقبول'],['shift_end','نهاية دوام الأحد'],['checkout_threshold','أقل وقت خروج مكتمل'],['overtime_start','بداية إضافي الأحد']]
export default function WorkerSundaySettingsModal({worker,onClose,onSaved}){
 const workerId=worker?.id
 const [values,setValues]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false)
 useEffect(()=>{let active=true;setValues(null);setError('');if(workerId)getWorkerSundaySettings(workerId).then(data=>{if(active)setValues(data)}).catch(e=>{if(active)setError(getErrorMessage(e))});return()=>{active=false}},[workerId])
 const set=(key,value)=>setValues(old=>({...old,[key]:value}))
 const save=async e=>{e.preventDefault();if(!values||saving)return;setSaving(true);setError('')
  try{await saveWorkerSundaySettings(worker.id,values,values.version||0);await onSaved();onClose()}catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}
 }
 return <Modal isOpen={Boolean(worker)} title={`إعدادات الأحد — ${worker?.full_name||''}`} onClose={()=>{if(!saving)onClose()}}>
  <p className="mb-3 text-sm text-(--muted)">إعدادات متكررة لكل أحد، تبدأ من الأحد القادم. التقارير والمدفوعات السابقة لا تتغير.</p>
  {error&&<p role="alert">{error}</p>}
  {values?<form onSubmit={save} className="space-y-3"><fieldset disabled={saving} className="space-y-3">
   <label className="flex gap-2"><input type="checkbox" checked={values.enabled} onChange={e=>set('enabled',e.target.checked)}/>يعمل يوم الأحد</label>
   <div className="grid grid-cols-2 gap-3">{timeFields.map(([key,label])=><label className="grid gap-1" key={key}>{label}<input type="time" className="input-base" required value={values[key]?.slice(0,5)||''} onChange={e=>set(key,e.target.value)}/></label>)}</div>
   <label className="grid gap-1">معامل أجر الأحد<input type="number" className="input-base" required min="0.001" max="10" step="0.001" value={values.pay_multiplier} onChange={e=>set('pay_multiplier',e.target.value)}/></label>
   <label className="flex gap-2"><input type="checkbox" checked={values.overtime_requires_approval} onChange={e=>set('overtime_requires_approval',e.target.checked)}/>إضافي الأحد يحتاج موافقة</label>
   <p className="text-xs text-(--muted)">الصرف يبقى خاضعاً لمسار الإضافي المعتمد؛ هذا الإعداد لا يتجاوز موافقاته أو حماية الرواتب.</p>
   <label className="grid gap-1">ملاحظة<textarea className="input-base" maxLength={1000} value={values.note||''} onChange={e=>set('note',e.target.value)}/></label>
   {values.effective_from&&<p className="text-xs">ساري من: <bdi dir="ltr">{values.effective_from}</bdi></p>}
   <button className="btn-primary" type="submit">حفظ إعدادات الأحد</button>
  </fieldset></form>:!error&&<p role="status">جاري تحميل الإعدادات...</p>}
 </Modal>
}
