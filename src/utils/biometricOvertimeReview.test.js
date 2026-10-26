import { expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
import { biometricReviewRows, approvedBiometricOvertime, assertBiometricReviewsResolved } from './biometricOvertimeReview'
import { applyManualWeeklyOvertime } from './weeklyManualOvertime'
import { weeklyPayoutLines } from './weeklyPayoutLines'
import { payrollDraftLinePayload } from '../api/payrollOperationsApi'
import { teamWeeklyReport } from './teamWeeklyReport'
const date='2026-10-23', week='2026-10-19'
const worker={id:'w',full_name:'Worker',employee_code:'42',team_id:'t',team_name:'Team',is_active:true,payment_type:'weekly',staff_classification:'normal',payroll_compensation:{daily_rate:100,daily_transport_allowance:0,currency_code:'CDF',overtime_rate_per_hour:20}}
const attendance={id:'a',worker_id:'w',attendance_date:date,status:'present',attendance_day_fraction:1,attendance_source:'biometric',manual_override:false,check_in:'08:00:00',check_out:'19:30:00',updated_at:'2026-10-23T19:00:00Z'}
const source=(decision)=>({worker,attendance:{...attendance},source_fingerprint:'fp',locked:false,review:decision?{decision,minutes:150,version:1,source_fingerprint:'fp',actor:'admin',decided_at:'2026-10-24T08:00:00Z'}:null})
const line=(row=attendance)=>({worker,term:worker.payroll_compensation,details:[{date,row}],finalAmount:100,overtimeAmount:0})
it.each([[undefined,0],['rejected',0],['approved',150]])('biometric decision %s yields payable %s, leaving clocks unchanged', (decision,minutes)=>{
 const s=source(decision),before=JSON.stringify(s)
 expect(biometricReviewRows([s])[0].status).toBe(decision||'pending')
 expect(applyManualWeeklyOvertime(line(),null,[],[s]).eveningOvertimeMinutes).toBe(minutes)
 expect(JSON.stringify(s)).toBe(before)
})
it('explicit daily manual wins over approved biometric; weekly override including zero wins over everything',()=>{
 const s=source('approved'),manual={...attendance,manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:180}
 expect(applyManualWeeklyOvertime(line(manual),null,[],[s]).eveningOvertimeMinutes).toBe(180)
 expect(applyManualWeeklyOvertime(line(manual),{minutes:1500},[],[s]).eveningOvertimeMinutes).toBe(1500)
 expect(applyManualWeeklyOvertime(line(manual),{minutes:0},[],[s]).eveningOvertimeMinutes).toBe(0)
})
it('approved biometric beats same-day FINAL outside work without adding; pending/rejected falls back to outside work',()=>{
 const outside=[{id:'o',status:'final',work_date:date,outside_work_movement_workers:[{worker_id:'w',start_time:'08:00',end_time:'20:00'}]}]
 expect(applyManualWeeklyOvertime(line(),null,outside,[source('approved')]).eveningOvertimeMinutes).toBe(150)
 for(const decision of [undefined,'rejected']) expect(applyManualWeeklyOvertime(line(),null,outside,[source(decision)]).eveningOvertimeMinutes).toBe(180)
})
it('changed real checkout/fingerprint invalidates approval; benign version-only changes do not change reviewed evidence',()=>{
 const s=source('approved');s.attendance.check_out='20:00:00';s.source_fingerprint='changed'
 expect(biometricReviewRows([s])[0]).toMatchObject({status:'pending',stale:true,minutes:180})
 expect(approvedBiometricOvertime(worker,{date,row:s.attendance},[s])).toBeNull()
 const unchanged=source('approved');unchanged.attendance.updated_at='2026-10-24T10:00:00Z'
 expect(biometricReviewRows([unchanged])[0].status).toBe('approved')
})
it('monthly approval flows through draft and immutable final report as overtime only; no salary/punch edits',()=>{
 const s=source('approved');s.worker={...worker,payment_type:'monthly',monthly_salary:999999}
 const d={workers:[s.worker],attendance:[s.attendance],biometricOvertimeReviews:[s],rules:{},runs:[]}
 const before=JSON.stringify(d),lines=weeklyPayoutLines(d,week)
 expect(lines[0]).toMatchObject({monthlyOvertimeOnly:true,baseAmount:0,transportAmount:0,eveningOvertimeMinutes:150,overtimeAmount:50,finalAmount:50})
 const stored=payrollDraftLinePayload('run',lines[0],week,'2026-10-24','2026-10-24')
 expect(stored.attendance_summary_snapshot.effective_overtime_sources).toEqual(['approved_biometric'])
 expect(stored.attendance_summary_snapshot.payable_overtime_days.find(d=>d.date===date).biometric_approval).toMatchObject({version:1,source_fingerprint:'fp',minutes:150})
 const frozen=teamWeeklyReport({...d,biometricOvertimeReviews:[],runs:[{id:'run',payment_type:'weekly',weekly_period_start:week,weekly_period_end:'2026-10-24',status:'paid'}],payrollLines:[stored]},week)
 expect(frozen.lines[0]).toMatchObject({basePay:0,minutes:150,overtimeAmount:50,finalAmount:50})
 expect(JSON.stringify(d)).toBe(before)
})
it('pending/stale relevant reviews block review/finalization, but an explicit weekly/daily override safely supersedes them',()=>{
 const d={biometricOvertimeReviews:[source()],attendance:[attendance]}
 expect(()=>assertBiometricReviewsResolved(d,[date])).toThrow('غير محسومة')
 expect(()=>assertBiometricReviewsResolved({...d,weeklyOvertimeOverrides:[{worker_id:'w',minutes:0}]},[date])).not.toThrow()
 expect(()=>assertBiometricReviewsResolved({...d,attendance:[{...attendance,manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:120}]},[date])).not.toThrow()
 expect(()=>assertBiometricReviewsResolved({...d,biometricOvertimeReviews:[source('rejected')]},[date])).not.toThrow()
})
it('manual/fabricated checkout, zero overtime, excluded and inactive workers are not review candidates',()=>{
 for(const change of [{attendance_source:'manual'},{check_out:null},{check_out:'17:30:00'},{manual_override:true,emergency_overtime_mode:'manual_checkout'}]){
  const s=source();s.attendance={...s.attendance,...change};expect(biometricReviewRows([s])).toHaveLength(0)
 }
 const s=source();s.worker={...worker,is_active:false};expect(biometricReviewRows([s])).toHaveLength(0)
})
