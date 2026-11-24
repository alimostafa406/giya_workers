import {expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../lib/supabase',()=>({getSupabaseClient:()=>mock}))
import {getBiometricOvertimeReviews,decideBiometricOvertime,saveSundayEvidence} from './biometricOvertimeReviewApi'
it('stores separate approved evidence only through the authorized versioned RPC',async()=>{
 mock.rpc.mockResolvedValue({data:{version:2},error:null})
 await saveSundayEvidence('2026-11-22',{worker:{id:'w'},source_fingerprint:'fp',approved_evidence:{version:1}},{first:'2026-11-22T08:00:00+01:00',last:'2026-11-22T18:30:00+01:00',minutes:270,note:'Review'})
 expect(mock.rpc).toHaveBeenLastCalledWith('admin_save_sunday_evidence',{p_worker:'w',p_date:'2026-11-22',p_first:'2026-11-22T08:00:00+01:00',p_last:'2026-11-22T18:30:00+01:00',p_minutes:270,p_reset:false,p_note:'Review',p_expected_version:1,p_source_fingerprint:'fp'})
})
it('reads the canonical sources and writes only audited decisions, never attendance/punch fields',async()=>{
 mock.rpc.mockResolvedValue({data:[],error:null})
 await getBiometricOvertimeReviews('2026-10-23')
 expect(mock.rpc).toHaveBeenLastCalledWith('admin_get_biometric_overtime_review',{p_start:'2026-10-23',p_end:'2026-10-23'})
 await decideBiometricOvertime('2026-10-23',[{worker:{id:'w'},minutes:150,source_fingerprint:'fp',review:{version:2},check_out:'FAKE'}],'approved')
 expect(mock.rpc).toHaveBeenLastCalledWith('admin_decide_biometric_overtime',{p_date:'2026-10-23',p_entries:[{worker_id:'w',minutes:150,original_biometric_minutes:150,note:'',decision:'approved',source_fingerprint:'fp',expected_version:2}]})
 mock.rpc.mockResolvedValue({data:null,error:new Error('stale')})
 await expect(getBiometricOvertimeReviews('2026-10-23')).rejects.toThrow('stale')
})
