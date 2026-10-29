// @vitest-environment jsdom
import React from 'react'
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import { LanguageProvider } from '../i18n/LanguageContext'
import WeeklyPayrollSheet from '../components/Payroll/WeeklyPayrollSheet'
import { renderedPayrollTableHtml, printRenderedPayrollTables } from './printRenderedPayroll'
globalThis.React=React
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const dates=['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24']
const makeLine=(id,minutes=300)=>({worker:{id,full_name:id,employee_code:id},currency:'CDF',term:{daily_rate:100,daily_transport_allowance:0,overtime_rate_per_hour:10},manualOvertimeOnly:true,eveningOvertimeMinutes:minutes,overtimeHours:minutes/60,overtimeAmount:minutes/6,attendanceWage:250,transportAmount:0,finalAmount:250+minutes/6,presentDays:2,halfDays:1,absentDays:3,details:dates.map((date,i)=>({date,status:i===1?'half_day':i===2?'absent':'present'}))})
const popup=()=>({document:{write:vi.fn(),close:vi.fn(),fonts:{ready:Promise.resolve()}},focus:vi.fn(),print:vi.fn()})
it.each(['ar','fr'])('%s print clones the current table cells/order/statuses/totals, with no editor controls',async language=>{
 localStorage.setItem('workers_app_language',language)
 const lines=[makeLine('SECOND'),makeLine('FIRST')],save=vi.fn()
 const view=render(<LanguageProvider><WeeklyPayrollSheet lines={lines} dates={dates} onEdit={()=>{}} editable onSaveOvertime={save} /></LanguageProvider>)
 const source=view.container.querySelector('table')
 const p=popup();vi.spyOn(window,'open').mockReturnValue(p)
 fireEvent.click(screen.getByRole('button',{name:/SECOND: 5h00/}))
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'40:00'}}) // unsaved text must never replace effective OT
 printRenderedPayrollTables([{name:'Raw Team',element:source}],{title:'Payroll',language,direction:language==='ar'?'rtl':'ltr'})
 await waitFor(()=>expect(p.print).toHaveBeenCalled())
 let doc=new DOMParser().parseFromString(p.document.write.mock.calls[0][0],'text/html')
 expect(doc.documentElement.lang).toBe(language)
 expect(doc.documentElement.dir).toBe(language==='ar'?'rtl':'ltr')
 expect(doc.querySelectorAll('button,input,select,textarea')).toHaveLength(0)
 expect(doc.querySelectorAll('tbody tr')).toHaveLength(2)
 expect([...doc.querySelectorAll('tbody tr')].map(r=>r.cells[0].textContent)).toEqual([...source.querySelectorAll('tbody tr')].map(r=>r.cells[0].textContent))
 expect([...doc.querySelectorAll('thead th')].map(c=>c.textContent)).toEqual([...source.querySelectorAll('thead th')].map(c=>c.textContent))
 for(let i=0;i<2;i++){
   const printed=doc.querySelectorAll('tbody tr')[i],visible=source.querySelectorAll('tbody tr')[i]
   for(let col=1;col<printed.cells.length;col++){
     const expected=visible.cells[col].querySelector('[data-payroll-print-value]')?.textContent ?? visible.cells[col].textContent
     expect(printed.cells[col].textContent).toBe(expected)
   }
 }
 expect(doc.querySelector('tfoot').textContent).toBe(source.querySelector('tfoot').textContent)
 expect(doc.body.textContent).not.toContain('40:00')
 expect(doc.body.textContent).not.toMatch(/إضافي صباحي|إضافي مسائي/)
 // After canonical data updates, the same rendered table supplies the next print.
 view.rerender(<LanguageProvider><WeeklyPayrollSheet lines={[makeLine('SECOND',900),lines[1]]} dates={dates} onEdit={()=>{}} editable onSaveOvertime={save} /></LanguageProvider>)
 printRenderedPayrollTables([{name:'Raw Team',element:source}],{title:'Payroll',language,direction:language==='ar'?'rtl':'ltr'})
 doc=new DOMParser().parseFromString(p.document.write.mock.calls[1][0],'text/html')
 expect(doc.querySelector('tbody').textContent).toContain('15h00')
 expect(doc.querySelector('tfoot [data-total="overtime-hours"]').textContent).toBe('20h00')
 expect(doc.querySelector('tfoot').textContent).toBe(source.querySelector('tfoot').textContent)
 expect(save).not.toHaveBeenCalled()
})
it('all teams use the same rendered component and preserve team page breaks',()=>{
 const view=render(<LanguageProvider><div data-team="one"><WeeklyPayrollSheet lines={[makeLine('A')]} dates={dates} onEdit={()=>{}} /></div><div data-team="two"><WeeklyPayrollSheet lines={[makeLine('B'),makeLine('C')]} dates={dates} onEdit={()=>{}} /></div></LanguageProvider>)
 const p=popup();vi.spyOn(window,'open').mockReturnValue(p)
 printRenderedPayrollTables([{name:'One',element:view.container.querySelector('[data-team="one"]')},{name:'Two',element:view.container.querySelector('[data-team="two"]')}],{title:'Payroll',language:'en',direction:'ltr'})
 const html=p.document.write.mock.calls[0][0],doc=new DOMParser().parseFromString(html,'text/html')
 expect(doc.querySelectorAll('.team')).toHaveLength(2)
 expect(doc.querySelectorAll('tbody tr')).toHaveLength(3)
 expect(doc.querySelectorAll('tfoot')).toHaveLength(2)
 expect(html).toContain('A4 landscape');expect(html).toContain('break-before:page')
 expect(()=>renderedPayrollTableHtml(null)).toThrow('not ready')
})
