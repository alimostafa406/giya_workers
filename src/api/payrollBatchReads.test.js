import { beforeEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({calls:[],rpc:vi.fn(),workers:vi.fn()}))
vi.mock('../lib/supabase',()=>({getSupabaseClient:()=>({rpc:state.rpc,from:table=>{
 const call={table,ops:[]};state.calls.push(call)
 let q;q=new Proxy({}, {get:(_,key)=>key==='then'?Promise.resolve({data:table==='payroll_rule_set'?{}:[],error:null}).then.bind(Promise.resolve({data:table==='payroll_rule_set'?{}:[],error:null})): (...args)=>{call.ops.push([key,...args]);return q}})
 return q
}})}))
vi.mock('./attendanceApi',()=>({getAttendanceRequest:async params=>{state.calls.push({table:'attendance',params});return {data:[]}},getAttendanceRowsRequest:async params=>{state.calls.push({table:'attendance',params});return {data:[]}}}))
vi.mock('./payrollSettingsApi',()=>({getPayrollSettingsWorkersRequest:async params=>{state.workers(params);return {data:[]}}}))
vi.mock('./weeklyOvertimeApi',()=>({getWeeklyOvertimeOverrides:async week=>{state.calls.push({table:'manual_ot',week});return []}}))
vi.mock('./payrollOutsideWorkApi',()=>({getPayrollOutsideWork:async (start,end)=>{state.calls.push({table:'outside',start,end});return []}}))
import { getPayrollOperationsDataRequest } from './payrollOperationsApi'
beforeEach(()=>{state.calls=[];state.rpc.mockReset().mockImplementation(async name=>({data:name==='admin_get_payroll_overtime_context'?{biometricOvertimeReviews:[{id:'bio'}],extraDayReviews:[{id:'double'}]}:[],error:null}));state.workers.mockClear()})
it('one week loads all teams in bounded batches, sharing one OT context rather than per-worker RPC calls',async()=>{
 const period={date_from:'2026-11-09',date_to:'2026-11-14',paginate:true},d=await getPayrollOperationsDataRequest(period)
 expect(state.workers).toHaveBeenCalledWith(period)
 expect(state.calls.find(c=>c.table==='attendance').params).toEqual(period)
 for(const [table,start,end] of [['payroll_run','weekly_period_start','weekly_period_end'],['payroll_line','attendance_period_start','attendance_period_end'],['payroll_adjustment','payroll_line.attendance_period_start','payroll_line.attendance_period_end']]){
  const calls=state.calls.filter(c=>c.table===table);expect(calls).toHaveLength(1)
  expect(calls[0].ops).toContainEqual(['lte',start,period.date_to])
  expect(calls[0].ops).toContainEqual(['gte',end,period.date_from])
  expect(calls[0].ops).toContainEqual(['range',0,499])
 }
 expect(state.calls.find(c=>c.table==='worker_sunday_payment').ops).toContainEqual(['gte','work_date','2026-11-08'])
 expect(state.rpc.mock.calls.filter(([name])=>name==='admin_get_payroll_overtime_context')).toEqual([['admin_get_payroll_overtime_context',{p_start:period.date_from,p_end:period.date_to}]])
 expect(state.rpc.mock.calls.some(([name])=>['admin_get_extra_day_reviews','admin_get_biometric_overtime_review'].includes(name))).toBe(false)
 expect(d.biometricOvertimeReviews).toEqual([{id:'bio'}]);expect(d.extraDayReviews).toEqual([{id:'double'}])
})
it('backend failure is propagated without silently dropping premiums or retries',async()=>{
 state.rpc.mockImplementation(async name=>name==='admin_get_payroll_overtime_context'?{data:null,error:new Error('OT unavailable')}:{data:[],error:null})
 await expect(getPayrollOperationsDataRequest({date_from:'2026-11-09',date_to:'2026-11-14'})).rejects.toThrow('OT unavailable')
 expect(state.rpc.mock.calls.filter(([name])=>name==='admin_get_payroll_overtime_context')).toHaveLength(1)
})
it('overlapping week loads share one batch; a later reload fetches fresh data',async()=>{
 const params={date_from:'2026-11-09',date_to:'2026-11-14'}
 await Promise.all([getPayrollOperationsDataRequest(params),getPayrollOperationsDataRequest(params)])
 expect(state.rpc.mock.calls.filter(([name])=>name==='admin_get_payroll_overtime_context')).toHaveLength(1)
 expect(state.workers).toHaveBeenCalledTimes(1)
 await getPayrollOperationsDataRequest(params)
 expect(state.rpc.mock.calls.filter(([name])=>name==='admin_get_payroll_overtime_context')).toHaveLength(2)
})
