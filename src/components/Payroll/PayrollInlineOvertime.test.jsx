// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LanguageProvider } from '../../i18n/LanguageContext'
import PayrollOperations from './PayrollOperations'
import { teamWeeklyReport } from '../../utils/teamWeeklyReport'
import { weeklyPayoutLines } from '../../utils/weeklyPayoutLines'
import { payrollDraftLinePayload } from '../../api/payrollOperationsApi'

globalThis.React = React
const api = vi.hoisted(()=>({ load:vi.fn(), save:vi.fn() }))
vi.mock('../../api/payrollOperationsApi', async (original)=>({ ...await original(), getPayrollOperationsDataRequest:api.load }))
vi.mock('../../api/weeklyOvertimeApi', ()=>({saveWeeklyOvertime:api.save}))
vi.mock('../../utils/payrollCalculations', async (original)=>({ ...await original(), mondayFor:()=> '2026-10-19' }))
let data
beforeEach(()=>{
  localStorage.setItem('workers_app_language','en')
  data = { workers:['weekly','monthly'].map((type,i)=>({ id:type, full_name:type, employee_code:String(i+1), payment_type:type, is_active:true, staff_classification:'normal', team_id:'t', team_name:'Team',
    payroll_compensation:{ daily_rate:100, daily_transport_allowance:0, monthly_salary:999999, currency_code:'CDF', overtime_rate_per_hour:10 } })),
    weeklyOvertimeOverrides:['weekly','monthly'].map(worker_id=>({worker_id,minutes:300,version:1})), attendance:[], rules:{id:'rules'}, holidays:[], runs:[], payrollLines:[], payrollAdjustments:[], sundayPayments:[], outsideWorkMovements:[],biometricOvertimeReviews:[] }
  // Daily overtime is deliberately different: the weekly override must replace it.
  data.attendance=['weekly','monthly'].map(worker_id=>({ worker_id,attendance_date:'2026-10-19',status:'present',check_in:'08:00:00',check_out:'20:00:00',attendance_day_fraction:1,manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:120 }))
  api.load.mockImplementation(async()=>structuredClone(data))
  api.save.mockImplementation(async({entries})=>{ for(const e of entries){const o=data.weeklyOvertimeOverrides.find(x=>x.worker_id===e.worker_id);o.minutes=e.minutes;o.version++}return [] })
})
afterEach(()=>{cleanup();vi.clearAllMocks()})
async function openTeam(){render(<LanguageProvider><PayrollOperations /></LanguageProvider>);fireEvent.click(await screen.findByRole('button',{name:/^Team/}));return document.querySelector('[data-weekly-payroll-sheet]')}
const row = (table,name)=>within(table).getByRole('button',{name:new RegExp(`^${name}`)}).closest('tr')

it('one OT column, visible 5h -> 15h save, canonical versioned override, monthly-only payouts, clear fallback and report/team totals',async()=>{
  const table=await openTeam()
  expect(within(table).getAllByRole('columnheader',{name:'Overtime Hours'})).toHaveLength(1)
  expect(table.textContent).not.toMatch(/Morning Overtime|Evening Overtime/)
  for(const name of ['weekly','monthly']){
    const r=row(table,name)
    fireEvent.click(within(r).getByRole('button',{name:/Overtime Hours/}))
    const input=within(r).getByRole('textbox')
    expect(input.type).toBe('text');expect(input.value).toBe('5:00')
    fireEvent.change(input,{target:{value:'15:00'}})
    fireEvent.click(within(r).getByRole('button',{name:'Save',exact:true}))
    await waitFor(()=>expect(within(row(table,name)).queryByRole('textbox')).toBeNull())
    expect(within(row(table,name)).getByRole('button',{name:/Overtime Hours/}).textContent).toBe('15h00')
    expect(api.save).toHaveBeenCalledWith({week:'2026-10-19',entries:[{worker_id:name,minutes:900,expected_version:1}]})
    expect(row(table,name).textContent).toMatch(/150\.00/)
  }
  const report=teamWeeklyReport(data,'2026-10-19')
  expect(report.lines.find(l=>l.worker.id==='monthly')).toMatchObject({minutes:900,basePay:0,overtimeAmount:150,finalAmount:150})
  expect(report.lines.find(l=>l.worker.id==='weekly')).toMatchObject({minutes:900,overtimeAmount:150})
  expect(report.groups[0].totals.minutes).toBe(1800)
  expect(report.totals.minutes).toBe(1800)
  expect(report.totals.currencies.CDF.overtimeAmount).toBe(300)
  const r=row(table,'monthly');fireEvent.click(within(r).getByRole('button',{name:/Overtime Hours/}));fireEvent.click(within(r).getByRole('button',{name:'Clear weekly override'}))
  await waitFor(()=>expect(within(row(table,'monthly')).getByRole('button',{name:/Overtime Hours/}).textContent).toBe('2h00'))
  expect(api.save).toHaveBeenLastCalledWith({week:'2026-10-19',entries:[{worker_id:'monthly',minutes:null,expected_version:2}]})
  expect(teamWeeklyReport(data,'2026-10-19').lines.find(l=>l.worker.id==='monthly')).toMatchObject({minutes:120,basePay:0,finalAmount:20})
})

it.each(['reviewed','finalized','paid'])('%s snapshots have read-only locked overtime',async status=>{
  data.payrollLines=weeklyPayoutLines(data,'2026-10-19').map(l=>payrollDraftLinePayload('run',l,'2026-10-19','2026-10-24','2026-10-24'))
  data.runs=[{id:'run',payment_type:'weekly',weekly_period_start:'2026-10-19',weekly_period_end:'2026-10-24',scheduled_payment_date:'2026-10-24',status}]
  const before=JSON.stringify(data.payrollLines),table=await openTeam()
  expect(within(table).queryByRole('button',{name:/Overtime Hours/})).toBeNull()
  expect(within(table).getAllByText('Locked')).toHaveLength(2)
  expect(api.save).not.toHaveBeenCalled();expect(JSON.stringify(data.payrollLines)).toBe(before)
})

it.each(['25:30','40:00'])('duration %s can be saved; cancel never writes',async value=>{
  const table=await openTeam(),r=row(table,'weekly')
  fireEvent.click(within(r).getByRole('button',{name:/Overtime Hours/}))
  fireEvent.change(within(r).getByRole('textbox'),{target:{value}})
  fireEvent.click(within(r).getByRole('button',{name:'Cancel'}));expect(api.save).not.toHaveBeenCalled()
  fireEvent.click(within(r).getByRole('button',{name:/Overtime Hours/}));fireEvent.change(within(r).getByRole('textbox'),{target:{value}})
  fireEvent.click(within(r).getByRole('button',{name:'Save',exact:true}))
  const [h,m]=value.split(':').map(Number)
  await waitFor(()=>expect(api.save).toHaveBeenCalledWith({week:'2026-10-19',entries:[{worker_id:'weekly',minutes:h*60+m,expected_version:1}]}))
})
