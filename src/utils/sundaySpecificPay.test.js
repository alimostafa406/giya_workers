import {expect,it} from 'vitest'
import {sundayReportRows,sundayReportTotals,applyWeeklySundayPay} from './sundayPayroll'
const date='2026-11-29'
function fixture(type='monthly',decision='pending'){
 const worker={id:'w',payment_type:type,is_active:true,team_id:'t',team_name:type==='monthly'?'Chauffeur':'Team',payroll_compensation_terms:[{payment_type:type,effective_from:'2026-01-01',currency_code:'CDF',daily_rate:20000,monthly_salary:520000,overtime_rate_per_hour:2500}]}
 const settings={pay_model:'sunday_specific',sunday_fixed_pay:type==='monthly'?20000:null,sunday_transport:type==='monthly'?3000:0,overtime_multiplier:4,pay_multiplier:2}
 return {date,workers:[worker],rules:{monthly_working_day_divisor:26},sunday_evidence:[{worker_id:'w',eligible:true,punch_count:2,sunday_settings:settings}],biometricOvertimeReviews:[{worker,attendance:{worker_id:'w',attendance_date:date},sunday_evidence:true,work_date:date,raw_minutes:120,source_fingerprint:'f',review:{decision,minutes:120,source_fingerprint:'f'}}]}
}
it('weekly default Sunday base is the normal 20000 wage times two without a fixed amount',()=>{
 const d=fixture('weekly');expect(sundayReportRows(d,date)[0]).toMatchObject({amount:40000,transportAmount:0,multiplier:2,netAmount:40000})
})
it.each(['pending','rejected'])('monthly fixed 20000 plus Sunday transport 3000 gives 23000 with %s OT',decision=>{
 expect(sundayReportRows(fixture('monthly',decision),date)[0]).toMatchObject({amount:20000,transportAmount:3000,overtimeAmount:0,netAmount:23000,missingSundayPay:false})
})
it('approved two hours use normal rate 2500 times four, adding 20000 hourly OT once',()=>{
 const d=fixture('monthly','approved'),before=JSON.stringify(d);const rows=sundayReportRows(d,date)
 expect(rows[0]).toMatchObject({amount:20000,transportAmount:3000,overtimeMinutes:120,overtimeAmount:20000,netAmount:43000})
 expect(sundayReportTotals(rows)).toMatchObject({baseCurrencies:{CDF:20000},transportCurrencies:{CDF:3000},overtimeCurrencies:{CDF:20000},currencies:{CDF:43000}})
 expect(JSON.stringify(d)).toBe(before)
})
it('monthly missing fixed pay never falls back to salary / 26 or a fake zero',()=>{
 const d=fixture();d.sunday_evidence[0].sunday_settings.sunday_fixed_pay=null
 expect(sundayReportRows(d,date)[0]).toMatchObject({amount:null,netAmount:null,missingSundayPay:true})
})
it('incomplete Sunday does not receive automatic fixed pay or transport',()=>{
 const d=fixture();d.sunday_evidence[0].eligible=false
 expect(sundayReportRows(d,date)[0]).toMatchObject({amount:0,transportAmount:0,netAmount:0})
})
it('a saved Sunday ledger freezes base/transport and carries their sum to weekly payroll exactly once',()=>{
 const d=fixture();d.payments=[{id:'s',worker_id:'w',work_date:date,payment_status:'unpaid',currency_code:'CDF',daily_value:20000,multiplier:1,base_amount:20000,transport_amount:3000,amount:23000}]
 d.sunday_evidence[0].sunday_settings.sunday_fixed_pay=50000;d.sunday_evidence[0].sunday_settings.sunday_transport=9000
 expect(sundayReportRows(d,date)[0]).toMatchObject({amount:20000,transportAmount:3000,netAmount:23000})
 const line={worker:d.workers[0],currency:'CDF',finalAmount:0,bonusAmount:0};const carried=applyWeeklySundayPay(line,{sundayPayments:[d.payments[0],d.payments[0]]},'2026-11-30')
 expect(carried.finalAmount).toBe(23000);expect(applyWeeklySundayPay(carried,{sundayPayments:d.payments},'2026-11-30').finalAmount).toBe(23000)
})
