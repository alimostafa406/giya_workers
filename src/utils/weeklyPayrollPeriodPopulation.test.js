import {expect,it,vi} from 'vitest'
vi.mock('../lib/supabase',()=>({getSupabaseClient:vi.fn()}))
import {weeklyPayoutLines} from './weeklyPayoutLines'
import {teamWeeklyReport} from './teamWeeklyReport'
import {payrollDraftEligibleLines} from './weeklyPayrollEligibility'
import {payrollDraftLinePayload} from '../api/payrollOperationsApi'
const week='2026-10-26',end='2026-10-31'
const worker=(id,extra={})=>({id,full_name:id,employee_code:id,team_id:'t',team_name:'Team',payment_type:'weekly',staff_classification:'normal',is_active:true,
 payroll_compensation:{daily_rate:100,daily_transport_allowance:10,currency_code:'CDF',overtime_rate_per_hour:60},...extra})
const row=(id,extra={})=>({id:'a-'+id,worker_id:id,attendance_date:week,status:'present',attendance_day_fraction:1,attendance_source:'biometric',check_in:'08:00:00',check_out:'18:05:00',...extra})
const fixture=()=>({workers:[worker('w')],attendance:[row('w')],rules:{},holidays:[],runs:[],payrollLines:[]})
it('deactivation preserves recorded days, absences, amounts, report totals and draft persistence',()=>{
 const d=fixture(),before=weeklyPayoutLines(d,week),report=teamWeeklyReport(d,week)
 d.workers[0].is_active=false
 const raw=JSON.stringify(d),after=weeklyPayoutLines(d,week)
 expect(after).toHaveLength(1)
 expect(after[0]).toMatchObject({worker:{is_active:false},presentDays:before[0].presentDays,absentDays:before[0].absentDays,baseAmount:before[0].baseAmount,transportAmount:before[0].transportAmount,finalAmount:before[0].finalAmount})
 expect(after[0].details).toEqual(before[0].details)
 expect(teamWeeklyReport(d,week).totals).toEqual(report.totals)
 expect(payrollDraftEligibleLines('weekly',after,end)).toHaveLength(1)
 expect(JSON.stringify(d)).toBe(raw)
})
it.each(['weekly','monthly'])('inactive %s worker with weekly OT remains eligible without monthly salary leakage',type=>{
 const d=fixture();d.workers=[worker('w',{is_active:false,payment_type:type,monthly_salary:999999})];d.attendance=[]
 d.weeklyOvertimeOverrides=[{worker_id:'w',week_start:week,minutes:65}]
 const line=weeklyPayoutLines(d,week)[0]
 expect(line.eveningOvertimeMinutes).toBe(65);expect(line.overtimeAmount).toBe(65)
 expect(payrollDraftEligibleLines('weekly',[line],end)).toHaveLength(1)
 expect(teamWeeklyReport(d,week).lines[0].minutes).toBe(65)
 if(type==='monthly')expect(line).toMatchObject({baseAmount:0,finalAmount:65,transportAmount:0})
})
it('inactive worker retains approved biometric OT using real recorded minutes',()=>{
 const d=fixture();d.workers[0].is_active=false
 d.biometricOvertimeReviews=[{worker:d.workers[0],attendance:d.attendance[0],source_fingerprint:'same',review:{decision:'approved',minutes:65,source_fingerprint:'same',version:1}}]
 expect(weeklyPayoutLines(d,week)[0]).toMatchObject({eveningOvertimeMinutes:65,overtimeAmount:65})
 expect(teamWeeklyReport(d,week).lines[0].overtimeAmount).toBe(65)
})
it('canonical historical population retains membership and historical team, but not in future empty weeks',()=>{
 const d=fixture();d.attendance=[];d.workers[0]={...d.workers[0],is_active:false,team_id:'new',team_name:'Transferred'}
 d.weeklyPayrollPopulation=[{worker_id:'w',date:week,identity:{team_id:'old',team_name:'Original'}}]
 const lines=weeklyPayoutLines(d,week)
 expect(lines[0].worker).toMatchObject({is_active:false,team_id:'old',team_name:'Original'})
 expect(payrollDraftEligibleLines('weekly',lines,end)).toHaveLength(1)
 expect(teamWeeklyReport(d,week).groups[0].name).toBe('Original')
 expect(weeklyPayoutLines(d,'2026-11-02')).toEqual([])
 expect(teamWeeklyReport(d,'2026-11-02').lines).toEqual([])
})
it('inactive FINAL outside-work participant remains in the period without rewriting data',()=>{
 const d=fixture();d.attendance=[];d.workers[0].is_active=false
 d.outsideWorkMovements=[{id:'m',status:'final',work_date:week,outside_work_movement_workers:[{worker_id:'w',start_time:'08:00',end_time:'18:05'}]}]
 expect(weeklyPayoutLines(d,week)[0].eveningOvertimeMinutes).toBe(65)
 expect(weeklyPayoutLines(d,'2026-11-02')).toEqual([])
})
it.each(['reviewed','finalized','paid'])('%s historical snapshots retain membership, identity and amounts after deactivation',status=>{
 const d=fixture(),line=weeklyPayoutLines(d,week)[0]
 d.payrollLines=[payrollDraftLinePayload('run',line,week,end,end)]
 d.runs=[{id:'run',payment_type:'weekly',weekly_period_start:week,weekly_period_end:end,status}]
 const before=teamWeeklyReport(d,week),snapshot=JSON.stringify(d.payrollLines)
 d.workers[0]={...d.workers[0],is_active:false,team_id:'other',team_name:'Other'};d.attendance=[]
 expect(teamWeeklyReport(d,week).totals).toEqual(before.totals)
 expect(teamWeeklyReport(d,week).groups.map(g=>g.name)).toEqual(before.groups.map(g=>g.name))
 expect(JSON.stringify(d.payrollLines)).toBe(snapshot)
})
it('five other recorded weekly workers keep exactly the same payroll after simulated deactivation',()=>{
 const d=fixture();d.workers=Array.from({length:5},(_,i)=>worker(String(i)));d.attendance=d.workers.map(w=>row(w.id))
 const before=teamWeeklyReport(d,week)
 d.workers=d.workers.map(w=>({...w,is_active:false}))
 expect(teamWeeklyReport(d,week).totals).toEqual(before.totals)
 expect(weeklyPayoutLines(d,week)).toHaveLength(5)
 expect(weeklyPayoutLines(d,'2026-11-02')).toEqual([])
})
