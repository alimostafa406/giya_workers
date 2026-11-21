// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import ManualOvertimeExceptions from './ManualOvertimeExceptions'
globalThis.React=React
const api=vi.hoisted(()=>({load:vi.fn(),save:vi.fn()}))
vi.mock('../api/extraDayOvertimeApi',()=>({getExtraDayTeams:async()=>[{id:'t',name:'Team'}]}))
vi.mock('../api/manualOvertimeExceptionApi',()=>({getManualOvertimeExceptions:api.load,saveManualOvertimeException:api.save}))
vi.mock('../utils/attendanceOperationalGate',()=>({kinshasaClock:()=>({date:'2026-11-21'})}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('uses visible controls for create, edit and soft-clear, with separate money previews',async()=>{
 let entries=[]
 api.load.mockImplementation(async()=>({workers:[{id:'w',full_name:'Worker',employee_code:'1'}],entries,rates:{daily_wage:20000,hourly_rate:3000,currency:'CDF',fingerprint:'rates'},locked:false}))
 api.save.mockImplementation(async values=>{entries=[{id:'e',worker_id:'w',worker_name:'Worker',employee_code:'1',work_date:'2026-11-21',extra_days:values.p_days,extra_minutes:values.p_minutes,note:values.p_note,version:values.p_version+1,active:!values.p_clear,full_day_amount:20000,hourly_amount:6000,total_amount:26000,currency_code:'CDF',history:[]}];return entries[0]})
 render(<ManualOvertimeExceptions/>);await screen.findByRole('option',{name:'Team'})
 fireEvent.change(screen.getByLabelText('الفريق'),{target:{value:'t'}});await screen.findByRole('option',{name:'Worker #1'})
 fireEvent.change(screen.getByLabelText('العامل'),{target:{value:'w'}});await screen.findByLabelText('أيام إضافية كاملة')
 fireEvent.change(screen.getByLabelText('ساعات إضافية'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('الملاحظة / السبب'),{target:{value:'Approved exception'}})
 expect(screen.getByText('الإجمالي:').textContent).toContain('26,000')
 fireEvent.click(screen.getByRole('button',{name:'حفظ الاستثناء'}));await waitFor(()=>expect(api.save).toHaveBeenCalledOnce());expect(api.save.mock.calls[0][0]).toMatchObject({p_days:1,p_minutes:120,p_version:0,p_clear:false,p_rate_fingerprint:'rates'})
 await waitFor(()=>expect(screen.getByRole('button',{name:'إلغاء الاستثناء وحفظ السجل'}).disabled).toBe(false))
 fireEvent.change(screen.getByLabelText('أيام إضافية كاملة'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:'حفظ الاستثناء'}));await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(2));expect(api.save.mock.calls[1][0]).toMatchObject({p_days:2,p_minutes:120,p_version:1})
 await waitFor(()=>expect(screen.getByLabelText('أيام إضافية كاملة').value).toBe('2'))
 await waitFor(()=>expect(screen.getByRole('button',{name:'إلغاء الاستثناء وحفظ السجل'}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'إلغاء الاستثناء وحفظ السجل'}));await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(3));expect(api.save.mock.calls[2][0]).toMatchObject({p_clear:true,p_version:2})
})
