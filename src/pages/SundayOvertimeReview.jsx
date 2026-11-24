import {useEffect,useState} from 'react'
import {getBiometricOvertimeReviews} from '../api/biometricOvertimeReviewApi'
import {currentBusinessDate} from '../utils/payrollCalculations'
import {isSundayDate,latestSunday} from '../utils/sundayPayroll'
import {getErrorMessage} from '../api/axios'
import SundayOvertimeSection from '../components/Payroll/SundayOvertimeSection'

export default function SundayOvertimeReview(){
 const today=currentBusinessDate(),requested=new URLSearchParams(window.location.search).get('date')
 const [date,setDate]=useState(isSundayDate(requested)&&requested<=today?requested:latestSunday(today))
 const [sources,setSources]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0)
 useEffect(()=>{let active=true;setLoading(true);setSources([]);setError('')
  getBiometricOvertimeReviews(date).then(rows=>{if(active)setSources(rows)}).catch(e=>{if(active)setError(getErrorMessage(e))}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[date,reload])
 return <section dir="rtl" className="space-y-4"><h1 className="text-2xl font-bold">مراجعة إضافي الأحد</h1>
  <div className="surface-card flex flex-wrap gap-3 p-4"><label>تاريخ الأحد<input type="date" className="input-base" min="1970-01-04" step="7" max={today} value={date} onChange={e=>{
   if(!isSundayDate(e.target.value)||e.target.value>today){setError('اختر تاريخ أحد غير مستقبلي');return}
   setDate(e.target.value);window.history.replaceState(null,'',`?date=${e.target.value}`)
  }}/></label><a className="btn-secondary" href={`/payroll/sunday?date=${date}`}>تقرير أجور الأحد</a></div>
  {error&&<p role="alert">{error}</p>}{loading?<p role="status">جاري التحميل...</p>:<SundayOvertimeSection date={date} sources={sources} onSaved={async()=>setReload(n=>n+1)}/>}
 </section>
}
