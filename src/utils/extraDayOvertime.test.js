import {expect,it,vi} from 'vitest'
vi.mock('../lib/supabase',()=>({getSupabaseClient:vi.fn()}))
import {calculateWeeklyPayoutLine,assertWeeklyPayoutDraftReady,assertWeeklyPayoutSnapshotComplete} from './weeklyPayoutLines'
import {payrollDraftLinePayload} from '../api/payrollOperationsApi'
import {teamWeeklyReport} from './teamWeeklyReport'
import {applyPayrollAdjustments} from './payrollCalculations'
import {payrollDraftEligibleLines} from './weeklyPayrollEligibility'
import {unresolvedBiometricOvertime} from './biometricOvertimeReview'
const week='2026-11-09',end='2026-11-14'
const worker=payment_type=>({id:'w',full_name:'Worker',employee_code:'1',team_id:'t',team_name:'Team',payment_type,is_active:true,staff_classification:'normal',monthly_salary:999999,payroll_compensation:{daily_rate:20000,monthly_salary:999999,daily_transport_allowance:0,currency_code:'CDF',overtime_rate_per_hour:600}})
const source=()=>({rule_id:'r',worker_id:'w',work_date:week,status:'approved',source:{qualified:true,fingerprint:'fp'},review:{source_fingerprint:'fp'},payroll_source:{rule_id:'r',worker_id:'w',date:week,version:1,amount:20000,currency:'CDF',source_fingerprint:'fp',extra_days:1}})
const data=type=>({workers:[worker(type)],rules:{},holidays:[],runs:[],payrollLines:[],extraDayReviews:[source()],attendance:[{id:'a',worker_id:'w',attendance_date:week,status:'present',attendance_day_fraction:1,check_in:'08:00',check_out:'23:00',manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:360}]})
it.each(['weekly','monthly'])('%s approved extra day pays full wage once, suppresses hourly OT and preserves exactly one attendance day',type=>{
 const d=data(type),before=JSON.stringify(d),line=calculateWeeklyPayoutLine(d,week,d.workers[0])
 expect(line).toMatchObject({extraDays:1,extraDayAmount:20000,presentDays:1,eveningOvertimeMinutes:0,overtimeAmount:0,bonusAmount:20000,baseAmount:type==='monthly'?0:20000,finalAmount:type==='monthly'?20000:40000})
 expect(line.payableOvertimeDays[0]).toMatchObject({minutes:0,source:'extra_day_supersedes_hourly',superseded_hourly_overtime:{minutes:360,source:'daily_manual'}})
 expect(applyPayrollAdjustments(line,[]).finalAmount).toBe(line.finalAmount)
 expect(payrollDraftEligibleLines('weekly',[line],end)).toHaveLength(1)
 expect(JSON.stringify(d)).toBe(before)
 const report=teamWeeklyReport(d,week)
 expect(report.lines[0].basePay).toBe(type==='monthly'?0:20000)
 expect(report.totals.extraDays).toBe(1);expect(report.totals.currencies.CDF.extraDayAmount).toBe(20000)
 expect(report.totals.currencies.CDF.finalAmount).toBe(line.finalAmount)
 const saved=payrollDraftLinePayload('run',line,week,end,end)
 expect(saved.bonus_amount).toBe(20000)
 expect(()=>assertWeeklyPayoutDraftReady([saved],[line])).not.toThrow()
 expect(()=>assertWeeklyPayoutSnapshotComplete([saved])).not.toThrow()
 d.runs=[{id:'run',payment_type:'weekly',weekly_period_start:week,weekly_period_end:end,status:'paid'}];d.payrollLines=[saved];d.extraDayReviews=[];d.attendance=[]
 expect(teamWeeklyReport(d,week).totals).toEqual(report.totals)
})
it.each(['pending','rejected','stale'])('%s is not payable and does not suppress existing canonical hourly OT',status=>{
 const d=data('weekly');d.extraDayReviews[0].status=status
 expect(calculateWeeklyPayoutLine(d,week,d.workers[0])).toMatchObject({extraDays:0,extraDayAmount:0,eveningOvertimeMinutes:360,overtimeAmount:3600})
})
it('unrelated non-overlapping dates retain their hourly OT; undated weekly totals conflict instead of double pay',()=>{
 const d=data('weekly');d.attendance.push({...d.attendance[0],id:'b',attendance_date:'2026-11-10',emergency_overtime_minutes:90})
 const line=calculateWeeklyPayoutLine(d,week,d.workers[0]);expect(line.eveningOvertimeMinutes).toBe(90)
 d.weeklyOvertimeOverrides=[{worker_id:'w',minutes:500}]
 const conflict=calculateWeeklyPayoutLine(d,week,d.workers[0]);expect(conflict.extraDayConflict).toBe(true);expect(conflict.overtimeAmount).toBe(0)
 expect(()=>assertWeeklyPayoutDraftReady([payrollDraftLinePayload('run',conflict,week,end,end)],[conflict])).toThrow('unresolved')
})
it('other workers are unchanged and stale source evidence cannot pay',()=>{
 const d=data('weekly');d.extraDayReviews[0].worker_id='other'
 expect(calculateWeeklyPayoutLine(d,week,d.workers[0]).extraDays).toBe(0)
 d.extraDayReviews[0].worker_id='w';d.extraDayReviews[0].source.fingerprint='changed'
 expect(calculateWeeklyPayoutLine(d,week,d.workers[0]).extraDays).toBe(0)
})
it.each(['weekly','monthly'])('%s extra-day premium and approved lateness deduction each apply once',type=>{
 const d=data(type);d.attendance[0].attendance_source='biometric';d.attendance[0].check_in='08:35:00'
 d.latenessReviews=[{worker:d.workers[0],attendance:d.attendance[0],evidence:{source_fingerprint:'late'},review:{decision:'approved',source_fingerprint:'late'},payroll_source:{date:week,deduction_amount:1000}}]
 const line=calculateWeeklyPayoutLine(d,week,d.workers[0]);expect(line.lateDeduction).toBe(1000)
 expect(line.finalAmount).toBe(type==='monthly'?19000:39000)
 expect(payrollDraftEligibleLines('weekly',[line],end)).toHaveLength(1)
 expect(applyPayrollAdjustments(line,[]).finalAmount).toBe(line.finalAmount)
})
it('superseded pending biometric OT does not force a second approval in payroll',()=>{
 const d=data('weekly');d.attendance[0].attendance_source='biometric';d.attendance[0].manual_override=false
 d.biometricOvertimeReviews=[{worker:d.workers[0],attendance:d.attendance[0],source_fingerprint:'bio',review:null}]
 expect(unresolvedBiometricOvertime(d,[week])).toHaveLength(0)
 expect(unresolvedBiometricOvertime({...d,extraDayReviews:[]},[week])).toHaveLength(1)
})
