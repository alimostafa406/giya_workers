import { currentBusinessDate, monthlyDailyValue, sundayBefore } from './payrollCalculations'

export const isSundayDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && new Date(`${value}T12:00:00`).getDay() === 0
export function latestSunday(today = currentBusinessDate()) {
  const date = new Date(`${today}T12:00:00`)
  date.setDate(date.getDate() - date.getDay())
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
export function sundayReportRows(data, date, today = currentBusinessDate()) {
  if (!isSundayDate(date) || data?.date !== date) return []
  return (data.workers || []).flatMap(worker => {
    const attendance=(data.attendance || []).find(a=>a.worker_id===worker.id && a.attendance_date===date)
    const payment=(data.payments || []).find(p=>p.worker_id===worker.id && p.work_date===date)
    const decision=attendance?.biometric_sync_metadata?.supervisor_morning_review?.choice
    const conflict=['A','M'].includes(decision) || (attendance?.manual_override && attendance.status==='absent')
    const evidence=(data.sunday_evidence || []).find(e=>e.worker_id===worker.id)
    const present=evidence?.eligible===true && !conflict
    const punchCount=Math.max(0,Number(evidence?.punch_count)||0)
    const confirmed=payment && payment.payment_status!=='cancelled'
    const outsideEvidence=attendance?.attendance_source==='outside_work' && attendance.status==='present' && Number(attendance.attendance_day_fraction)>0
    if (!punchCount && !(evidence?.manual && present) && !outsideEvidence) return []
    const terms=(worker.payroll_compensation_terms || []).filter(t=>t.payment_type===worker.payment_type)
    const term=terms.find(t=>t.effective_from<=date && (!t.effective_to || t.effective_to>=date))
      || terms.find(t=>t.effective_from<=today && (!t.effective_to || t.effective_to>=today))
    const daily=confirmed?Number(payment.daily_value):worker.payment_type==='monthly'
      ? Number(term?.monthly_salary)>0 ? monthlyDailyValue(term.monthly_salary,data.rules?.monthly_working_day_divisor) : null :term?.daily_rate??null
    const currency=confirmed?payment.currency_code:term?.currency_code
    const amount=!present?0:confirmed?Number(payment.amount):daily==null?null:Math.round(Number(daily)*2*100)/100
    return [{worker,attendance,payment,present,evidence,punchCount,outsideEvidence,conflict,currency,daily,amount,netAmount:payment?.payment_status==='cancelled'?0:amount,
      multiplier:confirmed?Number(payment.multiplier):2,canConfirm:present && !confirmed && daily!=null && Boolean(currency)}]
  })
}

export function sundayReportTotals(rows){
 const totals={workers:rows.length,present:0,onePunch:0,twoPunch:0,currencies:{}}
 for(const row of rows){
  if(row.present)totals.present++
  if(row.punchCount===1)totals.onePunch++
  if(row.punchCount>=2)totals.twoPunch++
  const currency=row.currency||'UNCONFIGURED',previous=totals.currencies[currency]??0
  totals.currencies[currency]=totals.currencies[currency]===null||row.netAmount==null?null:Math.round((previous+row.netAmount)*100)/100
 }
 return totals
}
export function sundayTeamGroups(rows){
 const groups=new Map()
 for(const row of rows){const id=row.worker.team_id||'unassigned';if(!groups.has(id))groups.set(id,{id,name:row.worker.team_name||'',rows:[]});groups.get(id).rows.push(row)}
 return [...groups.values()].map(group=>({...group,totals:sundayReportTotals(group.rows)})).sort((a,b)=>a.name.localeCompare(b.name))
}

// Sunday belongs to the following six-day payroll. The ledger reservation is
// checked again atomically by the database when a Draft is saved.
export function applyWeeklySundayPay(line, data, monday) {
  const run=(data.runs || []).find(r=>r.payment_type==='weekly' && r.weekly_period_start===monday && r.status==='draft')
  const byId=new Map()
  for(const payment of data.sundayPayments || []) {
    if(payment.worker_id!==line.worker.id || payment.work_date!==sundayBefore(monday)
      || payment.payment_status!=='unpaid' || payment.payroll_eligible===false || payment.currency_code!==line.currency
      || (payment.settled_payroll_run_id && payment.settled_payroll_run_id!==run?.id)) continue
    byId.set(payment.id,{id:payment.id,worker_id:payment.worker_id,work_date:payment.work_date,amount:Number(payment.amount),currency_code:payment.currency_code})
  }
  const sundayPayments=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id))
  const sundayCarryAmount=Math.round(sundayPayments.reduce((sum,p)=>sum+p.amount,0)*100)/100
  return {...line,sundayPayments,sundayCarryAmount,
    bonusAmount:Number(line.bonusAmount || 0)-Number(line.sundayCarryAmount || 0)+sundayCarryAmount,
    finalAmount:Math.round((line.finalAmount-Number(line.sundayCarryAmount || 0)+sundayCarryAmount)*100)/100}
}
