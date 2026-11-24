import {useEffect,useMemo,useRef,useState} from 'react'
import {getSundayPayroll} from '../api/sundayPayrollApi'
import {getErrorMessage} from '../api/axios'
import {useTranslation} from '../i18n/LanguageContext'
import {currentBusinessDate} from '../utils/payrollCalculations'
import {formatPayrollMoney} from '../utils/payrollCurrency'
import {isSundayDate,latestSunday,sundayReportRows,sundayReportTotals,sundayTeamGroups} from '../utils/sundayPayroll'
import {finishPayrollPrint} from '../utils/teamReportPrintLayout'
import {payrollRenderedPrintCss} from '../utils/printRenderedPayroll'
import PayrollSheetFrame,{PayrollWorkerIdentity,payrollSheetClasses as sheet} from '../components/Payroll/PayrollSheetFrame'
import {biometricReviewRows,formatBiometricOvertimeDuration} from '../utils/biometricOvertimeReview'
import {saveSundayEvidence} from '../api/biometricOvertimeReviewApi'
import {approvedSundayClock,sundayInlineDraft,sundayInlinePayload} from '../utils/sundayApprovedEvidence'
import SundayInlineValue from '../components/Payroll/SundayInlineValue'
import {subscribeSundayEvidenceUpdates} from '../utils/sundayEvidenceUpdates'
import WorkerSundaySettingsModal from '../components/Payroll/WorkerSundaySettingsModal'
import './SundayPayroll.css'

const labels={
 ar:{title:'عمل يوم الأحد',date:'تاريخ الأحد',team:'الفريق',all:'كل الفرق',search:'بحث بالاسم أو الكود...',print:'طباعة تقرير الأحد',worker:'العامل',code:'كود الموظف',punches:'عدد البصمات',checkIn:'بصمة الدخول',checkOut:'بصمة الخروج',attendance:'حالة الحضور',daily:'أجر اليوم',sundayPay:'أجر الأحد',net:'صافي الأحد',present:'حاضر',incomplete:'غير مكتمل',manual:'قرار يدوي معتمد',outside:'عمل خارجي FINAL',pending:'بانتظار الاعتماد',approved:'معتمد',paid:'مقبوض',cancelled:'ملغى',confirm:'اعتماد عمل الأحد',missing:'إعداد الأجر مطلوب',workers:'عدد عمال الأحد',presentCount:'عدد العمال الحاضرين',oneCount:'عدد العمال ببصمة واحدة',twoCount:'عدد العمال ببصمتين أو أكثر',teamTotal:'إجمالي أجر الأحد للفريق',grand:'الإجمالي العام للأحد',teamCount:'إجمالي الفرق',total:'إجمالي أجور الأحد',empty:'لا يوجد حضور يوم أحد مطابق',invalid:'اختر تاريخ أحد غير مستقبلي',note:'الأحد = ضعف أجر اليوم، دون إضافة دوبل آخر. الحساب الحالي لا يصرف تلقائياً؛ المعتمد فقط يدخل القبض الأسبوعي مرة واحدة.',loading:'جاري التحميل...',unknown:'بدون فريق',weekly:'أسبوعي',monthly:'شهري',protected:'قرار حضور محمي',single:'1 بصمة',double:'2 بصمتين',many:'بصمات'},
 en:{title:'Sunday work',date:'Sunday date',team:'Team',all:'All teams',search:'Search name or code...',print:'Print Sunday report',worker:'Worker',code:'Employee code',punches:'Punch count',checkIn:'Check-in',checkOut:'Checkout',attendance:'Attendance',daily:'Daily wage',sundayPay:'Sunday pay',net:'Sunday net',present:'Present',incomplete:'Incomplete',manual:'Authorized manual decision',outside:'FINAL outside work',pending:'Awaiting approval',approved:'Approved',paid:'Paid',cancelled:'Cancelled',confirm:'Approve Sunday work',missing:'Wage configuration required',workers:'Sunday workers',presentCount:'Present workers',oneCount:'One-punch workers',twoCount:'Workers with two or more punches',teamTotal:'Team Sunday total',grand:'Sunday grand total',teamCount:'Total teams',total:'Total Sunday payroll',empty:'No matching Sunday attendance',invalid:'Choose a non-future Sunday',note:'Sunday pays twice the daily wage, without another Double OT premium. This is a preview; only approved Sunday pay enters weekly payroll once.',loading:'Loading...',unknown:'Unassigned',weekly:'Weekly',monthly:'Monthly',protected:'Protected attendance decision',single:'1 punch',double:'2 punches',many:'punches'},
 fr:{title:'Travail du dimanche',date:'Date du dimanche',team:'Équipe',all:'Toutes les équipes',search:'Rechercher nom ou code...',print:'Imprimer le dimanche',worker:'Travailleur',code:'Code employé',punches:'Pointages',checkIn:'Entrée',checkOut:'Sortie',attendance:'Présence',daily:'Salaire journalier',sundayPay:'Paie du dimanche',net:'Net dimanche',present:'Présent',incomplete:'Incomplet',manual:'Décision manuelle autorisée',outside:'Travail extérieur FINAL',pending:'À approuver',approved:'Approuvé',paid:'Payé',cancelled:'Annulé',confirm:'Approuver le dimanche',missing:'Salaire à configurer',workers:'Travailleurs du dimanche',presentCount:'Travailleurs présents',oneCount:'Un seul pointage',twoCount:'Deux pointages ou plus',teamTotal:'Total dimanche équipe',grand:'Total général du dimanche',teamCount:'Total équipes',total:'Paie totale du dimanche',empty:'Aucune présence du dimanche correspondante',invalid:'Choisissez un dimanche non futur',note:'Le dimanche paie deux fois le salaire journalier, sans autre prime double. Aperçu : seuls les montants approuvés entrent une seule fois dans la paie hebdomadaire.',loading:'Chargement...',unknown:'Sans équipe',weekly:'Hebdomadaire',monthly:'Mensuel',protected:'Décision de présence protégée',single:'1 pointage',double:'2 pointages',many:'pointages'},
}
Object.assign(labels.ar,{title:'تقرير أجور الأحد',attendance:'الحضور',checkIn:'الدخول',checkOut:'الخروج',overtime:'الإضافي',overtimePay:'مبلغ الإضافي',status:'الحالة',baseTotal:'إجمالي أجر الأحد',overtimeTotal:'إجمالي مبلغ الإضافي',netTotal:'صافي الفريق',otPending:'إضافي بانتظار المراجعة',note:'دوام الأحد 08:00–14:00؛ اكتمال الخروج من 13:30. أجر الأحد ضعف أجر اليوم، والإضافي المعتمد منفصل ولا يُعتمد تلقائياً.'})
Object.assign(labels.en,{title:'Sunday payroll report',overtime:'Overtime',overtimePay:'OT amount',status:'Status',baseTotal:'Sunday base total',overtimeTotal:'Overtime total',netTotal:'Team net',otPending:'Overtime awaiting review',note:'Sunday shift 08:00–14:00; completion checkout from 13:30. Sunday base is twice the daily wage. Approved hourly overtime is separate; never approved automatically.'})
Object.assign(labels.fr,{title:'Rapport de paie du dimanche',overtime:'Supplément',overtimePay:'Montant suppl.',status:'État',baseTotal:'Total dimanche',overtimeTotal:'Total supplément',netTotal:'Net équipe',otPending:'Supplément à examiner',note:'Dimanche 08:00–14:00 ; sortie complète dès 13:30. Base double et supplément approuvé séparés, sans approbation automatique.'})
Object.assign(labels.ar,{note:'دخول الأحد الافتراضي من 08:00 حتى 08:35 شاملاً، والخروج من 13:30. إعدادات العامل الخاصة لها الأولوية. قبض الأحد حسب قاعدة الأجر المطبقة، والإضافي بعد نهاية الدوام يتطلب الاعتماد المعتاد.'})
Object.assign(labels.en,{note:'Default Sunday arrival 08:00–08:35 inclusive; final checkout from 13:30. Custom worker settings take precedence. Sunday pay follows the applicable wage rule; hourly overtime requires normal approval.'})
Object.assign(labels.fr,{note:'Entrée du dimanche par défaut de 08:00 à 08:35 inclus ; sortie dès 13:30. Les réglages individuels sont prioritaires. La paie suit la règle applicable ; le supplément nécessite son approbation habituelle.'})
Object.assign(labels.ar,{checkIn:'البصمة الصباحية',checkOut:'آخر بصمة',sundayPay:'قبض الأحد',overtimePay:'إضافي الأحد',net:'الصافي',baseTotal:'إجمالي قبض الأحد',overtimeTotal:'إجمالي إضافي الأحد',netTotal:'صافي الفريق',total:'الإجمالي الصافي'})
Object.assign(labels.en,{checkIn:'Morning punch',checkOut:'Final punch',sundayPay:'Sunday pay',overtimePay:'Sunday overtime',net:'Net',baseTotal:'Total Sunday pay',overtimeTotal:'Total Sunday overtime',total:'Grand net'})
Object.assign(labels.fr,{checkIn:'Pointage du matin',checkOut:'Dernier pointage',sundayPay:'Paie du dimanche',overtimePay:'Supplément dimanche',net:'Net',baseTotal:'Total paie dimanche',overtimeTotal:'Total supplément dimanche',total:'Net général'})
Object.assign(labels.ar,{sundayTransport:'نقل الأحد',missingSundayPay:'إعداد قبض الأحد مطلوب'})
Object.assign(labels.en,{sundayTransport:'Sunday transport',missingSundayPay:'Sunday pay configuration required'})
Object.assign(labels.fr,{sundayTransport:'Transport dimanche',missingSundayPay:'Paie du dimanche à configurer'})
Object.assign(labels.ar,{overtimeTime:'وقت إضافي الأحد',overtimePay:'مبلغ إضافي الأحد',otPending:'بانتظار المراجعة'})
Object.assign(labels.en,{overtimeTime:'Sunday OT time',overtimePay:'Sunday OT amount',otPending:'Awaiting review'})
Object.assign(labels.fr,{overtimeTime:'Durée suppl. dimanche',overtimePay:'Montant suppl. dimanche',otPending:'À examiner'})
const columns=['worker','checkIn','checkOut','sundayPay','sundayTransport','overtimeTime','overtimePay','net']
const widths=[20,10,10,12,12,12,12,12]
const duration=value=>value>0?formatBiometricOvertimeDuration(value):'—'
const money=(amount,currency)=>amount==null?'—':!currency||currency==='UNCONFIGURED'?(Number(amount)===0?'0':'—'):formatPayrollMoney(amount,{currency,paymentType:'weekly'})
const clock=value=>value?String(value).slice(0,5):'—'
function Amounts({totals,family='currencies'}){return Object.entries(totals[family]).map(([currency,amount])=><bdi dir="ltr" className="block" key={currency}>{money(amount,currency)}</bdi>)}
function SundayTotalRow({totals,label}){
 return <tr className={sheet.totalRow}><th scope="row" className="px-3 py-3 text-start whitespace-nowrap">{label}</th><td className={sheet.cell}>—</td><td className={sheet.cell}>—</td><td className={`${sheet.cell} whitespace-nowrap`}><Amounts totals={totals} family="baseCurrencies"/></td><td className={`${sheet.cell} whitespace-nowrap`}><Amounts totals={totals} family="transportCurrencies"/></td><td className={sheet.cell}>—</td><td className={`${sheet.cell} whitespace-nowrap`}><Amounts totals={totals} family="overtimeCurrencies"/></td><td className={`${sheet.cell} whitespace-nowrap`}><Amounts totals={totals}/></td></tr>
}
export default function SundayPayroll(){
 const {language,direction}=useTranslation(),l=labels[language]||labels.en
 const today=currentBusinessDate(),initial=new URLSearchParams(window.location.search).get('date')
 const [date,setDate]=useState(isSundayDate(initial)&&initial<=today?initial:latestSunday(today))
 const [team,setTeam]=useState(''),[search,setSearch]=useState(''),[data,setData]=useState(null)
 const [loading,setLoading]=useState(true),[error,setError]=useState('')
 const [saving,setSaving]=useState(false)
 const [settingsWorker,setSettingsWorker]=useState(null)
 const report=useRef(null)
 useEffect(()=>{let active=true;setLoading(true);setError('');setData(null)
  getSundayPayroll(date).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(getErrorMessage(e))}).finally(()=>{if(active)setLoading(false)})
  const unsubscribe=subscribeSundayEvidenceUpdates(date,()=>getSundayPayroll(date).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(getErrorMessage(e))}))
  return()=>{active=false;unsubscribe()}
 },[date])
 const rows=useMemo(()=>sundayReportRows(data,date),[data,date])
 const teams=sundayTeamGroups(rows)
 const visible=rows.filter(row=>(!team||(row.worker.team_id||'unassigned')===team)&&`${row.worker.full_name} ${row.worker.employee_code}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
 const groups=sundayTeamGroups(visible),totals=sundayReportTotals(visible)
 const editSource=row=>{
  const source=(data?.sundayEvidenceEditSources||data?.biometricOvertimeReviews||[]).find(s=>String(s.worker.id)===String(row.worker.id))
  return source&&(biometricReviewRows([source])[0]||{...source,approvedMinutes:Number(source.suggested_approved_minutes??source.raw_minutes??0)})
 }
 const saveCell=async(row,key,value)=>{
  const source=editSource(row);if(!source||source.locked||saving)return false
  try{
   const payload=sundayInlinePayload(source,date,sundayInlineDraft(source,date,key,value))
   setSaving(true);setError('');await saveSundayEvidence(date,source,payload)
   setData(await getSundayPayroll(date));return true
  }catch(e){setError(getErrorMessage(e));return false}finally{setSaving(false)}
 }
 const print=()=>{const popup=window.open('','_blank');if(!popup)return
  const content=report.current.cloneNode(true);content.querySelectorAll('button').forEach(n=>n.replaceWith(...n.childNodes))
  content.querySelectorAll('[data-inline-print]').forEach(n=>n.replaceWith(document.createTextNode(n.getAttribute('data-inline-print'))))
  content.querySelectorAll('table').forEach(table=>{table.removeAttribute('class');table.querySelectorAll('[class]').forEach(node=>node.removeAttribute('class'))})
  popup.document.write(`<!doctype html><html lang="${language}" dir="${direction}"><head><meta charset="utf-8"><title>${l.title}</title><style>${payrollRenderedPrintCss}\n.sunday-report{display:block}.sunday-team,.sunday-grand{margin:0;padding:0}.sunday-team header{margin-bottom:2mm}.sunday-team .overflow-x-auto{overflow:visible}.surface-card{border:0;box-shadow:none}</style></head><body>${content.outerHTML}</body></html>`)
  popup.document.close();finishPayrollPrint(popup)
 }
 return <section lang={language} dir={direction} className="space-y-4 sunday-payroll">
  <h1 className="text-2xl font-bold">{l.title}</h1>
  <div className="surface-card flex flex-wrap items-end gap-3 p-4">
   <label>{l.date}<input className="input-base" type="date" step="7" min="1970-01-04" max={today} value={date} disabled={saving} onChange={e=>{if(!isSundayDate(e.target.value)||e.target.value>today){setError(l.invalid);return}setTeam('');setDate(e.target.value)}}/></label>
   <label>{l.team}<select className="input-base" value={team} onChange={e=>setTeam(e.target.value)}><option value="">{l.all}</option>{teams.map(group=><option key={group.id} value={group.id}>{group.name||l.unknown}</option>)}</select></label>
   <input className="input-base" type="search" aria-label={l.search} placeholder={l.search} value={search} onChange={e=>setSearch(e.target.value)}/>
   <button type="button" className="btn-primary" disabled={loading||saving||!visible.length} onClick={print}>{l.print}</button>
   <a className="btn-primary" href={`/payroll/sunday-overtime?date=${date}`}>إضافي الأحد</a>
  </div>
  {loading&&<p role="status">{l.loading}</p>}{error&&<p role="alert">{error}</p>}
  <div ref={report} className="team-report-all sunday-report">
   <header className="team-report-header sunday-report-heading"><h2>{l.title}</h2><p>{l.date}: <bdi dir="ltr">{date}</bdi></p><p>{l.note}</p></header>
   {groups.map(group=><article className="team space-y-3 sunday-team" key={group.id} data-team={group.id}>
    <header className="mb-3 rounded-xl bg-slate-50 p-4 text-sm"><h2 className="font-extrabold">{group.name||l.unknown}</h2></header>
    <PayrollSheetFrame variant="sunday"><colgroup>{widths.map((width,i)=><col key={i} style={{width:`${width}%`}}/>)}</colgroup>
     <thead className="bg-slate-50/90"><tr>{columns.map(key=><th className={key==='worker'?'px-3 py-2.5 text-start text-xs font-extrabold text-(--muted)':sheet.header} key={key}>{l[key]}</th>)}</tr></thead>
     <tbody>{group.rows.map(row=>{const source=editSource(row),disabled=saving||!source||source.locked;return <tr className={sheet.row} key={row.worker.id} data-worker={row.worker.id}>
      <td className="px-3 py-2.5"><button type="button" className="text-start hover:underline" onClick={()=>setSettingsWorker(row.worker)}><PayrollWorkerIdentity worker={row.worker}/></button>{row.worker.sunday_settings_custom&&<small className="block text-xs text-(--muted)">إعدادات خاصة</small>}
       {!row.present&&<small className="block">{l.incomplete}</small>}
       {row.missingSundayPay?<small className="block">{l.missingSundayPay}</small>:row.present&&!row.fixedMonthly&&row.daily==null&&<small className="block">{l.missing}</small>}
       {row.evidence?.manual&&<small className="block">{row.present?l.manual:l.protected}</small>}
      </td>
      <td className={sheet.cell}><SundayInlineValue label={`${l.checkIn} ${row.worker.full_name}`} value={clock(row.evidence?.display_check_in||(row.punchCount>1?row.evidence?.first_punch:null))} editValue={row.evidence?.display_check_in?approvedSundayClock(source||{},'first'):''} disabled={disabled} onSave={value=>saveCell(row,'first',value)}/></td><td className={sheet.cell}><SundayInlineValue label={`${l.checkOut} ${row.worker.full_name}`} value={clock(row.evidence?.admin_evidence_override?row.evidence?.display_check_out:row.evidence?.last_punch||row.evidence?.display_check_out)} editValue={approvedSundayClock(source||{},'last')} disabled={disabled} onSave={value=>saveCell(row,'last',value)}/></td>
      <td className={`${sheet.cell} font-bold`}><bdi dir="ltr">{money(row.amount,row.currency)}</bdi></td>
      <td className={sheet.cell}><bdi dir="ltr">{money(row.transportAmount,row.currency)}</bdi></td>
      <td className={`${sheet.cell} font-bold`}><SundayInlineValue label={`${l.overtimeTime} ${row.worker.full_name}`} value={duration(row.displayOvertimeMinutes)} editValue={formatBiometricOvertimeDuration(source?.approvedMinutes||0)} disabled={disabled} onSave={value=>saveCell(row,'duration',value)}/>{row.candidateMinutes>0&&!row.overtimeMinutes&&row.overtimeReviewStatus!=='rejected'&&<small className="block text-xs font-normal text-(--muted)">{l.otPending}</small>}</td>
      <td className={`${sheet.cell} font-bold`}><bdi dir="ltr">{row.overtimeMinutes>0?money(row.overtimeAmount,row.currency):'—'}</bdi></td>
      <td className={`${sheet.cell} font-extrabold`}><bdi dir="ltr">{money(row.netAmount,row.currency)}</bdi></td>
     </tr>})}</tbody>
     <tfoot className={sheet.total}><SundayTotalRow totals={group.totals} label={({ar:'إجمالي الفريق',en:'Team total',fr:'Total équipe'})[language]||'Team total'}/></tfoot>
    </PayrollSheetFrame>
   </article>)}
   {!loading&&!groups.length&&<p>{l.empty}</p>}
   {groups.length>0&&<section className="team space-y-3 sunday-grand"><h2 className="font-extrabold">{l.grand}</h2><PayrollSheetFrame variant="summary"><colgroup>{widths.map((width,i)=><col key={i} style={{width:`${width}%`}}/>)}</colgroup><thead className="bg-slate-50/90"><tr>{columns.map(key=><th className={sheet.header} key={key}>{l[key]}</th>)}</tr></thead><tbody className={sheet.total}><SundayTotalRow totals={totals} label={({ar:'الإجمالي العام',en:'Grand total',fr:'Total général'})[language]||'Grand total'}/></tbody></PayrollSheetFrame></section>}
  </div>
  <WorkerSundaySettingsModal worker={settingsWorker} onClose={()=>setSettingsWorker(null)} onSaved={async()=>setData(await getSundayPayroll(date))}/>
 </section>
}
