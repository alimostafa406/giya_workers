import {beforeEach,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../lib/supabase',()=>({getSupabaseClient:()=>({rpc:state.rpc,from:table=>{
 const result={data:table==='payroll_rule_set'?{}:[],error:null}
 let query;query=new Proxy({}, {get:(_target,key)=>key==='then'?Promise.resolve(result).then.bind(Promise.resolve(result)):()=>query})
 return query
}})}))
vi.mock('./attendanceApi',()=>({getAttendanceRequest:async()=>({data:[]})}))
vi.mock('./payrollSettingsApi',()=>({getPayrollSettingsWorkersRequest:async()=>({data:[{id:'inactive',is_active:false}]})}))
vi.mock('./weeklyOvertimeApi',()=>({getWeeklyOvertimeOverrides:async()=>[]}))
vi.mock('./payrollOutsideWorkApi',()=>({getPayrollOutsideWork:async()=>[]}))
vi.mock('./biometricOvertimeReviewApi',()=>({getBiometricOvertimeReviews:async()=>[]}))
import {getPayrollOperationsDataRequest} from './payrollOperationsApi'
beforeEach(()=>state.rpc.mockReset())
it('loads the same secure week-bounded historical population for payroll and report data',async()=>{
 const population=[{worker_id:'inactive',date:'2026-10-29',identity:{team_id:'old',team_name:'Original'}}]
 state.rpc.mockResolvedValue({data:population,error:null})
 const d=await getPayrollOperationsDataRequest({date_from:'2026-10-26',date_to:'2026-10-31'})
 expect(state.rpc).toHaveBeenCalledWith('admin_get_weekly_payroll_population',{p_start:'2026-10-26',p_end:'2026-10-31'})
 expect(d.workers[0].is_active).toBe(false)
 expect(d.weeklyPayrollPopulation).toEqual(population)
})
it('does not silently fall back to an active-only population if the contract fails',async()=>{
 state.rpc.mockResolvedValue({data:null,error:new Error('Historical source unavailable')})
 await expect(getPayrollOperationsDataRequest({date_from:'2026-10-26',date_to:'2026-10-31'})).rejects.toThrow('Historical source unavailable')
})
it('monthly/history callers without a selected weekly range keep their existing source',async()=>{
 const d=await getPayrollOperationsDataRequest()
 expect(state.rpc).not.toHaveBeenCalled()
 expect(d.weeklyPayrollPopulation).toEqual([])
})
