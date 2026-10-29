// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import WeeklyPayrollSheet from './WeeklyPayrollSheet'
vi.stubGlobal('React',React)
vi.mock('../../i18n/LanguageContext',()=>({useTranslation:()=>({language:'ar',t:key=>key})}))
afterEach(cleanup)
const line=(id,currency='CDF',extra={})=>({worker:{id,full_name:id},currency,term:{daily_rate:100,daily_transport_allowance:0,overtime_rate_per_hour:10},details:[],manualOvertimeOnly:true,presentDays:2,halfDays:1,absentDays:3,attendanceWage:250,eveningOvertimeMinutes:300,overtimeHours:5,overtimeAmount:50,transportAmount:10,finalAmount:310,...extra})
const dates=['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24']
it('last aligned table row contains attendance, wages, effective OT, transport and canonical team payable',()=>{
 const lines=[line('a'),line('b')],before=JSON.stringify(lines)
 const {container,rerender}=render(<WeeklyPayrollSheet lines={lines} dates={dates} onEdit={()=>{}} />)
 let total=container.querySelector('[data-weekly-team-total]')
 expect(total.parentElement.tagName).toBe('TFOOT')
 expect(total.closest('table').rows[total.closest('table').rows.length-1]).toBe(total)
 expect(total.querySelector('th').colSpan).toBe(7)
 expect(total.querySelectorAll('td')).toHaveLength(5)
 expect(total.textContent).toContain('إجمالي الفرقة')
 expect(total.textContent).toContain('payroll.presentDays: 4')
 expect(total.querySelector('[data-total="wages"]').textContent).toMatch(/500/)
 expect(total.querySelector('[data-total="overtime-hours"]').textContent).toBe('10h00')
 expect(total.querySelector('[data-total="overtime-amount"]').textContent).toMatch(/100/)
 expect(total.querySelector('[data-total="transport"]').textContent).toMatch(/20/)
 expect(total.querySelector('[data-total="payable"]').textContent).toMatch(/620/)
 expect(within(container).getAllByRole('columnheader',{name:'payroll.finalPay'})).toHaveLength(1)
 expect(JSON.stringify(lines)).toBe(before)
 rerender(<WeeklyPayrollSheet lines={[line('a', 'CDF',{eveningOvertimeMinutes:900,overtimeHours:15,overtimeAmount:150,finalAmount:410}),line('b')]} dates={dates} onEdit={()=>{}} />)
 total=container.querySelector('[data-weekly-team-total]')
 expect(total.querySelector('[data-total="overtime-hours"]').textContent).toBe('20h00')
 expect(total.querySelector('[data-total="payable"]').textContent).toMatch(/720/)
})
it('monthly overtime-only wages remain zero and currencies are never added together',()=>{
 const {container}=render(<WeeklyPayrollSheet lines={[line('weekly'),line('monthly','USD',{monthlyOvertimeOnly:true,attendanceWage:0,transportAmount:0,finalAmount:50})]} dates={dates} onEdit={()=>{}} />)
 const row=container.querySelector('[data-weekly-team-total]')
 const wages=row.querySelector('[data-total="wages"]')
 expect(wages.children).toHaveLength(2)
 expect(wages.textContent).toMatch(/250/)
 expect(row.querySelector('[data-total="payable"]').children).toHaveLength(2)
 expect(row.querySelector('[data-total="payable"]').textContent).toMatch(/310/)
 expect(row.querySelector('[data-total="payable"]').textContent).toMatch(/50/)
 expect(row.className).toContain('break-inside-avoid')
})
