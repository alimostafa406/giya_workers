import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('../lib/supabase',()=>({getSupabaseClient:vi.fn()}))
import { calculateWeeklyPayoutLine } from './weeklyPayoutLines'
import { biometricReviewRows, approvedBiometricOvertime } from './biometricOvertimeReview'
import { teamWeeklyReport } from './teamWeeklyReport'
const date='2026-11-20',week='2026-11-16'
const worker={id:'w',full_name:'Worker',employee_code:'1',team_id:'t',team_name:'Team',is_active:true,payment_type:'weekly',staff_classification:'normal',payroll_compensation:{daily_rate:20000,daily_transport_allowance:0,currency_code:'CDF',overtime_rate_per_hour:2000}}
const attendance={id:'a',worker_id:'w',attendance_date:date,status:'present',attendance_day_fraction:1,attendance_source:'biometric',check_in:'08:00',check_out:'00:31:44',canonical_final_checkout_at:'2026-11-21T00:31:44+01:00'}
it.each(['pending','rejected','approved'])('midnight %s never pays hourly OT, while premium still requires approval',decision=>{
 const entry={worker,attendance,midnight_double_ot:true,extra_day_review_blocked:true,extra_day_payable:decision==='approved'}
 expect(biometricReviewRows([entry])).toEqual([]);expect(approvedBiometricOvertime(worker,{date,row:attendance},[entry])).toBeNull()
 const data={workers:[worker],attendance:[attendance],rules:{},biometricOvertimeReviews:[entry],extraDayReviews:decision==='approved'?[{worker_id:'w',work_date:date,status:'approved',source:{qualified:true,fingerprint:'fp'},review:{source_fingerprint:'fp'},payroll_source:{date,amount:20000,currency:'CDF',extra_days:1}}]:[]}
 const line=calculateWeeklyPayoutLine(data,week,worker)
 expect(line.overtimeAmount).toBe(0);expect(line.eveningOvertimeMinutes).toBe(0);expect(line.extraDayAmount).toBe(decision==='approved'?20000:0)
 expect(line.finalAmount).toBe(decision==='approved'?40000:20000)
 const conflicting=calculateWeeklyPayoutLine({...data,weeklyOvertimeOverrides:[{worker_id:'w',minutes:450}]},week,worker)
 expect(conflicting.extraDayConflict).toBe(true);expect(conflicting.overtimeAmount).toBe(0)
})
it('ordinary same-date work before midnight is not assigned automatic full-day ownership',()=>{
 const row={...attendance,check_out:'23:59:59',canonical_final_checkout_at:'2026-11-20T23:59:59+01:00'}
 expect(biometricReviewRows([{worker,attendance:row,midnight_double_ot:false,extra_day_review_blocked:false}])).toHaveLength(1)
})
it.skipIf(!process.env.MIDNIGHT_OT_AUDIT)('all 15 real Peinture corrections render exactly one daily wage and zero hourly minutes on November 20',()=>{
 const data=JSON.parse(readFileSync(process.env.MIDNIGHT_OT_AUDIT,'utf8')),before=JSON.stringify(data)
 expect(data.workers).toHaveLength(15)
 const lines=data.workers.map(w=>calculateWeeklyPayoutLine(data,week,w))
 for(const line of lines){expect(line.extraDays).toBe(1);expect(line.extraDayAmount).toBe(Number(line.term.daily_rate));expect(line.payableOvertimeDays.find(d=>d.date===date).minutes).toBe(0);expect(line.overtimeAmount).toBe(0)}
 expect(lines.reduce((s,l)=>s+l.extraDayAmount,0)).toBe(303500)
 const report=teamWeeklyReport(data,week)
 expect(report.lines).toHaveLength(15);expect(report.totals.currencies.CDF.extraDayAmount).toBe(303500)
 for(const row of report.lines){expect(row.extraDays).toBe(1);expect(row.minutes).toBe(0);expect(row.finalAmount).toBe(row.basePay+row.transportAmount+row.extraDayAmount-row.lateDeduction)}
 expect(JSON.stringify(data)).toBe(before)
})
