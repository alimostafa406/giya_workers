import { expect, it, vi } from 'vitest'
vi.mock('../lib/supabase',()=>({getSupabaseClient:vi.fn()}))
import { weeklyPayoutLines, assertWeeklyPayoutDraftReady, assertWeeklyPayoutSnapshotComplete } from './weeklyPayoutLines'
import { payrollDraftLinePayload } from '../api/payrollOperationsApi'
import { teamWeeklyReport } from './teamWeeklyReport'
it.each(['weekly','monthly'])('%s Sunday enters following weekly net once, separately from six-day wages and OT',type=>{
 const worker={id:'w',full_name:'Worker',employee_code:'1',team_id:'t',team_name:'Team',payment_type:type,is_active:true,staff_classification:'normal',payroll_compensation:{daily_rate:100,monthly_salary:2600,daily_transport_allowance:0,overtime_rate_per_hour:20,currency_code:'CDF'}}
 const data={workers:[worker],attendance:[],runs:[],payrollLines:[],rules:{},holidays:[],payrollAdjustments:[]}
 const before=weeklyPayoutLines(data,'2026-10-19')[0]
 data.sundayPayments=[{id:'s',worker_id:'w',work_date:'2026-10-18',payment_status:'unpaid',amount:200,currency_code:'CDF'}]
 const line=weeklyPayoutLines(data,'2026-10-19')[0]
 expect(line.finalAmount).toBe(before.finalAmount+200);expect(line.overtimeAmount).toBe(before.overtimeAmount);expect(line.baseAmount).toBe(before.baseAmount);expect(line.details).toHaveLength(6)
 const payload=payrollDraftLinePayload('run',line,'2026-10-19','2026-10-24','2026-10-24')
 expect(payload.calculation_snapshot.sunday_carry_amount).toBe(200)
 expect(()=>assertWeeklyPayoutDraftReady([payload],[line])).not.toThrow();expect(()=>assertWeeklyPayoutSnapshotComplete([payload])).not.toThrow()
 const report=teamWeeklyReport(data,'2026-10-19');expect(report.groups[0].lines[0].finalAmount).toBe(line.finalAmount)
})
