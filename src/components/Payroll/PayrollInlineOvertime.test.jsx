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
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks()})
async function openTeam(name = /^Team/){render(<LanguageProvider><PayrollOperations /></LanguageProvider>);fireEvent.click(await screen.findByRole('button',{name}));return document.querySelector('[data-weekly-payroll-sheet]')}
const row = (table,name)=>within(table).getByRole('button',{name:new RegExp(`^${name}`)}).closest('tr')

it('PAYIKE monthly Chauffeur saves manual weekly OT from actual payroll controls at 3500 without base salary', async () => {
  data.workers = [{ ...data.workers[1], full_name: 'PAYIKE', employee_code: '63', team_name: 'Chauffeur',
    payroll_compensation: { ...data.workers[1].payroll_compensation, overtime_rate_per_hour: 3500 } }]
  data.weeklyOvertimeOverrides = [{ worker_id: 'monthly', minutes: 0, version: 1 }]
  const table = await openTeam('Chauffeur'), r = row(table, 'PAYIKE')
  fireEvent.click(within(r).getByRole('button', { name: /Overtime Hours/ }))
  fireEvent.change(within(r).getByRole('textbox'), { target: { value: '5:00' } })
  fireEvent.click(within(r).getByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(within(row(table, 'PAYIKE')).queryByRole('textbox')).toBeNull())
  expect(api.save).toHaveBeenCalledWith({ week: '2026-10-19', entries: [{ worker_id: 'monthly', minutes: 300, expected_version: 1 }] })
  expect(row(table, 'PAYIKE').textContent).toContain('5h00')
  expect(row(table, 'PAYIKE').textContent).toContain('17,500')
  expect(teamWeeklyReport(data, '2026-10-19').lines[0]).toMatchObject({ basePay: 0, minutes: 300, overtimeAmount: 17500, finalAmount: 17500 })
})

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
  const popup={document:{write:vi.fn(),close:vi.fn(),fonts:{ready:Promise.resolve()}},focus:vi.fn(),print:vi.fn()}
  vi.spyOn(window,'open').mockReturnValue(popup)
  const actions=within(document.querySelector('[data-weekly-team-review]'))
  fireEvent.click(actions.getByRole('button',{name:/^Print$/i}))
  const printed=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
  expect(printed.querySelector('table').textContent).toContain('15h00')
  expect(printed.querySelector('tfoot').textContent).toBe(table.querySelector('tfoot').textContent)
  fireEvent.click(actions.getByRole('button',{name:/PDF/i}))
  expect(popup.document.write.mock.calls[1][0]).toBe(popup.document.write.mock.calls[0][0])
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

it('page-level Print All Teams uses every current React table including its totals row',async()=>{
  data.workers[1].team_id='other';data.workers[1].team_name='Other team'
  const popup={document:{write:vi.fn(),close:vi.fn(),fonts:{ready:Promise.resolve()}},focus:vi.fn(),print:vi.fn()}
  vi.spyOn(window,'open').mockReturnValue(popup)
  render(<LanguageProvider><PayrollOperations /></LanguageProvider>)
  const print=await screen.findByRole('button',{name:/Print All Teams/i})
  await waitFor(()=>expect(print.disabled).toBe(false))
  fireEvent.click(print)
  const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
  expect(doc.querySelectorAll('table')).toHaveLength(2)
  expect(doc.querySelectorAll('tfoot')).toHaveLength(2)
  const originals=document.querySelectorAll('[data-payroll-all-teams-print-source] table')
  expect(originals).toHaveLength(2)
  doc.querySelectorAll('table').forEach((table,index)=>{
    expect(table.querySelector('tfoot').textContent).toBe(originals[index].querySelector('tfoot').textContent)
    expect(table.querySelector('tbody tr').cells[0].textContent).toBe(originals[index].querySelector('tbody tr').cells[0].textContent)
  })
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
