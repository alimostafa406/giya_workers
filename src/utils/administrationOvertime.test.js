import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { weeklyPayoutLines } from './weeklyPayoutLines'
import { teamWeeklyReport } from './teamWeeklyReport'
import { biometricOvertimeMinutes, biometricReviewRows } from './biometricOvertimeReview'
import { overtimeEntryWorkers } from './overtimeEntry'
const week='2026-11-09',date='2026-11-13'
const fixture=(payment_type='monthly')=>{
 const worker={id:'ifaso',full_name:'IFASO',employee_code:'19',team_id:'office',team_name:'Adminstration',payment_type,is_active:true,
  payroll_compensation:{daily_rate:10000,monthly_salary:999999,currency_code:'CDF',daily_transport_allowance:0,overtime_rate_per_hour:3500}}
 const attendance={id:'a',worker_id:worker.id,attendance_date:date,status:'present',attendance_day_fraction:1,attendance_source:'biometric',manual_override:false,check_in:'07:51:49',check_out:'20:08:07'}
 return {workers:[worker],attendance:[attendance],rules:{},holidays:[],runs:[],payrollLines:[],weeklyOvertimeOverrides:[],biometricOvertimeReviews:[]}
}
it.each(['weekly','monthly'])('Administration %s manual daily/weekly and approved biometric use existing precedence once',payment_type=>{
 const d=fixture(payment_type),worker=d.workers[0],row=d.attendance[0]
 expect(overtimeEntryWorkers(d.workers,date)).toHaveLength(1)
 expect(biometricOvertimeMinutes(worker,row,date)).toBe(188)
 const source={worker,attendance:row,source_fingerprint:'fp',review:{decision:'approved',minutes:188,source_fingerprint:'fp',version:1}}
 expect(biometricReviewRows([source])).toHaveLength(1)
 d.biometricOvertimeReviews=[source]
 const line=weeklyPayoutLines(d,week)[0]
 expect(line.eveningOvertimeMinutes).toBe(188)
 expect(line.overtimeAmount).toBeCloseTo(10966.67,2)
 expect(line.baseAmount).toBe(payment_type==='monthly'?0:10000)
 expect(teamWeeklyReport(d,week).groups[0].totals.minutes).toBe(188)
 for(const decision of ['pending','rejected']){
  source.review.decision=decision
  expect(weeklyPayoutLines(d,week)[0].overtimeAmount).toBe(0)
 }
 source.review.decision='approved';source.review.source_fingerprint='old'
 expect(weeklyPayoutLines(d,week)[0].overtimeAmount).toBe(0)
 Object.assign(row,{manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:120})
 expect(weeklyPayoutLines(d,week)[0].overtimeAmount).toBe(7000)
 d.weeklyOvertimeOverrides=[{worker_id:worker.id,week_start:week,minutes:60,version:1}]
 const final=weeklyPayoutLines(d,week)[0]
 expect(final.overtimeAmount).toBe(3500)
 expect(final.finalAmount).toBe(final.baseAmount+3500)
 expect(teamWeeklyReport(d,week).totals.currencies.CDF.overtimeAmount).toBe(3500)
})
it.skipIf(!process.env.ADMINISTRATION_OT_AUDIT)('real Administration evidence and rolled-back RPC results reach payroll with the configured rate',()=>{
 const {data,expected}=JSON.parse(readFileSync(process.env.ADMINISTRATION_OT_AUDIT,'utf8'))
 const before=JSON.stringify(data),line=weeklyPayoutLines(data,week).find(l=>l.worker.id===expected.worker_id)
 expect(line).toBeTruthy()
 expect(line.baseAmount).toBe(0)
 expect(line.eveningOvertimeMinutes).toBe(188)
 expect(line.overtimeAmount).toBeCloseTo(10966.67,2)
 expect(teamWeeklyReport(data,week).lines.find(l=>l.worker.id===expected.worker_id).overtimeAmount).toBe(line.overtimeAmount)
 expect(JSON.stringify(data)).toBe(before)
})
