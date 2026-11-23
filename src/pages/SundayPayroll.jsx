import {useEffect,useMemo,useRef,useState} from 'react'
import {getSundayPayroll,confirmSundayPayroll} from '../api/sundayPayrollApi'
import {getErrorMessage} from '../api/axios'
import {useTranslation} from '../i18n/LanguageContext'
import {currentBusinessDate} from '../utils/payrollCalculations'
import {formatPayrollMoney} from '../utils/payrollCurrency'
import {isSundayDate,latestSunday,sundayReportRows,sundayReportTotals,sundayTeamGroups} from '../utils/sundayPayroll'
import {finishPayrollPrint} from '../utils/teamReportPrintLayout'
import {teamReportPrintCss} from '../utils/teamWeeklyReport'
import sundayStyles from './SundayPayroll.css?inline'
import './TeamWeeklyReport.css'
import './SundayPayroll.css'

const labels={
 ar:{title:'عمل يوم الأحد',date:'تاريخ الأحد',team:'الفريق',all:'كل الفرق',search:'بحث بالاسم أو الكود...',print:'طباعة تقرير الأحد',worker:'العامل',code:'كود الموظف',punches:'عدد البصمات',checkIn:'بصمة الدخول',checkOut:'بصمة الخروج',attendance:'حالة الحضور',daily:'أجر اليوم',sundayPay:'أجر الأحد',net:'صافي الأحد',present:'حاضر',incomplete:'غير مكتمل',manual:'قرار يدوي معتمد',outside:'عمل خارجي FINAL',pending:'بانتظار الاعتماد',approved:'معتمد',paid:'مقبوض',cancelled:'ملغى',confirm:'اعتماد عمل الأحد',missing:'إعداد الأجر مطلوب',workers:'عدد عمال الأحد',presentCount:'عدد العمال الحاضرين',oneCount:'عدد العمال ببصمة واحدة',twoCount:'عدد العمال ببصمتين أو أكثر',teamTotal:'إجمالي أجر الأحد للفريق',grand:'الإجمالي العام للأحد',teamCount:'إجمالي الفرق',total:'إجمالي أجور الأحد',empty:'لا يوجد حضور يوم أحد مطابق',invalid:'اختر تاريخ أحد غير مستقبلي',note:'الأحد = ضعف أجر اليوم، دون إضافة دوبل آخر. الحساب الحالي لا يصرف تلقائياً؛ المعتمد فقط يدخل القبض الأسبوعي مرة واحدة.',loading:'جاري التحميل...',unknown:'بدون فريق',weekly:'أسبوعي',monthly:'شهري',protected:'قرار حضور محمي',single:'1 بصمة',double:'2 بصمتين',many:'بصمات'},
 en:{title:'Sunday work',date:'Sunday date',team:'Team',all:'All teams',search:'Search name or code...',print:'Print Sunday report',worker:'Worker',code:'Employee code',punches:'Punch count',checkIn:'Check-in',checkOut:'Checkout',attendance:'Attendance',daily:'Daily wage',sundayPay:'Sunday pay',net:'Sunday net',present:'Present',incomplete:'Incomplete',manual:'Authorized manual decision',outside:'FINAL outside work',pending:'Awaiting approval',approved:'Approved',paid:'Paid',cancelled:'Cancelled',confirm:'Approve Sunday work',missing:'Wage configuration required',workers:'Sunday workers',presentCount:'Present workers',oneCount:'One-punch workers',twoCount:'Workers with two or more punches',teamTotal:'Team Sunday total',grand:'Sunday grand total',teamCount:'Total teams',total:'Total Sunday payroll',empty:'No matching Sunday attendance',invalid:'Choose a non-future Sunday',note:'Sunday pays twice the daily wage, without another Double OT premium. This is a preview; only approved Sunday pay enters weekly payroll once.',loading:'Loading...',unknown:'Unassigned',weekly:'Weekly',monthly:'Monthly',protected:'Protected attendance decision',single:'1 punch',double:'2 punches',many:'punches'},
 fr:{title:'Travail du dimanche',date:'Date du dimanche',team:'Équipe',all:'Toutes les équipes',search:'Rechercher nom ou code...',print:'Imprimer le dimanche',worker:'Travailleur',code:'Code employé',punches:'Pointages',checkIn:'Entrée',checkOut:'Sortie',attendance:'Présence',daily:'Salaire journalier',sundayPay:'Paie du dimanche',net:'Net dimanche',present:'Présent',incomplete:'Incomplet',manual:'Décision manuelle autorisée',outside:'Travail extérieur FINAL',pending:'À approuver',approved:'Approuvé',paid:'Payé',cancelled:'Annulé',confirm:'Approuver le dimanche',missing:'Salaire à configurer',workers:'Travailleurs du dimanche',presentCount:'Travailleurs présents',oneCount:'Un seul pointage',twoCount:'Deux pointages ou plus',teamTotal:'Total dimanche équipe',grand:'Total général du dimanche',teamCount:'Total équipes',total:'Paie totale du dimanche',empty:'Aucune présence du dimanche correspondante',invalid:'Choisissez un dimanche non futur',note:'Le dimanche paie deux fois le salaire journalier, sans autre prime double. Aperçu : seuls les montants approuvés entrent une seule fois dans la paie hebdomadaire.',loading:'Chargement...',unknown:'Sans équipe',weekly:'Hebdomadaire',monthly:'Mensuel',protected:'Décision de présence protégée',single:'1 pointage',double:'2 pointages',many:'pointages'},
}
const columns=['worker','code','punches','checkIn','checkOut','attendance','daily','sundayPay','net']
const widths=[18,7,9,10,10,14,10,11,11]
const money=(amount,currency)=>amount==null?'—':!currency||currency==='UNCONFIGURED'?(Number(amount)===0?'0':'—'):formatPayrollMoney(amount,{currency,paymentType:'weekly'})
const clock=value=>value?String(value).slice(0,5):'—'
function Amounts({totals}){return Object.entries(totals.currencies).map(([currency,amount])=><bdi dir="ltr" className="block" key={currency}>{money(amount,currency)}</bdi>)}
export default function SundayPayroll(){
 const {language,direction}=useTranslation(),l=labels[language]||labels.en
 const today=currentBusinessDate(),initial=new URLSearchParams(window.location.search).get('date')
 const [date,setDate]=useState(isSundayDate(initial)&&initial<=today?initial:latestSunday(today))
 const [team,setTeam]=useState(''),[search,setSearch]=useState(''),[data,setData]=useState(null)
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false),[reload,setReload]=useState(0)
 const report=useRef(null)
 useEffect(()=>{let active=true;setLoading(true);setError('');setData(null)
  getSundayPayroll(date).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(getErrorMessage(e))}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[date,reload])
 const rows=useMemo(()=>sundayReportRows(data,date),[data,date])
 const teams=sundayTeamGroups(rows)
 const visible=rows.filter(row=>(!team||(row.worker.team_id||'unassigned')===team)&&`${row.worker.full_name} ${row.worker.employee_code}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
 const groups=sundayTeamGroups(visible),totals=sundayReportTotals(visible)
 const punchLabel=count=>count===1?l.single:count===2?l.double:count>2?`${count} ${l.many}`:'—'
 const approve=async row=>{setSaving(true);setError('');try{await confirmSundayPayroll(row,date);setReload(n=>n+1)}catch(e){setError(getErrorMessage(e))}finally{setSaving(false)}}
 const print=()=>{const popup=window.open('','_blank');if(!popup)return
  const content=report.current.cloneNode(true);content.querySelectorAll('button').forEach(n=>n.remove())
  popup.document.write(`<!doctype html><html lang="${language}" dir="${direction}"><head><meta charset="utf-8"><title>${l.title}</title><style>${teamReportPrintCss}\n${sundayStyles}</style></head><body>${content.outerHTML}</body></html>`)
  popup.document.close();finishPayrollPrint(popup)
 }
 return <section lang={language} dir={direction} className="team-weekly-report sunday-payroll">
  <h1 className="text-2xl font-bold">{l.title}</h1>
  <div className="team-report-controls surface-card">
   <label>{l.date}<input className="input-base" type="date" step="7" min="1970-01-04" max={today} value={date} onChange={e=>{if(!isSundayDate(e.target.value)||e.target.value>today){setError(l.invalid);return}setTeam('');setDate(e.target.value)}}/></label>
   <label>{l.team}<select className="input-base" value={team} onChange={e=>setTeam(e.target.value)}><option value="">{l.all}</option>{teams.map(group=><option key={group.id} value={group.id}>{group.name||l.unknown}</option>)}</select></label>
   <input className="input-base" type="search" aria-label={l.search} placeholder={l.search} value={search} onChange={e=>setSearch(e.target.value)}/>
   <button type="button" className="btn-primary" disabled={loading||!visible.length} onClick={print}>{l.print}</button>
  </div>
  {loading&&<p role="status">{l.loading}</p>}{error&&<p role="alert">{error}</p>}
  <div ref={report} className="team-report-all sunday-report">
   <header className="team-report-header sunday-report-heading"><h2>{l.title}</h2><p>{l.date}: <bdi dir="ltr">{date}</bdi></p><p>{l.note}</p></header>
   {groups.map(group=><article className="team-report-content sunday-team" key={group.id} data-team={group.id}>
    <header className="team-report-header"><h2>{group.name||l.unknown}</h2><p>{l.workers}: {group.totals.workers}</p></header>
    <div className="overflow-x-auto"><table><colgroup>{widths.map((width,i)=><col key={i} style={{width:`${width}%`}}/>)}</colgroup>
     <thead><tr>{columns.map(key=><th key={key}>{l[key]}</th>)}</tr></thead>
     <tbody>{group.rows.map(row=><tr key={row.worker.id} data-worker={row.worker.id}>
      <td>{row.worker.full_name}<small className="block">{row.worker.payment_type==='monthly'?l.monthly:l.weekly}</small></td>
      <td>{row.worker.employee_code}</td><td>{punchLabel(row.punchCount)}</td>
      <td><bdi dir="ltr">{clock(row.evidence?.display_check_in||(row.punchCount>1?row.evidence?.first_punch:null))}</bdi></td><td><bdi dir="ltr">{clock(row.evidence?.display_check_out)}</bdi></td>
      <td>{row.present?l.present:l.incomplete}{row.evidence?.manual&&<small className="block">{row.present?l.manual:l.protected}</small>}{row.outsideEvidence&&<small className="block">{l.outside}</small>}</td>
      <td><bdi dir="ltr">{money(row.daily,row.currency)}</bdi></td><td><bdi dir="ltr">{money(row.amount,row.currency)}</bdi></td>
      <td><strong><bdi dir="ltr">{money(row.netAmount,row.currency)}</bdi></strong>
       {row.present&&<small className="block">{row.payment?.payment_status==='paid'?l.paid:row.payment?.payment_status==='cancelled'?l.cancelled:row.payment?l.approved:row.daily==null?l.missing:l.pending}</small>}
       {row.canConfirm&&<button className="btn-secondary sunday-approve" type="button" disabled={saving} onClick={()=>approve(row)}>{l.confirm}</button>}
      </td>
     </tr>)}</tbody>
     <tfoot><tr className="team-report-total-row"><th colSpan="6"><span>{l.presentCount}: {group.totals.present}</span><span>{l.oneCount}: {group.totals.onePunch}</span><span>{l.twoCount}: {group.totals.twoPunch}</span></th><th colSpan="2">{l.teamTotal}</th><td><Amounts totals={group.totals}/></td></tr></tfoot>
    </table></div>
   </article>)}
   {!loading&&!groups.length&&<p>{l.empty}</p>}
   {groups.length>0&&<section className="team-report-content sunday-grand"><h2>{l.grand}</h2><table><thead><tr>{['teamCount','workers','oneCount','twoCount','total'].map(key=><th key={key}>{l[key]}</th>)}</tr></thead><tbody><tr><td>{groups.length}</td><td>{totals.workers}</td><td>{totals.onePunch}</td><td>{totals.twoPunch}</td><td><strong><Amounts totals={totals}/></strong></td></tr></tbody></table></section>}
  </div>
 </section>
}
