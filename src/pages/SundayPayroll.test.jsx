// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../i18n/LanguageContext'
import SundayPayroll from './SundayPayroll'
globalThis.React=React
const api=vi.hoisted(()=>({load:vi.fn(),confirm:vi.fn()}))
vi.mock('../api/sundayPayrollApi',()=>({getSundayPayroll:api.load,confirmSundayPayroll:api.confirm}))
vi.mock('../utils/teamReportPrintLayout',()=>({payrollLandscapePrintCss:'@page{size:A4 landscape}',finishPayrollPrint:p=>p.print()}))
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear()})
it('renders Sunday evidence, filters visible print rows and approves through the canonical writer',async()=>{
 window.history.replaceState({},'','/payroll/sunday?date=2026-10-18')
 localStorage.setItem('workers_app_language','en')
 const workers=['MUNIANGA','Other'].map((name,i)=>({id:String(i),full_name:name,employee_code:String(346+i),team_id:String(i),team_name:`Team ${i}`,payment_type:'weekly',payroll_compensation_terms:[{payment_type:'weekly',effective_from:'2026-01-01',daily_rate:20000,currency_code:'CDF'}]}))
 api.load.mockResolvedValue({date:'2026-10-18',workers,attendance:workers.map(w=>({worker_id:w.id,attendance_date:'2026-10-18',status:'present',attendance_day_fraction:1,attendance_source:'outside_work',updated_at:'version'})),rules:{},sunday_evidence:workers.map(w=>({worker_id:w.id,eligible:true,reason:'eligible',morning:'07:05:00',checkout:'14:03:00'}))})
 api.confirm.mockResolvedValue({})
 render(<LanguageProvider><SundayPayroll/></LanguageProvider>)
 await screen.findByText('MUNIANGA');expect(screen.getAllByRole('columnheader')).toHaveLength(10)
 const input=document.querySelector('input[type=date]');fireEvent.change(input,{target:{value:'2026-10-19'}});expect(input.value).toBe('2026-10-18');expect(api.load).toHaveBeenCalledTimes(1)
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'MUNIANGA'}});expect(screen.queryByText('Other')).toBeNull()
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 fireEvent.click(screen.getByRole('button',{name:'Print Sunday report'}));expect(popup.print).toHaveBeenCalledOnce();const html=popup.document.write.mock.calls[0][0];expect(html).toContain('MUNIANGA');expect(html).not.toContain('Other');expect(html).not.toContain('<button');expect(html).toContain('A4 landscape')
 fireEvent.click(screen.getByRole('button',{name:'Approve Sunday work'}));await waitFor(()=>expect(api.confirm).toHaveBeenCalledOnce());expect(api.confirm.mock.calls[0][1]).toBe('2026-10-18');await waitFor(()=>expect(api.load).toHaveBeenCalledTimes(2))
})
