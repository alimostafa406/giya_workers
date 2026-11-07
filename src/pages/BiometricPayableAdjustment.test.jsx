// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DailyOperationalReports from './DailyOperationalReports'
import BiometricOvertimeReview from './BiometricOvertimeReview'
import { LanguageProvider } from '../i18n/LanguageContext'
import { approvedBiometricOvertime, biometricReviewRows } from '../utils/biometricOvertimeReview'
import { applyManualWeeklyOvertime } from '../utils/weeklyManualOvertime'
import { getSupabaseClient } from '../lib/supabase'
import { decideBiometricOvertime } from '../api/biometricOvertimeReviewApi'

const mocks=vi.hoisted(()=>({rpc:vi.fn(),attendance:vi.fn(),workers:vi.fn(),mappings:vi.fn(),evidence:vi.fn()}))
vi.mock('../lib/supabase',()=>({getSupabaseClient:()=>({rpc:mocks.rpc})}))
vi.mock('../api/attendanceApi',()=>({getAttendanceRequest:mocks.attendance}))
vi.mock('../api/workersApi',()=>({getWorkersRequest:mocks.workers}))
vi.mock('../api/biometricMappingApi',()=>({getBiometricMappingsRequest:mocks.mappings}))
vi.mock('../api/currentAttendanceEvidenceApi',()=>({getCurrentAttendanceEvidenceRequest:mocks.evidence}))
vi.mock('../utils/attendanceOperationalGate',()=>({kinshasaClock:()=>({date:'2026-10-30'})}))
globalThis.React=React
afterEach(()=>{cleanup();vi.clearAllMocks();window.history.replaceState({},'','/')})
const source=(minutes=60,decision='approved')=>({worker:{id:'w',full_name:'Worker',employee_code:'77',is_active:true,payment_type:'weekly',staff_classification:'normal',team_id:'t',team_name:'Team'},
 attendance:{id:'a',worker_id:'w',attendance_date:'2026-10-29',status:'present',attendance_source:'biometric',check_in:'08:00:00',check_out:'18:13:00'},source_fingerprint:'fp',locked:false,
 review:{minutes,decision,version:1,actor:'admin',source_fingerprint:'fp',history:[{minutes,original_biometric_minutes:73,source_fingerprint:'fp'}]}})

it.each([45,60,90])('approved %i minutes pay once; original 73 and real evidence stay intact',minutes=>{
 const s=source(minutes),before=JSON.stringify(s),detail={date:'2026-10-29',status:'present',row:s.attendance}
 expect(biometricReviewRows([s])[0]).toMatchObject({minutes:73,approvedMinutes:minutes,stale:false})
 expect(approvedBiometricOvertime(s.worker,detail,[s])).toMatchObject({minutes,original_biometric_minutes:73})
 const line={worker:s.worker,details:[detail],term:{overtime_rate_per_hour:60},finalAmount:0,overtimeAmount:0}
 const result=applyManualWeeklyOvertime(line,null,[],[s])
 expect(result.eveningOvertimeMinutes).toBe(minutes)
 expect(result.overtimeAmount).toBe(minutes)
 expect(result.payableOvertimeDays[0]).toMatchObject({source:'approved_biometric',minutes})
 expect(applyManualWeeklyOvertime(line,{minutes:120},[],[s]).eveningOvertimeMinutes).toBe(120)
 expect(JSON.stringify(s)).toBe(before)
})
it.each(['pending','rejected'])('%s remains non-payable',decision=>{
 const s=source(45,decision)
 expect(approvedBiometricOvertime(s.worker,{date:s.attendance.attendance_date,row:s.attendance},[s])).toBeNull()
})
it('changed evidence remains stale and cannot pay adjusted minutes',()=>{
 for(const change of [s=>s.source_fingerprint='new',s=>s.attendance.check_out='18:14:00']){
  const s=source();change(s)
  expect(biometricReviewRows([s])[0]).toMatchObject({status:'pending',stale:true})
  expect(approvedBiometricOvertime(s.worker,{date:s.attendance.attendance_date,row:s.attendance},[s])).toBeNull()
 }
})
it('real daily report controls save adjusted approval; overtime review reload shows the identical record and can reject',async()=>{
 const s=source();s.review=null;const originalAttendance=structuredClone(s.attendance)
 mocks.attendance.mockResolvedValue({data:[s.attendance]});mocks.workers.mockResolvedValue({data:[s.worker]})
 mocks.mappings.mockResolvedValue({data:[]});mocks.evidence.mockResolvedValue({data:[]})
 mocks.rpc.mockImplementation(async(name,args)=>{
  if(name==='admin_get_biometric_overtime_review')return {data:[structuredClone(s)],error:null}
  expect(name).toBe('admin_decide_biometric_overtime')
  const entry=args.p_entries[0]
  s.review={...entry,version:(s.review?.version||0)+1,history:[entry]}
  return {data:[{worker_id:'w',version:s.review.version}],error:null}
 })
 render(<LanguageProvider><DailyOperationalReports type="overtime"/></LanguageProvider>)
 const input=await screen.findByRole('textbox',{name:'الوقت الإضافي المعتمد Worker'})
 expect(screen.getByText('1h13')).toBeTruthy()
 fireEvent.change(input,{target:{value:'1h00'}})
 fireEvent.change(screen.getByRole('textbox',{name:'سبب التعديل Worker'}),{target:{value:'Verified by admin'}})
 fireEvent.click(screen.getByRole('button',{name:'موافقة',exact:true}))
 await waitFor(()=>expect(s.review?.minutes).toBe(60))
 expect(s.review).toMatchObject({original_biometric_minutes:73,note:'Verified by admin',decision:'approved'})
 cleanup();window.history.replaceState({},'','/attendance/overtime-review?date=2026-10-29')
 render(<BiometricOvertimeReview/>)
 await screen.findByText('لا يوجد وقت إضافي مطابق للبحث')
 fireEvent.change(screen.getByLabelText('الحالة'),{target:{value:''}})
 expect((await screen.findByRole('textbox',{name:'الوقت الإضافي المعتمد Worker'})).value).toBe('1h00')
 expect(screen.getByText('1h13')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'رفض',exact:true}))
 await waitFor(()=>expect(s.review.decision).toBe('rejected'))
 expect(s.attendance).toEqual(originalAttendance)
})
it('the office API keeps the existing RPC, raw reference, fingerprint and expected version',async()=>{
 const s=biometricReviewRows([source()])[0];s.payableMinutes=45;mocks.rpc.mockResolvedValue({data:[],error:null})
 await decideBiometricOvertime('2026-10-29',[s],'approved')
 expect(getSupabaseClient().rpc).toHaveBeenCalledWith('admin_decide_biometric_overtime',{p_date:'2026-10-29',p_entries:[expect.objectContaining({minutes:45,original_biometric_minutes:73,source_fingerprint:'fp',expected_version:1})]})
})
