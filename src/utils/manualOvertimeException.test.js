import {expect,it,vi} from 'vitest'
vi.mock('../lib/supabase',()=>({getSupabaseClient:vi.fn()}))
import {manualExceptionAmounts} from './manualOvertimeException'
import {calculateWeeklyPayoutLine,assertWeeklyPayoutSnapshotComplete} from './weeklyPayoutLines'
import {payrollDraftLinePayload} from '../api/payrollOperationsApi'
import {teamWeeklyReport} from './teamWeeklyReport'
const date='2026-11-20',week='2026-11-16'
const worker=type=>({id:'w',full_name:'Worker',employee_code:'1',team_id:'t',team_name:'Team',is_active:true,staff_classification:'normal',payment_type:type,payroll_compensation:{daily_rate:20000,monthly_salary:999999,daily_transport_allowance:0,overtime_rate_per_hour:4000,currency_code:'CDF'}})
const exception={id:'manual',version:1,date,extra_days:1,minutes:120,daily_wage:20000,hourly_rate:3000,full_day_amount:20000,hourly_amount:6000,currency:'CDF'}
const row=e=>({worker_id:'w',work_date:date,status:'approved',manual_exception:e,source:{qualified:true,fingerprint:'fp'},review:{source_fingerprint:'fp'},payroll_source:e.extra_days?{manual_exception_id:e.id,worker_id:'w',date,version:1,amount:e.full_day_amount,currency:'CDF',extra_days:e.extra_days,source_fingerprint:'fp'}:null})
const data=type=>({workers:[worker(type)],attendance:[],rules:{},runs:[],holidays:[],payrollLines:[],payrollAdjustments:[],extraDayReviews:[row(exception)]})
it('previews days and hours separately at final currency precision',()=>{expect(manualExceptionAmounts({daily_wage:20000,hourly_rate:3000},1,120)).toEqual({fullDay:20000,hourly:6000,total:26000});expect(manualExceptionAmounts({daily_wage:20000,hourly_rate:3000},1,150).hourly).toBe(7500)})
it.each(['weekly','monthly'])('%s: one day plus two hours pays 26000 once at saved rates without any attendance day',type=>{
 const d=data(type),before=JSON.stringify(d),line=calculateWeeklyPayoutLine(d,week,d.workers[0])
 expect(line).toMatchObject({presentDays:0,baseAmount:0,extraDays:1,extraDayAmount:20000,eveningOvertimeMinutes:120,overtimeAmount:6000,finalAmount:26000})
 expect(line.payableOvertimeDays.find(d=>d.date===date)).toMatchObject({source:'manual_exception',minutes:120,manual_exception:exception})
 expect(()=>assertWeeklyPayoutSnapshotComplete([payrollDraftLinePayload('run',line,week,'2026-11-21','2026-11-21')])).not.toThrow()
 const report=teamWeeklyReport(d,week);expect(report.lines[0]).toMatchObject({basePay:0,minutes:120,overtimeAmount:6000,extraDays:1,extraDayAmount:20000,finalAmount:26000})
 expect(JSON.stringify(d)).toBe(before)
})
it('quantity is independent of hours, and clearing removes both components',()=>{const d=data('weekly');d.extraDayReviews=[row({...exception,extra_days:2,full_day_amount:40000})];expect(calculateWeeklyPayoutLine(d,week,d.workers[0])).toMatchObject({extraDays:2,extraDayAmount:40000,overtimeAmount:6000,finalAmount:46000});d.extraDayReviews=[];expect(calculateWeeklyPayoutLine(d,week,d.workers[0])).toMatchObject({extraDays:0,overtimeAmount:0,finalAmount:0})})
it('additional hours may accompany an existing approved Double day only with zero manual days',()=>{const d=data('weekly');d.extraDayReviews=[{...row(exception),manual_exception:undefined},row({...exception,extra_days:0,full_day_amount:0})];d.biometricOvertimeReviews=[{worker:d.workers[0],attendance:{worker_id:'w',attendance_date:date},midnight_double_ot:true}];expect(calculateWeeklyPayoutLine(d,week,d.workers[0])).toMatchObject({extraDays:1,extraDayAmount:20000,eveningOvertimeMinutes:120,overtimeAmount:6000,finalAmount:26000})})
it('positive weekly override conflicts instead of silently paying two hourly paths',()=>{const d=data('weekly');d.weeklyOvertimeOverrides=[{worker_id:'w',minutes:300}];expect(calculateWeeklyPayoutLine(d,week,d.workers[0]).extraDayConflict).toBe(true)})
it('frozen payroll keeps its exact separate amounts after later live rates or manual entries change',()=>{const d=data('weekly'),line=calculateWeeklyPayoutLine(d,week,d.workers[0]),saved=payrollDraftLinePayload('run',line,week,'2026-11-21','2026-11-21');d.runs=[{id:'run',payment_type:'weekly',weekly_period_start:week,weekly_period_end:'2026-11-21',status:'paid'}];d.payrollLines=[saved];d.extraDayReviews=[];d.workers[0].payroll_compensation.overtime_rate_per_hour=9000;expect(teamWeeklyReport(d,week).lines[0]).toMatchObject({extraDays:1,extraDayAmount:20000,minutes:120,overtimeAmount:6000,finalAmount:26000})})
