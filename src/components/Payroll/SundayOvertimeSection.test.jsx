// @vitest-environment jsdom
import React,{useState} from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import SundayOvertimeSection from './SundayOvertimeSection'
import {sundayReportRows} from '../../utils/sundayPayroll'
import {readFileSync} from 'node:fs'
globalThis.React=React
const api=vi.hoisted(()=>({decide:vi.fn()}))
vi.mock('../../api/biometricOvertimeReviewApi',()=>({decideBiometricOvertime:api.decide}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
const date='2026-11-22'
it.skipIf(!process.env.SUNDAY_APPROVED_AUDIT)('real approved records reload with adjusted time and report money exactly once',()=>{
 const data=JSON.parse(readFileSync(process.env.SUNDAY_APPROVED_AUDIT,'utf8'))
 render(<SundayOvertimeSection date={date} sources={data.biometricOvertimeReviews} onSaved={vi.fn()}/>)
 expect(screen.queryByText('juresse')).toBeNull();expect(screen.queryByText('khonde nzita')).toBeNull()
 fireEvent.change(screen.getByLabelText('الحالة'),{target:{value:'approved'}})
 expect(screen.getAllByRole('checkbox').every(c=>c.disabled)).toBe(true)
 expect(screen.getAllByRole('button',{name:'موافقة'}).every(b=>b.disabled)).toBe(true)
 expect(screen.getByLabelText('الوقت المعتمد juresse').value).toBe('5h00')
 expect(screen.getByText('5h01')).not.toBeNull()
 expect(screen.getByLabelText('الوقت المعتمد khonde nzita').value).toBe('7h57')
 const rows=sundayReportRows(data,date)
 for(const [code,minutes,amount] of [['71',300,17500],['300',477,19875]]){
  const row=rows.find(r=>r.worker.employee_code===code)
  expect(row.overtimeMinutes).toBe(minutes);expect(row.overtimeAmount).toBe(amount)
  expect(row.netAmount).toBe(row.amount==null?null:row.amount+row.transportAmount+amount)
 }
})
it.skipIf(!process.env.SUNDAY_OT_AUDIT)('renders only real qualifying November 22 workers from canonical production sources',()=>{
 const rows=JSON.parse(readFileSync(process.env.SUNDAY_OT_AUDIT,'utf8'))
 const view=render(<SundayOvertimeSection date={date} sources={rows} onSaved={vi.fn()}/>)
 expect(screen.getByText('juresse')).not.toBeNull();expect(screen.getByText('khonde nzita')).not.toBeNull();expect(screen.queryByText('NIOKA')).toBeNull()
 expect(view.container.querySelectorAll('[data-sunday-ot-worker]')).toHaveLength(2)
 expect(screen.getByText('5h01')).not.toBeNull();expect(screen.getByText('7h57')).not.toBeNull();expect(api.decide).not.toHaveBeenCalled()
})
function sources(){return [['j','juresse','71',301,3500],['k','khonde','300',477,2500]].map(([id,name,code,minutes,rate])=>({sunday_evidence:true,work_date:date,
 worker:{id,full_name:name,employee_code:code,team_id:'t',team_name:'Chauffeur',payment_type:'monthly',is_active:true,payroll_compensation_terms:[{payment_type:'monthly',effective_from:'2026-01-01',monthly_salary:520000,currency_code:'CDF',overtime_rate_per_hour:rate}]},
 attendance:{worker_id:id,attendance_date:date,id:null},evidence:{last_at:'2026-11-22T18:01:16Z'},raw_minutes:minutes,hourly_rate:rate,currency:'CDF',source_fingerprint:id,review:null}))}
it('visible controls bulk approve/reject canonical decisions and Sunday net adds approved OT once',async()=>{
 let stored=sources()
 api.decide.mockImplementation(async(day,entries,decision)=>{expect(day).toBe(date);stored=stored.map(s=>entries.some(e=>e.worker.id===s.worker.id)?{...s,review:{decision,minutes:s.raw_minutes,version:1,source_fingerprint:s.source_fingerprint}}:s);return[]})
 function Harness(){const [rows,setRows]=useState(stored);const data={date,workers:rows.map(r=>r.worker),rules:{monthly_working_day_divisor:26},sunday_evidence:rows.map(r=>({worker_id:r.worker.id,eligible:true,punch_count:6})),biometricOvertimeReviews:rows}
  return <><output data-testid="net">{sundayReportRows(data,date).reduce((sum,r)=>sum+r.netAmount,0).toFixed(2)}</output><SundayOvertimeSection date={date} sources={rows} onSaved={async()=>setRows(stored)}/></>}
 render(<Harness/>);expect(screen.getByText('إضافي الأحد')).not.toBeNull();expect(screen.getByTestId('net').textContent).toBe('80000.00')
 fireEvent.click(screen.getByRole('button',{name:'اختيار الكل الظاهر'}));expect(screen.getAllByRole('checkbox').every(c=>c.checked)).toBe(true)
 fireEvent.click(screen.getAllByRole('button',{name:'موافقة على المختارين'})[0]);await waitFor(()=>expect(screen.getByTestId('net').textContent).toBe('117433.33'))
 expect(api.decide.mock.calls[0][1]).toHaveLength(2);expect(api.decide.mock.calls[0][2]).toBe('approved')
 expect(screen.queryByText('juresse')).toBeNull();expect(screen.queryByText('khonde')).toBeNull()
 fireEvent.change(screen.getByLabelText('الحالة'),{target:{value:'approved'}})
 expect(screen.getAllByRole('checkbox').every(c=>c.disabled)).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'موافقة على الفريق'}))
 expect(api.decide).toHaveBeenCalledTimes(1)
 expect(screen.getByTestId('net').textContent).toBe('117433.33')
})
it('pending includes stale, history is read-only, and bulk only sends actionable visible workers',async()=>{
 const rows=sources();rows.push({...rows[0],worker:{...rows[0].worker,id:'approved',full_name:'Approved'},review:{decision:'approved',minutes:301,source_fingerprint:'j'}})
 rows.push({...rows[0],worker:{...rows[0].worker,id:'rejected',full_name:'Rejected'},review:{decision:'rejected',minutes:301,source_fingerprint:'j'}})
 rows[1].review={decision:'approved',minutes:477,source_fingerprint:'old'}
 const view=render(<SundayOvertimeSection date={date} sources={rows} onSaved={vi.fn()}/>)
 expect(screen.queryByText('Approved')).toBeNull();expect(screen.queryByText('Rejected')).toBeNull()
 expect(screen.getByText('khonde')).not.toBeNull()
 fireEvent.change(screen.getByLabelText('الحالة'),{target:{value:'stale'}})
 expect(screen.queryByText('juresse')).toBeNull();expect(screen.getByText('khonde')).not.toBeNull()
 fireEvent.change(screen.getByLabelText('الحالة'),{target:{value:'all'}})
 fireEvent.click(screen.getByRole('button',{name:'اختيار الكل الظاهر'}))
 expect(screen.getByLabelText('Approved').disabled).toBe(true);expect(screen.getByLabelText('Rejected').disabled).toBe(true)
 api.decide.mockResolvedValue([])
 fireEvent.click(screen.getAllByRole('button',{name:'موافقة على المختارين'})[0])
 await waitFor(()=>expect(api.decide).toHaveBeenCalledOnce())
 expect(api.decide.mock.calls[0][1].map(r=>r.worker.id)).toEqual(['j','k'])
 view.rerender(<SundayOvertimeSection date={date} sources={rows.map(r=>({...r,review:{decision:'rejected',minutes:r.raw_minutes,source_fingerprint:r.source_fingerprint}}))} onSaved={vi.fn()}/>)
 fireEvent.change(screen.getByLabelText('الحالة'),{target:{value:'pending'}})
 expect(screen.queryByText('juresse')).toBeNull()
 fireEvent.change(screen.getByLabelText('الحالة'),{target:{value:'rejected'}})
 expect(screen.getByText('juresse')).not.toBeNull()
})
it('team approval preserves individual increases/decreases and raw evidence',async()=>{
 const rows=sources(),saved=vi.fn();api.decide.mockResolvedValue([])
 render(<SundayOvertimeSection date={date} sources={rows} onSaved={saved}/>)
 fireEvent.change(screen.getByLabelText('الوقت المعتمد juresse'),{target:{value:'4h30'}})
 fireEvent.change(screen.getByLabelText('الوقت المعتمد khonde'),{target:{value:'8h00'}})
 fireEvent.change(screen.getByLabelText('سبب التعديل juresse'),{target:{value:'مراجعة الإدارة'}})
 expect(screen.getByText('5h01')).not.toBeNull();expect(screen.getByText('7h57')).not.toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'موافقة على الفريق'}))
 await waitFor(()=>expect(saved).toHaveBeenCalledOnce())
 const entries=api.decide.mock.calls[0][1]
 expect(entries.map(r=>r.payableMinutes)).toEqual([270,480])
 expect(entries.map(r=>r.minutes)).toEqual([301,477])
 expect(entries[0].adjustmentNote).toBe('مراجعة الإدارة')
 expect(rows.every(r=>r.review===null)).toBe(true)
})
it('rejects invalid durations without writing and honors locked rows',()=>{
 const rows=sources();rows[1].locked=true
 render(<SundayOvertimeSection date={date} sources={rows} onSaved={vi.fn()}/>)
 expect(screen.getByLabelText('الوقت المعتمد khonde').disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('الوقت المعتمد juresse'),{target:{value:'bad'}})
 fireEvent.click(screen.getByRole('button',{name:'موافقة على الفريق'}))
 expect(screen.getByRole('alert')).not.toBeNull();expect(api.decide).not.toHaveBeenCalled()
})
it('filters selection to visible sources and disables locked writes',()=>{
 const rows=sources();rows[1].locked=true
 render(<SundayOvertimeSection date={date} sources={rows} search="juresse" onSaved={vi.fn()}/>)
 expect(screen.queryByText('khonde')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'اختيار الكل الظاهر'}));expect(screen.getAllByRole('checkbox')).toHaveLength(1);expect(screen.getByRole('checkbox').checked).toBe(true)
})
