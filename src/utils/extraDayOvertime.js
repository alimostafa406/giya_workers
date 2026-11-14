export const extraDayLabels = {ar:{days:'أيام إضافية',amount:'مبلغ الأيام الإضافية'},fr:{days:'Jours supplémentaires',amount:'Prime jours supplémentaires'},en:{days:'Extra days',amount:'Extra-day premium'}}
export function approvedExtraDays(worker, dates, rows = []) {
  const byDate = new Map()
  for (const row of rows) {
    if (String(row.worker_id)!==String(worker.id) || !dates.includes(row.work_date) || row.status!=='approved'
      || !row.source?.qualified || row.source.fingerprint!==row.review?.source_fingerprint || !row.payroll_source) continue
    if (byDate.has(row.work_date)) throw new Error('Duplicate approved extra day')
    byDate.set(row.work_date,row.payroll_source)
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))
}
export function applyExtraDayPremium(line, rows = []) {
  const extraDayPremiums=approvedExtraDays(line.worker,(line.details||[]).map(d=>d.date),rows)
  if (extraDayPremiums.some(p=>p.currency!==line.currency)) return {...line,extraDayPremiums,extraDays:extraDayPremiums.length,extraDayAmount:0,extraDayConflict:true}
  const extraDayAmount=Math.round(extraDayPremiums.reduce((sum,p)=>sum+Number(p.amount),0)*100)/100
  return {...line,extraDayPremiums,extraDays:extraDayPremiums.length,extraDayAmount,
    bonusAmount:Number(line.bonusAmount||0)-Number(line.extraDayAmount||0)+extraDayAmount,
    finalAmount:Math.round((Number(line.finalAmount)-Number(line.extraDayAmount||0)+extraDayAmount)*100)/100}
}
