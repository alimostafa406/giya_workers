import { applyExtraDayPremium } from './extraDayOvertime.js'
import { readFileSync } from 'node:fs'
import { expect,it } from 'vitest'
import { calculateWeeklyPayoutLine } from './weeklyPayoutLines.js'
import { teamWeeklyReport } from './teamWeeklyReport.js'
import { monthlyDailyValue } from './payrollCalculations.js'
it.runIf(Boolean(process.env.PUATI_CORRECTION_FIXTURE))('real PUATI: corrected approved days pay once with zero weekly salary base', () => {
 const data=JSON.parse(readFileSync(process.env.PUATI_CORRECTION_FIXTURE,'utf8'))
 const worker=data.workers[0],before=JSON.stringify(data)
 const line=calculateWeeklyPayoutLine(data,'2026-11-23',worker)
 expect(monthlyDailyValue(worker.payroll_compensation.monthly_salary,data.rules.monthly_working_day_divisor)).toBe(25000)
 expect(line).toMatchObject({paymentType:'monthly',baseAmount:0,attendanceWage:0,monthlySalary:0,
   extraDays:3,extraDayAmount:75000,eveningOvertimeMinutes:187,overtimeAmount:10908.33,transportAmount:20000,finalAmount:105908.33})
 expect(new Set(line.extraDayPremiums.map(p=>p.date)).size).toBe(3)
 expect(line.extraDayPremiums.every(p=>p.amount===25000)).toBe(true)
 const report=teamWeeklyReport(data,'2026-11-23')
 expect(report.lines).toHaveLength(1)
 expect(report.lines[0]).toMatchObject({basePay:0,extraDays:3,extraDayAmount:75000,overtimeAmount:10908.33,transportAmount:20000,finalAmount:105908.33})
 expect(report.totals.currencies.CDF.finalAmount).toBe(105908.33)
 expect(report.totals.currencies.CDF.extraDayAmount).toBe(75000)
 expect(JSON.stringify(data)).toBe(before)
})

it('monthly salary basis funds three approved extra days exactly once without changing existing weekly components', () => {
 const worker={id:'monthly',payment_type:'monthly'}
 const dates=['2026-11-23','2026-11-25','2026-11-26']
 const daily=monthlyDailyValue(650000,26)
 const reviews=dates.map(date=>({worker_id:worker.id,work_date:date,status:'approved',source:{qualified:true,fingerprint:date},review:{source_fingerprint:date},
   payroll_source:{worker_id:worker.id,date,version:2,amount:daily,currency:'CDF',extra_days:1,source_fingerprint:date}}))
 const original={worker,currency:'CDF',details:dates.map(date=>({date})),baseAmount:0,monthlySalary:0,
   overtimeAmount:10908.33,transportAmount:20000,finalAmount:30908.33}
 const line=applyExtraDayPremium(original,reviews)
 expect(daily).toBe(25000)
 expect(line).toMatchObject({baseAmount:0,monthlySalary:0,extraDays:3,extraDayAmount:75000,overtimeAmount:10908.33,transportAmount:20000,finalAmount:105908.33})
 expect(applyExtraDayPremium(line,reviews).finalAmount).toBe(105908.33)
 expect(original.finalAmount).toBe(30908.33)
})
