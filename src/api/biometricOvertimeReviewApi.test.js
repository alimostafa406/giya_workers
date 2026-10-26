import {expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../lib/supabase',()=>({getSupabaseClient:()=>mock}))
import {getBiometricOvertimeReviews,decideBiometricOvertime} from './biometricOvertimeReviewApi'
it('reads the canonical sources and writes only audited decisions, never attendance/punch fields',async()=>{
 mock.rpc.mockResolvedValue({data:[],error:null})
 await getBiometricOvertimeReviews('2026-10-23')
 expect(mock.rpc).toHaveBeenLastCalledWith('admin_get_biometric_overtime_review',{p_start:'2026-10-23',p_end:'2026-10-23'})
 await decideBiometricOvertime('2026-10-23',[{worker:{id:'w'},minutes:150,source_fingerprint:'fp',review:{version:2},check_out:'FAKE'}],'approved')
 expect(mock.rpc).toHaveBeenLastCalledWith('admin_decide_biometric_overtime',{p_date:'2026-10-23',p_entries:[{worker_id:'w',minutes:150,decision:'approved',source_fingerprint:'fp',expected_version:2}]})
 mock.rpc.mockResolvedValue({data:null,error:new Error('stale')})
 await expect(getBiometricOvertimeReviews('2026-10-23')).rejects.toThrow('stale')
})
