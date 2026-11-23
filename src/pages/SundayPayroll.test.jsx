// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import {LanguageProvider} from '../i18n/LanguageContext'
import SundayPayroll from './SundayPayroll'
globalThis.React=React
const api=vi.hoisted(()=>({load:vi.fn(),confirm:vi.fn()}))
vi.mock('../api/sundayPayrollApi',()=>({getSundayPayroll:api.load,confirmSundayPayroll:api.confirm}))
vi.mock('../utils/teamReportPrintLayout',()=>({payrollLandscapePrintCss:'@page{size:A4 landscape}',finishPayrollPrint:p=>p.print()}))
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();localStorage.clear()})
const date='2026-08-23'
function fixture(){return {date,rules:{},workers:[['one','One punch','A'],['two','Valid two','B'],['absent','Absent worker','Empty'],['morning','Two morning','A']].map(([id,name,team])=>({id,full_name:name,employee_code:id,team_id:team,team_name:`Team ${team}`,payment_type:'weekly',payroll_compensation_terms:[{payment_type:'weekly',effective_from:'2026-01-01',daily_rate:20000,currency_code:'CDF'}]})),
 attendance:[{worker_id:'absent',attendance_date:date,status:'absent'}],
 sunday_evidence:[{worker_id:'one',eligible:false,reason:'missing_out',punch_count:1,display_check_in:'07:05:00',display_check_out:null},{worker_id:'two',eligible:true,reason:'eligible',punch_count:2,display_check_in:'07:05:00',display_check_out:'14:03:00'},{worker_id:'absent',eligible:false,punch_count:0},{worker_id:'morning',eligible:false,punch_count:2,display_check_in:'07:02:00',display_check_out:'08:03:00'}]}}
function mount(language='en'){window.history.replaceState({},'','/payroll/sunday?date='+date);localStorage.setItem('workers_app_language',language);return render(<LanguageProvider><SundayPayroll/></LanguageProvider>)}
it('shows Sunday base, canonical payable manual OT, net and status in separate screen and print columns',async()=>{
 const data=fixture();data.workers[1].payroll_compensation_terms[0].overtime_rate_per_hour=3000
 data.attendance.push({worker_id:'two',attendance_date:date,status:'present',manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:120})
 api.load.mockResolvedValue(data);const view=mount();await screen.findByText('Valid two')
 const cells=view.container.querySelector('[data-worker=two]').querySelectorAll('td')
 expect(cells).toHaveLength(8);expect(cells[4].textContent).toContain('40,000');expect(cells[5].textContent).toBe('2h00');expect(cells[6].textContent).toContain('6,000');expect(cells[7].textContent).toContain('46,000')
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 fireEvent.click(screen.getByRole('button',{name:'Print Sunday report'}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 expect(doc.querySelector('[data-worker=two]').textContent).toContain('2h00');expect(doc.querySelector('[data-worker=two]').textContent).toContain('46,000')
 expect(api.confirm).not.toHaveBeenCalled()
})
it('renders persisted Sunday evidence before attendance finalization or payroll approval exists',async()=>{
 const data=fixture();data.attendance=[];data.payments=[];api.load.mockResolvedValue(data)
 const view=mount();await screen.findByText('One punch')
 expect(screen.getByText('Valid two')).not.toBeNull()
 expect(view.container.querySelectorAll('.sunday-team [data-worker]')).toHaveLength(3)
 expect(view.container.querySelector('[data-worker=one]').querySelectorAll('td')[7].textContent).toContain('0.00')
 expect(api.confirm).not.toHaveBeenCalled()
})
it('groups attendees into nine-column team tables, keeps incomplete punches unpaid, and hides absent/empty teams',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount('ar');await screen.findByText('One punch')
 const groups=view.container.querySelectorAll('.sunday-team');expect(groups).toHaveLength(2);expect(screen.queryByText('Absent worker')).toBeNull();expect(screen.queryByText('Team Empty')).toBeNull()
 for(const group of groups){expect(group.querySelectorAll('thead th')).toHaveLength(8);expect(group.querySelector('tfoot')).not.toBeNull()}
 const one=view.container.querySelector('[data-worker=one]');expect(one.textContent).toContain('07:05');expect(one.textContent).toContain('غير مكتمل');expect(one.querySelectorAll('td')[2].textContent).toBe('—');expect(one.querySelectorAll('td')[7].textContent).toContain('0.00');expect(within(one).queryByRole('button')).toBeNull()
 const two=view.container.querySelector('[data-worker=two]');expect(two.textContent).toContain('14:03');expect(two.querySelectorAll('td')[7].textContent).toContain('40,000')
 const morning=view.container.querySelector('[data-worker=morning]');expect(morning.textContent).toContain('غير مكتمل');expect(morning.querySelectorAll('td')[7].textContent).toContain('0.00')
 expect(view.container.querySelector('.sunday-grand tbody').textContent).toContain('40,000')
 expect(within(two).queryByRole('button')).toBeNull();expect(screen.queryByText('بانتظار الاعتماد')).toBeNull()
})
it.each(['ar','en','fr'])('prints only filtered team rows with all counts, totals and landscape RTL/LTR structure (%s)',async language=>{
 api.load.mockResolvedValue(fixture());const view=mount(language);await screen.findByText('Valid two')
 fireEvent.change(view.container.querySelector('select'),{target:{value:'B'}})
 expect(screen.queryByText('One punch')).toBeNull();expect(view.container.querySelectorAll('.sunday-team')).toHaveLength(1)
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 fireEvent.click(screen.getByRole('button',{name:({ar:'طباعة تقرير الأحد',fr:'Imprimer le dimanche',en:'Print Sunday report'})[language]}));expect(popup.print).toHaveBeenCalledOnce()
 const html=popup.document.write.mock.calls[0][0],doc=new DOMParser().parseFromString(html,'text/html')
 expect(doc.querySelectorAll('.sunday-team')).toHaveLength(1);expect(doc.querySelector('.sunday-team thead').querySelectorAll('th')).toHaveLength(8);expect(doc.querySelector('.sunday-team tfoot')).not.toBeNull();expect(doc.querySelector('.sunday-grand')).not.toBeNull();expect(doc.body.textContent).not.toContain('One punch');expect(doc.body.textContent).toContain('40,000');expect(doc.querySelector('button')).toBeNull();expect(html).toContain('A4 landscape');expect(doc.documentElement.dir).toBe(language==='ar'?'rtl':'ltr')
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'no match'}});expect(view.container.querySelectorAll('.sunday-team')).toHaveLength(0)
})
it('rejects a non-Sunday without requesting/replacing the selected date',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount();await screen.findByText('One punch');const input=view.container.querySelector('input[type=date]');fireEvent.change(input,{target:{value:'2026-08-24'}});expect(input.value).toBe(date);expect(api.load).toHaveBeenCalledTimes(1)
})
