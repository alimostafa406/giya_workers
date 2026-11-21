export const manualExceptionForDate=(rows,worker,date)=>{
 const matches=rows.filter(r=>String(r.worker_id)===String(worker.id)&&r.work_date===date&&r.status==='approved'&&r.manual_exception)
 if(matches.length>1)throw new Error('Duplicate manual overtime exception')
 return matches[0]?.manual_exception || null
}
export const manualExceptionDays=(days=[])=>days.filter(d=>d.manual_exception).map(d=>d.manual_exception)
export function manualExceptionAmounts(rates,days,minutes){
 const fullDay=Math.round(Number(days||0)*Number(rates?.daily_wage||0)*100)/100
 const hourly=Math.round(Number(minutes||0)*Number(rates?.hourly_rate||0)/60*100)/100
 return {fullDay,hourly,total:Math.round((fullDay+hourly)*100)/100}
}
