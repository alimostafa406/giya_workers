import { expect, it } from 'vitest'
import { biometricReviewRows, biometricOvertimeMinutes, approvedBiometricOvertime } from './biometricOvertimeReview'
import { applyManualWeeklyOvertime } from './weeklyManualOvertime'
const date='2026-10-29'
const worker={id:'mbomba',full_name:'MBOMBA',employee_code:'77',is_active:true,payment_type:'weekly',staff_classification:'normal',team_id:'zarour',team_name:'Zarour'}
const source=(check_out)=>({worker,attendance:{id:'attendance',worker_id:worker.id,attendance_date:date,attendance_source:'biometric',status:'present',check_in:'08:08:29',check_out,manual_override:false},source_fingerprint:'fp',review:null})

it.each([['17:29:00',0],['17:30:00',0],['17:30:01',30],['17:31:00',30],['17:55:00',30],['17:55:19',30],['18:00:00',60],['18:30:00',90]])('%s uses strict >30-minute eligibility and existing half-hour rounding', (checkout,minutes)=>{
 const entry=source(checkout),before=JSON.stringify(entry)
 expect(biometricOvertimeMinutes(worker,entry.attendance,date)).toBe(minutes)
 expect(biometricReviewRows([entry])).toHaveLength(minutes?1:0)
 expect(JSON.stringify(entry)).toBe(before)
})
it.each([null,'rejected','approved'])('MBOMBA-equivalent 17:55:19 is reviewable; decision %s controls pay',decision=>{
 const entry=source('17:55:19')
 if(decision)entry.review={decision,minutes:30,source_fingerprint:'fp',version:1}
 expect(biometricReviewRows([entry])[0]).toMatchObject({minutes:30,status:decision||'pending'})
 const detail={date,row:entry.attendance}
 expect(Boolean(approvedBiometricOvertime(worker,detail,[entry]))).toBe(decision==='approved')
 const line={worker,term:{overtime_rate_per_hour:3000},details:[detail],finalAmount:100,overtimeAmount:0}
 const paid=applyManualWeeklyOvertime(line,null,[],[entry])
 expect(paid.eveningOvertimeMinutes).toBe(decision==='approved'?30:0)
 expect(paid.overtimeAmount).toBe(decision==='approved'?1500:0)
 expect(paid.finalAmount).toBe(decision==='approved'?1600:100)
})
