// @vitest-environment jsdom
import React from 'react'
import { readFileSync } from 'node:fs'
import { expect,it,vi,afterEach } from 'vitest'
import { render,screen,cleanup } from '@testing-library/react'
import { weeklyPayoutLines } from '../utils/weeklyPayoutLines'
import { teamWeeklyReport } from '../utils/teamWeeklyReport'
import { LanguageProvider } from '../i18n/LanguageContext'
import PayrollOperations from '../components/Payroll/PayrollOperations'
const api=vi.hoisted(()=>({load:vi.fn()}))
vi.mock('../api/payrollOperationsApi',async original=>({...await original(),getPayrollOperationsDataRequest:api.load}))
vi.mock('../utils/payrollCalculations',async original=>({...await original(),mondayFor:()=> '2026-11-09'}))
globalThis.React=React
afterEach(cleanup)
it.skipIf(!process.env.PAYROLL_BATCH_BEFORE || !process.env.PAYROLL_BATCH_AFTER)('real current week retains every worker and all payroll amounts; main payroll renders without timeout',async()=>{
 const before=JSON.parse(readFileSync(process.env.PAYROLL_BATCH_BEFORE,'utf8')),after=JSON.parse(readFileSync(process.env.PAYROLL_BATCH_AFTER,'utf8'))
 const lines=weeklyPayoutLines(before,'2026-11-09'),next=weeklyPayoutLines(after,'2026-11-09')
 const values=rows=>rows.map(l=>({worker:l.worker.id,base:l.baseAmount,transport:l.transportAmount,hourly:l.eveningOvertimeMinutes,hourlyAmount:l.overtimeAmount,double:l.extraDayAmount,days:l.extraDays,late:l.lateDeduction,net:l.finalAmount})).sort((a,b)=>a.worker.localeCompare(b.worker))
 expect(values(next)).toEqual(values(lines))
 expect(new Set(next.map(l=>l.worker.id)).size).toBe(next.length)
 const report=teamWeeklyReport(before,'2026-11-09'),newReport=teamWeeklyReport(after,'2026-11-09')
 expect(newReport.totals).toEqual(report.totals)
 expect(newReport.groups.map(g=>({id:g.id,totals:g.totals}))).toEqual(report.groups.map(g=>({id:g.id,totals:g.totals})))
 api.load.mockResolvedValue(after);render(<LanguageProvider><PayrollOperations /></LanguageProvider>)
 await screen.findAllByText(String(next.length))
 expect(screen.queryByText(/canceling statement due to statement timeout/)).toBeNull()
 expect(document.querySelectorAll('[data-payroll-print-team]')).toHaveLength(newReport.groups.length)
 console.log('REAL WEEK PAYROLL PARITY',JSON.stringify({workers:next.length,teams:newReport.groups.length,totals:newReport.totals}))
})
