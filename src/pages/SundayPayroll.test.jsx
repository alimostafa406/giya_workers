// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import {LanguageProvider} from '../i18n/LanguageContext'
import SundayPayroll from './SundayPayroll'
import WeeklyPayrollSheet from '../components/Payroll/WeeklyPayrollSheet'
import {payrollRenderedPrintCss} from '../utils/printRenderedPayroll'
import {readFileSync} from 'node:fs'
globalThis.React=React
const api=vi.hoisted(()=>({load:vi.fn(),confirm:vi.fn(),settings:vi.fn(),saveSettings:vi.fn()}))
vi.mock('../api/sundayPayrollApi',()=>({getSundayPayroll:api.load,confirmSundayPayroll:api.confirm,getWorkerSundaySettings:api.settings,saveWorkerSundaySettings:api.saveSettings}))
vi.mock('../utils/teamReportPrintLayout',()=>({payrollLandscapePrintCss:'@page{size:A4 landscape}',finishPayrollPrint:p=>p.print()}))
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();localStorage.clear()})
const date='2026-08-23'
function fixture(){return {date,rules:{},workers:[['one','One punch','A'],['two','Valid two','B'],['absent','Absent worker','Empty'],['morning','Two morning','A']].map(([id,name,team])=>({id,full_name:name,employee_code:id,team_id:team,team_name:`Team ${team}`,payment_type:'weekly',payroll_compensation_terms:[{payment_type:'weekly',effective_from:'2026-01-01',daily_rate:20000,currency_code:'CDF'}]})),
 attendance:[{worker_id:'absent',attendance_date:date,status:'absent'}],
 sunday_evidence:[{worker_id:'one',eligible:false,reason:'missing_out',punch_count:1,display_check_in:'07:05:00',display_check_out:null},{worker_id:'two',eligible:true,reason:'eligible',punch_count:2,display_check_in:'07:05:00',display_check_out:'14:03:00'},{worker_id:'absent',eligible:false,punch_count:0},{worker_id:'morning',eligible:false,punch_count:2,display_check_in:'07:02:00',display_check_out:'08:03:00'}]}}
function mount(language='en'){window.history.replaceState({},'','/payroll/sunday?date='+date);localStorage.setItem('workers_app_language',language);return render(<LanguageProvider><SundayPayroll/></LanguageProvider>)}
it('worker name opens recurring Sunday settings, saves through canonical API and keeps custom indicator across Sundays',async()=>{
 let custom=false
 api.load.mockImplementation(async day=>{const data=fixture();data.date=day;data.workers[1].sunday_settings_custom=custom;return data})
 const defaults={enabled:true,checkin_cutoff:'08:20:00',shift_end:'14:00:00',checkout_threshold:'13:30:00',pay_multiplier:2,overtime_start:'14:00:00',overtime_requires_approval:true,version:0}
 let stored=defaults
 api.settings.mockImplementation(async()=>stored);api.saveSettings.mockImplementation(async(_id,values)=>{custom=true;stored={...values,version:1};return stored})
 const view=mount('ar');await screen.findByText('Valid two')
 fireEvent.click(within(view.container.querySelector('[data-worker=two]')).getByRole('button'))
 const modal=await screen.findByRole('dialog',{name:'إعدادات الأحد — Valid two'})
 await within(modal).findByRole('button',{name:'حفظ إعدادات الأحد'})
 fireEvent.change(within(modal).getByLabelText('آخر وقت دخول مقبول'),{target:{value:'08:45'}})
 fireEvent.change(within(modal).getByLabelText('معامل أجر الأحد'),{target:{value:'2.5'}})
 fireEvent.click(within(modal).getByRole('button',{name:'حفظ إعدادات الأحد'}))
 await screen.findByText('إعدادات خاصة')
 expect(api.saveSettings).toHaveBeenCalledWith('two',expect.objectContaining({checkin_cutoff:'08:45',pay_multiplier:'2.5',overtime_requires_approval:true}),0)
 fireEvent.change(view.container.querySelector('input[type=date]'),{target:{value:'2026-08-16'}})
 await screen.findByText('إعدادات خاصة');expect(api.load).toHaveBeenLastCalledWith('2026-08-16')
 fireEvent.click(within(view.container.querySelector('[data-worker=two]')).getByRole('button'))
 const reopened=await screen.findByRole('dialog',{name:'إعدادات الأحد — Valid two'})
 const cutoff=await within(reopened).findByLabelText('آخر وقت دخول مقبول')
 expect(cutoff.value).toBe('08:45');expect(within(reopened).getByLabelText('معامل أجر الأحد').value).toBe('2.5');expect(api.settings).toHaveBeenCalledTimes(2)
})
it('screen and print align six Sunday columns and total rows without colspan or nested labels',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount('ar');await screen.findByText('Valid two')
 const expected=['العامل','البصمة الصباحية','آخر بصمة','قبض الأحد','إضافي الأحد','الصافي']
 expect([...view.container.querySelector('.sunday-team thead').querySelectorAll('th')].map(n=>n.textContent)).toEqual(expected)
 expect(view.container.querySelector('.sunday-grand thead').querySelectorAll('th')).toHaveLength(6)
 for(const total of view.container.querySelectorAll('.sunday-team tfoot tr,.sunday-grand tbody tr')){
  expect(total.children).toHaveLength(6);expect(total.querySelector('[colspan]')).toBeNull()
  expect(total.children[1].textContent).toBe('—');expect(total.children[2].textContent).toBe('—')
  expect(total.querySelector('small')).toBeNull()
 }
 expect(view.container.querySelector('.sunday-team tfoot th').textContent).toBe('إجمالي الفريق')
 expect(view.container.querySelector('.sunday-grand tbody th').textContent).toBe('الإجمالي العام')
 const report=view.container.querySelector('.sunday-report')
 for(const label of ['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','النقل','الإضافي الدوبل','عدد العمال'])expect(report.textContent).not.toContain(label)
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 fireEvent.click(screen.getByRole('button',{name:'طباعة تقرير الأحد'}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 expect([...doc.querySelector('.sunday-team thead').querySelectorAll('th')].map(n=>n.textContent)).toEqual(expected)
 expect(doc.querySelector('.sunday-grand thead').querySelectorAll('th')).toHaveLength(6)
 expect(doc.querySelector('.sunday-team tfoot tr').querySelectorAll('td')).toHaveLength(5)
 for(const total of doc.querySelectorAll('.sunday-team tfoot tr,.sunday-grand tbody tr')){
  expect(total.children).toHaveLength(6);expect(total.querySelector('[colspan]')).toBeNull();expect(total.querySelector('small')).toBeNull()
  expect(total.children[1].textContent).toBe('—');expect(total.children[2].textContent).toBe('—')
 }
 const grand=doc.querySelector('.sunday-grand tbody tr').children
 expect(grand[3].textContent).toContain('40,000');expect(grand[4].textContent).toContain('0.00');expect(grand[5].textContent).toContain('40,000')
})
it.skipIf(!process.env.SUNDAY_REPORT_AUDIT)('real November 22 NIOKA keeps the actual morning/final punches and Sunday 50000 net in six cells',async()=>{
 const data=JSON.parse(readFileSync(process.env.SUNDAY_REPORT_AUDIT,'utf8'));api.load.mockResolvedValue(data)
 window.history.replaceState({},'','/payroll/sunday?date=2026-11-22');localStorage.setItem('workers_app_language','ar')
 const view=render(<LanguageProvider><SundayPayroll/></LanguageProvider>);await screen.findByText('NIOKA')
 const cells=view.container.querySelector('[data-worker="0a8a264f-59cc-48cd-9864-676227d483d6"]').querySelectorAll('td')
 expect(cells).toHaveLength(6);expect(cells[1].textContent).toBe('08:04');expect(cells[2].textContent).toBe('13:50');expect(cells[3].textContent).toContain('50,000');expect(cells[4].textContent).toBe('—');expect(cells[5].textContent).toContain('50,000')
})
it('shares the main payroll table frame, row, worker identity and footer classes',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount();await screen.findByText('Valid two')
 const sunday=view.container.querySelector('[data-payroll-sheet="sunday"]')
 const weekly=render(<LanguageProvider><WeeklyPayrollSheet dates={['2026-08-24']} lines={[{worker:{id:'weekly',full_name:'Weekly worker',employee_code:'500'},currency:'CDF',term:{daily_rate:20000,daily_transport_allowance:0},details:[],attendanceWage:20000,finalAmount:20000,manualOvertimeOnly:true,eveningOvertimeMinutes:0}]} onEdit={()=>{}}/></LanguageProvider>).container.querySelector('[data-payroll-sheet="weekly"]')
 expect(sunday.querySelector('table').className).toBe(weekly.querySelector('table').className)
 expect(sunday.querySelector('thead').className).toBe(weekly.querySelector('thead').className)
 expect(sunday.querySelector('tbody tr').className).toBe(weekly.querySelector('tbody tr').className)
 expect(sunday.querySelector('tbody td span').className).toBe(weekly.querySelector('tbody td span').className)
 expect(sunday.querySelector('tfoot').className).toBe(weekly.querySelector('tfoot').className)
 expect(screen.queryByRole('button',{name:'اعتماد عمل الأحد'})).toBeNull()
})
it.each(['approved','pending','rejected'])('shows only canonical %s Sunday OT results in the same payroll row',async decision=>{
 const data=fixture();data.workers[1].payroll_compensation_terms[0].overtime_rate_per_hour=3000
 data.biometricOvertimeReviews=[{worker:data.workers[1],attendance:{worker_id:'two',attendance_date:date},work_date:date,sunday_evidence:true,evidence:{last_at:'2026-08-23T14:00:00Z'},hourly_rate:3000,currency:'CDF',raw_minutes:60,source_fingerprint:'f',review:{decision,minutes:60,source_fingerprint:'f'}}]
 api.load.mockResolvedValue(data);const view=mount();await screen.findAllByText('Valid two')
 const cells=view.container.querySelector('[data-worker=two]').querySelectorAll('td')
 expect(cells).toHaveLength(6)
 expect(cells[4].textContent).toBe(decision==='approved'?'CDF 3,000.00':'—')
 expect(cells[5].textContent).toContain(decision==='approved'?'43,000':'40,000')
 expect(screen.queryByRole('button',{name:'اعتماد عمل الأحد'})).toBeNull()
})
it('shows Sunday base, canonical payable manual OT, net and status in separate screen and print columns',async()=>{
 const data=fixture();data.workers[1].payroll_compensation_terms[0].overtime_rate_per_hour=3000
 data.attendance.push({worker_id:'two',attendance_date:date,status:'present',manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:120})
 api.load.mockResolvedValue(data);const view=mount();await screen.findByText('Valid two')
 const cells=view.container.querySelector('[data-worker=two]').querySelectorAll('td')
 expect(cells).toHaveLength(6);expect(cells[3].textContent).toContain('40,000');expect(cells[4].textContent).toContain('6,000');expect(cells[5].textContent).toContain('46,000')
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 fireEvent.click(screen.getByRole('button',{name:'Print Sunday report'}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 expect(doc.querySelector('[data-worker=two]').querySelectorAll('td')).toHaveLength(6);expect(doc.querySelector('[data-worker=two]').textContent).toContain('46,000')
 expect(api.confirm).not.toHaveBeenCalled()
})
it('renders persisted Sunday evidence before attendance finalization or payroll approval exists',async()=>{
 const data=fixture();data.attendance=[];data.payments=[];api.load.mockResolvedValue(data)
 const view=mount();await screen.findByText('One punch')
 expect(screen.getByText('Valid two')).not.toBeNull()
 expect(view.container.querySelectorAll('.sunday-team [data-worker]')).toHaveLength(3)
 expect(view.container.querySelector('[data-worker=one]').querySelectorAll('td')[5].textContent).toContain('0.00')
 expect(api.confirm).not.toHaveBeenCalled()
})
it('groups attendees into six-column Sunday-only team tables, keeps incomplete punches unpaid, and hides absent/empty teams',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount('ar');await screen.findByText('One punch')
 const groups=view.container.querySelectorAll('.sunday-team');expect(groups).toHaveLength(2);expect(screen.queryByText('Absent worker')).toBeNull();expect(screen.queryByText('Team Empty')).toBeNull()
 for(const group of groups){expect(group.querySelectorAll('thead th')).toHaveLength(6);expect(group.querySelector('tfoot')).not.toBeNull()}
 const one=view.container.querySelector('[data-worker=one]');expect(one.textContent).toContain('07:05');expect(one.textContent).toContain('غير مكتمل');expect(one.querySelectorAll('td')[2].textContent).toBe('—');expect(one.querySelectorAll('td')[5].textContent).toContain('0.00');expect(within(one).queryByRole('button',{name:'اعتماد عمل الأحد'})).toBeNull()
 const two=view.container.querySelector('[data-worker=two]');expect(two.textContent).toContain('14:03');expect(two.querySelectorAll('td')[5].textContent).toContain('40,000')
 const morning=view.container.querySelector('[data-worker=morning]');expect(morning.textContent).toContain('غير مكتمل');expect(morning.querySelectorAll('td')[5].textContent).toContain('0.00')
 expect(view.container.querySelector('.sunday-grand tbody').textContent).toContain('40,000')
 expect(within(two).queryByRole('button',{name:'اعتماد عمل الأحد'})).toBeNull();expect(screen.queryByText('بانتظار الاعتماد')).toBeNull()
})
it.each(['ar','en','fr'])('prints only filtered team rows with all counts, totals and landscape RTL/LTR structure (%s)',async language=>{
 api.load.mockResolvedValue(fixture());const view=mount(language);await screen.findByText('Valid two')
 fireEvent.change(view.container.querySelector('select'),{target:{value:'B'}})
 expect(screen.queryByText('One punch')).toBeNull();expect(view.container.querySelectorAll('.sunday-team')).toHaveLength(1)
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 fireEvent.click(screen.getByRole('button',{name:({ar:'طباعة تقرير الأحد',fr:'Imprimer le dimanche',en:'Print Sunday report'})[language]}));expect(popup.print).toHaveBeenCalledOnce()
 const html=popup.document.write.mock.calls[0][0],doc=new DOMParser().parseFromString(html,'text/html')
 expect(html).toContain(payrollRenderedPrintCss)
 expect(doc.querySelectorAll('.sunday-team')).toHaveLength(1);expect(doc.querySelector('.sunday-team thead').querySelectorAll('th')).toHaveLength(6);expect(doc.querySelector('.sunday-team tfoot')).not.toBeNull();expect(doc.querySelector('.sunday-grand')).not.toBeNull();expect(doc.body.textContent).not.toContain('One punch');expect(doc.body.textContent).toContain('40,000');expect(doc.querySelector('button')).toBeNull();expect(html).toContain('A4 landscape');expect(doc.documentElement.dir).toBe(language==='ar'?'rtl':'ltr')
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'no match'}});expect(view.container.querySelectorAll('.sunday-team')).toHaveLength(0)
})
it('rejects a non-Sunday without requesting/replacing the selected date',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount();await screen.findByText('One punch');const input=view.container.querySelector('input[type=date]');fireEvent.change(input,{target:{value:'2026-08-24'}});expect(input.value).toBe(date);expect(api.load).toHaveBeenCalledTimes(1)
})
