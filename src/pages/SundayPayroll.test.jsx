// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react'
import {LanguageProvider} from '../i18n/LanguageContext'
import SundayPayroll from './SundayPayroll'
import WeeklyPayrollSheet from '../components/Payroll/WeeklyPayrollSheet'
import {payrollRenderedPrintCss} from '../utils/printRenderedPayroll'
import {readFileSync} from 'node:fs'
globalThis.React=React
const api=vi.hoisted(()=>({load:vi.fn(),confirm:vi.fn(),settings:vi.fn(),saveSettings:vi.fn(),saveEvidence:vi.fn()}))
vi.mock('../api/biometricOvertimeReviewApi',()=>({saveSundayEvidence:api.saveEvidence}))
vi.mock('../api/sundayPayrollApi',()=>({getSundayPayroll:api.load,confirmSundayPayroll:api.confirm,getWorkerSundaySettings:api.settings,saveWorkerSundaySettings:api.saveSettings}))
vi.mock('../utils/teamReportPrintLayout',()=>({payrollLandscapePrintCss:'@page{size:A4 landscape}',finishPayrollPrint:p=>p.print()}))
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();localStorage.clear()})
const date='2026-08-23'
function fixture(){return {date,rules:{},workers:[['one','One punch','A'],['two','Valid two','B'],['absent','Absent worker','Empty'],['morning','Two morning','A']].map(([id,name,team])=>({id,full_name:name,employee_code:id,team_id:team,team_name:`Team ${team}`,payment_type:'weekly',payroll_compensation_terms:[{payment_type:'weekly',effective_from:'2026-01-01',daily_rate:20000,currency_code:'CDF'}]})),
 attendance:[{worker_id:'absent',attendance_date:date,status:'absent'}],
 sunday_evidence:[{worker_id:'one',eligible:false,reason:'missing_out',punch_count:1,display_check_in:'07:05:00',display_check_out:null},{worker_id:'two',eligible:true,reason:'eligible',punch_count:2,display_check_in:'07:05:00',display_check_out:'14:03:00'},{worker_id:'absent',eligible:false,punch_count:0},{worker_id:'morning',eligible:false,punch_count:2,display_check_in:'07:02:00',display_check_out:'08:03:00'}]}}
function mount(language='en'){window.history.replaceState({},'','/payroll/sunday?date='+date);localStorage.setItem('workers_app_language',language);return render(<LanguageProvider><SundayPayroll/></LanguageProvider>)}
it.skipIf(!process.env.SUNDAY_REPORT_EDIT_AUDIT)('real November 22 IFASO dash and EMMANUEL clocks are enabled inline controls',async()=>{
 const data=JSON.parse(readFileSync(process.env.SUNDAY_REPORT_EDIT_AUDIT,'utf8'));api.load.mockResolvedValue(data)
 window.history.replaceState(null,'','/payroll/sunday?date=2026-11-22');localStorage.setItem('workers_app_language','ar')
 render(<LanguageProvider><SundayPayroll/></LanguageProvider>);await screen.findByText('IFASO')
 for(const [label,text] of [['البصمة الصباحية IFASO','—'],['البصمة الصباحية EMMANUEL','08:28'],['آخر بصمة EMMANUEL','08:28']]){
  const button=screen.getByLabelText(label);expect(button.disabled).toBe(false);expect(button.textContent).toBe(text)
  fireEvent.click(button);expect(screen.getByLabelText(label).tagName).toBe('INPUT')
  fireEvent.keyDown(screen.getByLabelText(label),{key:'Escape'})
 }
 expect(api.saveEvidence).not.toHaveBeenCalled()
})
it('IFASO dash and EMMANUEL clocks edit inline, refresh eligibility/pay and keep OT pending',async()=>{
 const day='2026-11-22',workers=[['i','IFASO','19'],['e','EMMANUEL','20']].map(([id,full_name,employee_code])=>({id,full_name,employee_code,team_id:'t',team_name:'Adminstration',payment_type:'weekly',payroll_compensation_terms:[{payment_type:'weekly',daily_rate:25000,overtime_rate_per_hour:3500,currency_code:'CDF',effective_from:'2026-01-01'}]}))
 let state={date:day,workers,sunday_evidence:[{worker_id:'i',eligible:false,punch_count:1,first_punch:'14:02:01',last_punch:'14:02:01',display_check_in:null,display_check_out:'14:02:01'},{worker_id:'e',eligible:false,punch_count:1,first_punch:'08:28:38',last_punch:'08:28:38',display_check_in:'08:28:38'}],biometricOvertimeReviews:[],sundayEvidenceEditSources:workers.map((worker,i)=>({worker,work_date:day,sunday_evidence:true,attendance:{worker_id:worker.id,attendance_date:day},evidence:{first_at:`${day}T${i?'07:28:38':'13:02:01'}Z`,last_at:`${day}T${i?'07:28:38':'13:02:01'}Z`},raw_minutes:i?0:2,source_fingerprint:worker.id,sunday_settings:{overtime_start:'14:00:00'},hourly_rate:3500,currency:'CDF',review:null}))}
 const raw=state.sundayEvidenceEditSources.map(s=>JSON.stringify(s.evidence))
 api.load.mockImplementation(async()=>structuredClone(state))
 api.saveEvidence.mockImplementation(async(_day,s,payload)=>{
  const next={...s,source_fingerprint:s.source_fingerprint+'v',approved_evidence_valid:true,approved_evidence:{version:(s.approved_evidence?.version||0)+1,approved_first_punch:payload.first,approved_last_punch:payload.last},suggested_approved_minutes:payload.minutes}
  state={...state,sundayEvidenceEditSources:state.sundayEvidenceEditSources.map(x=>x.worker.id===s.worker.id?next:x),biometricOvertimeReviews:payload.minutes>0?[next]:[],sunday_evidence:state.sunday_evidence.map(e=>e.worker_id===s.worker.id?{...e,admin_evidence_override:true,eligible:payload.first.slice(11,16)<='08:20'&&payload.last.slice(11,16)>='13:30',display_check_in:payload.first.slice(11,19),display_check_out:payload.last.slice(11,19)}:e)}
 })
 window.history.replaceState(null,'','/payroll/sunday?date='+day);localStorage.setItem('workers_app_language','ar')
 render(<LanguageProvider><SundayPayroll/></LanguageProvider>);await screen.findByText('IFASO')
 expect(screen.getByLabelText('البصمة الصباحية IFASO').textContent).toBe('—')
 fireEvent.click(screen.getByLabelText('البصمة الصباحية IFASO'))
 fireEvent.change(screen.getByLabelText('البصمة الصباحية IFASO'),{target:{value:'08:05'}})
 fireEvent.keyDown(screen.getByLabelText('البصمة الصباحية IFASO'),{key:'Escape'});expect(api.saveEvidence).not.toHaveBeenCalled()
 const edit=async(label,value,count)=>{fireEvent.click(screen.getByLabelText(label));fireEvent.change(screen.getByLabelText(label),{target:{value}});fireEvent.keyDown(screen.getByLabelText(label),{key:'Enter'});await waitFor(()=>expect(api.load).toHaveBeenCalledTimes(count+1));await waitFor(()=>expect(screen.getByLabelText(label).tagName).toBe('BUTTON'))}
 await edit('البصمة الصباحية IFASO','08:05',1)
 expect(screen.getByLabelText('البصمة الصباحية IFASO').closest('tr').children[3].textContent).toContain('50,000')
 expect(screen.getByLabelText('البصمة الصباحية EMMANUEL').textContent).toBe('08:28');expect(screen.getByLabelText('آخر بصمة EMMANUEL').textContent).toBe('08:28')
 await edit('آخر بصمة EMMANUEL','18:30',2)
 await edit('البصمة الصباحية EMMANUEL','08:05',3)
 await edit('وقت إضافي الأحد EMMANUEL','4h00',4)
 const cells=screen.getByLabelText('البصمة الصباحية EMMANUEL').closest('tr').children
 expect(cells[3].textContent).toContain('50,000');expect(cells[5].textContent).toContain('4h00');expect(cells[6].textContent).toBe('—');expect(cells[7].textContent).toContain('50,000')
 expect(state.sundayEvidenceEditSources.map(s=>JSON.stringify(s.evidence))).toEqual(raw)
 expect(api.saveEvidence.mock.calls[3][2].minutes).toBe(240)
})
it('screen and print use approved Sunday clocks while raw punch fields remain intact',async()=>{
 const data=fixture();Object.assign(data.sunday_evidence[1],{admin_evidence_override:true,display_check_in:'08:00:00',display_check_out:'18:30:00',first_punch:'08:05:04',last_punch:'19:01:16'})
 api.load.mockResolvedValue(data);const view=mount('ar');await screen.findByText('Valid two')
 const cells=view.container.querySelector('[data-worker=two]').children
 expect(cells[1].textContent).toBe('08:00');expect(cells[2].textContent).toBe('18:30')
 expect(data.sunday_evidence[1].last_punch).toBe('19:01:16')
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 fireEvent.click(screen.getByRole('button',{name:'طباعة تقرير الأحد'}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 expect(doc.querySelector('[data-worker=two]').children[2].textContent).toBe('18:30')
})
it('links the selected Sunday to dedicated review without inline approval controls',async()=>{
 api.load.mockResolvedValue({workers:[],sunday_evidence:[]})
 mount('ar');await screen.findByText('لا يوجد حضور يوم أحد مطابق')
 expect(screen.getByRole('link',{name:'إضافي الأحد'}).getAttribute('href')).toBe('/payroll/sunday-overtime?date='+date)
 expect(screen.queryByRole('button',{name:'موافقة على المختارين'})).toBeNull()
})
it.skipIf(!process.env.SUNDAY_OT_TIME_AUDIT)('real pending Juresse and Khonde durations appear in their own cells on screen and print',async()=>{
 const data=JSON.parse(readFileSync(process.env.SUNDAY_OT_TIME_AUDIT,'utf8'));api.load.mockResolvedValue(data)
 window.history.replaceState({},'','/payroll/sunday?date=2026-11-22');localStorage.setItem('workers_app_language','ar')
 const view=render(<LanguageProvider><SundayPayroll/></LanguageProvider>);await screen.findAllByText('juresse')
 for(const [code,time] of [['71','5h01'],['300','7h57']]){
  const worker=data.workers.find(w=>w.employee_code===code),cells=view.container.querySelector(`[data-worker="${worker.id}"]`).children
  expect(cells).toHaveLength(8);expect(cells[5].querySelector('bdi').textContent).toBe(time)
  expect(cells[6].textContent).toBe('—')
 }
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup);fireEvent.click(screen.getByRole('button',{name:'طباعة تقرير الأحد'}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 for(const [code,time] of [['71','5h01'],['300','7h57']]){const id=data.workers.find(w=>w.employee_code===code).id;expect(doc.querySelector(`[data-worker="${id}"]`).children[5].querySelector('bdi').textContent).toBe(time)}
})
it('renders monthly fixed Sunday pay, separate transport and x4 approved OT in screen and print',async()=>{
 const data=fixture(),worker=data.workers[1];worker.payment_type='monthly';Object.assign(worker.payroll_compensation_terms[0],{payment_type:'monthly',monthly_salary:0,overtime_rate_per_hour:2500})
 data.sunday_evidence[1].sunday_settings={pay_model:'sunday_specific',sunday_fixed_pay:20000,sunday_transport:3000,overtime_multiplier:4}
 data.biometricOvertimeReviews=[{worker,attendance:{worker_id:'two',attendance_date:date},work_date:date,sunday_evidence:true,evidence:{last_at:'2026-08-23T15:00:00Z'},hourly_rate:10000,currency:'CDF',raw_minutes:120,source_fingerprint:'f',review:{decision:'approved',minutes:120,source_fingerprint:'f'}}]
 api.load.mockResolvedValue(data);const view=mount('ar');await screen.findAllByText('Valid two')
 const cells=view.container.querySelector('[data-worker=two]').querySelectorAll('td')
 expect(cells[3].textContent).toContain('20,000');expect(cells[4].textContent).toContain('3,000');expect(cells[6].textContent).toContain('20,000');expect(cells[7].textContent).toContain('43,000')
 expect(view.container.querySelector('[data-worker=two]').textContent).not.toContain('إعداد الأجر مطلوب')
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup);fireEvent.click(screen.getByRole('button',{name:'طباعة تقرير الأحد'}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html');expect(doc.querySelector('[data-worker=two]').textContent).toContain('43,000')
})
it('monthly settings expose fixed Sunday pay, Sunday transport and OT multiplier without a salary-derived base',async()=>{
 const data=fixture();data.workers[1].payment_type='monthly';data.workers[1].payroll_compensation_terms[0].payment_type='monthly'
 api.load.mockResolvedValue(data);api.settings.mockResolvedValue({enabled:true,checkin_cutoff:'08:20',shift_end:'14:00',checkout_threshold:'13:30',pay_multiplier:2,overtime_start:'14:00',overtime_requires_approval:true,version:0,sunday_fixed_pay:null,sunday_transport:0,overtime_multiplier:1})
 api.saveSettings.mockResolvedValue({version:1})
 const view=mount('ar');await screen.findByText('Valid two');fireEvent.click(within(view.container.querySelector('[data-worker=two]').children[0]).getByRole('button'))
 const dialog=await screen.findByRole('dialog');await within(dialog).findByLabelText('قبض يوم الأحد')
 expect(within(dialog).getByText('إعداد قبض الأحد مطلوب')).not.toBeNull()
 fireEvent.change(within(dialog).getByLabelText('قبض يوم الأحد'),{target:{value:'20000'}})
 fireEvent.change(within(dialog).getByLabelText('بدل نقل الأحد'),{target:{value:'3000'}})
 fireEvent.change(within(dialog).getByLabelText('معامل إضافي الأحد'),{target:{value:'4'}})
 fireEvent.click(within(dialog).getByRole('button',{name:'حفظ إعدادات الأحد'}))
 await screen.findByText('Valid two');expect(api.saveSettings).toHaveBeenCalledWith('two',expect.objectContaining({sunday_fixed_pay:'20000',sunday_transport:'3000',overtime_multiplier:'4',pay_multiplier:1}),0)
})
it('worker name opens recurring Sunday settings, saves through canonical API and keeps custom indicator across Sundays',async()=>{
 let custom=false
 api.load.mockImplementation(async day=>{const data=fixture();data.date=day;data.workers[1].sunday_settings_custom=custom;return data})
 const defaults={enabled:true,checkin_cutoff:'08:20:00',shift_end:'14:00:00',checkout_threshold:'13:30:00',pay_multiplier:2,overtime_start:'14:00:00',overtime_requires_approval:true,version:0}
 let stored=defaults
 api.settings.mockImplementation(async()=>stored);api.saveSettings.mockImplementation(async(_id,values)=>{custom=true;stored={...values,version:1};return stored})
 const view=mount('ar');await screen.findByText('Valid two')
 fireEvent.click(within(view.container.querySelector('[data-worker=two]').children[0]).getByRole('button'))
 const modal=await screen.findByRole('dialog',{name:'إعدادات الأحد — Valid two'})
 await within(modal).findByRole('button',{name:'حفظ إعدادات الأحد'})
 expect(within(modal).queryByLabelText('قبض يوم الأحد')).toBeNull()
 expect(within(modal).getByText(/أجر اليوم × 2/)).not.toBeNull()
 fireEvent.change(within(modal).getByLabelText('آخر وقت دخول مقبول'),{target:{value:'08:45'}})
 fireEvent.change(within(modal).getByLabelText('معامل إضافي الأحد'),{target:{value:'2.5'}})
 fireEvent.click(within(modal).getByRole('button',{name:'حفظ إعدادات الأحد'}))
 await screen.findByText('إعدادات خاصة')
 expect(api.saveSettings).toHaveBeenCalledWith('two',expect.objectContaining({checkin_cutoff:'08:45',pay_multiplier:2,overtime_multiplier:'2.5',overtime_requires_approval:true}),0)
 fireEvent.change(view.container.querySelector('input[type=date]'),{target:{value:'2026-08-16'}})
 await screen.findByText('إعدادات خاصة');expect(api.load).toHaveBeenLastCalledWith('2026-08-16')
 fireEvent.click(within(view.container.querySelector('[data-worker=two]').children[0]).getByRole('button'))
 const reopened=await screen.findByRole('dialog',{name:'إعدادات الأحد — Valid two'})
 const cutoff=await within(reopened).findByLabelText('آخر وقت دخول مقبول')
 expect(cutoff.value).toBe('08:45');expect(within(reopened).getByLabelText('معامل إضافي الأحد').value).toBe('2.5');expect(api.settings).toHaveBeenCalledTimes(2)
})
it('screen and print align eight Sunday columns and total rows without colspan or nested labels',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount('ar');await screen.findByText('Valid two')
 const expected=['العامل','البصمة الصباحية','آخر بصمة','قبض الأحد','نقل الأحد','وقت إضافي الأحد','مبلغ إضافي الأحد','الصافي']
 expect([...view.container.querySelector('.sunday-team thead').querySelectorAll('th')].map(n=>n.textContent)).toEqual(expected)
 expect(view.container.querySelector('.sunday-grand thead').querySelectorAll('th')).toHaveLength(8)
 for(const total of view.container.querySelectorAll('.sunday-team tfoot tr,.sunday-grand tbody tr')){
  expect(total.children).toHaveLength(8);expect(total.querySelector('[colspan]')).toBeNull()
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
 expect(doc.querySelector('.sunday-grand thead').querySelectorAll('th')).toHaveLength(8)
 expect(doc.querySelector('.sunday-team tfoot tr').querySelectorAll('td')).toHaveLength(7)
 for(const total of doc.querySelectorAll('.sunday-team tfoot tr,.sunday-grand tbody tr')){
  expect(total.children).toHaveLength(8);expect(total.querySelector('[colspan]')).toBeNull();expect(total.querySelector('small')).toBeNull()
  expect(total.children[1].textContent).toBe('—');expect(total.children[2].textContent).toBe('—')
 }
 const grand=doc.querySelector('.sunday-grand tbody tr').children
 expect(grand[3].textContent).toContain('40,000');expect(grand[4].textContent).toContain('0.00');expect(grand[7].textContent).toContain('40,000')
})
it.skipIf(!process.env.SUNDAY_REPORT_AUDIT)('real November 22 NIOKA keeps the actual morning/final punches and Sunday 50000 net in eight cells',async()=>{
 const data=JSON.parse(readFileSync(process.env.SUNDAY_REPORT_AUDIT,'utf8'));api.load.mockResolvedValue(data)
 window.history.replaceState({},'','/payroll/sunday?date=2026-11-22');localStorage.setItem('workers_app_language','ar')
 const view=render(<LanguageProvider><SundayPayroll/></LanguageProvider>);await screen.findByText('NIOKA')
 const cells=view.container.querySelector('[data-worker="0a8a264f-59cc-48cd-9864-676227d483d6"]').querySelectorAll('td')
 expect(cells).toHaveLength(8);expect(cells[1].textContent).toBe('08:04');expect(cells[2].textContent).toBe('13:50');expect(cells[3].textContent).toContain('50,000');expect(cells[6].textContent).toBe('—');expect(cells[7].textContent).toContain('50,000')
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
 expect(cells).toHaveLength(8)
 expect(cells[5].querySelector('bdi').textContent).toBe('1h00')
 expect(cells[6].textContent).toBe(decision==='approved'?'CDF 3,000.00':'—')
 expect(cells[7].textContent).toContain(decision==='approved'?'43,000':'40,000')
 expect(screen.queryByRole('button',{name:'اعتماد عمل الأحد'})).toBeNull()
})
it('shows Sunday base, canonical payable manual OT, net and status in separate screen and print columns',async()=>{
 const data=fixture();data.workers[1].payroll_compensation_terms[0].overtime_rate_per_hour=3000
 data.attendance.push({worker_id:'two',attendance_date:date,status:'present',manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:120})
 api.load.mockResolvedValue(data);const view=mount();await screen.findByText('Valid two')
 const cells=view.container.querySelector('[data-worker=two]').querySelectorAll('td')
 expect(cells).toHaveLength(8);expect(cells[3].textContent).toContain('40,000');expect(cells[6].textContent).toContain('6,000');expect(cells[7].textContent).toContain('46,000')
 const popup={document:{write:vi.fn(),close:vi.fn()},print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 fireEvent.click(screen.getByRole('button',{name:'Print Sunday report'}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 expect(doc.querySelector('[data-worker=two]').querySelectorAll('td')).toHaveLength(8);expect(doc.querySelector('[data-worker=two]').textContent).toContain('46,000')
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
it('groups attendees into eight-column Sunday-only team tables, keeps incomplete punches unpaid, and hides absent/empty teams',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount('ar');await screen.findByText('One punch')
 const groups=view.container.querySelectorAll('.sunday-team');expect(groups).toHaveLength(2);expect(screen.queryByText('Absent worker')).toBeNull();expect(screen.queryByText('Team Empty')).toBeNull()
 for(const group of groups){expect(group.querySelectorAll('thead th')).toHaveLength(8);expect(group.querySelector('tfoot')).not.toBeNull()}
 const one=view.container.querySelector('[data-worker=one]');expect(one.textContent).toContain('07:05');expect(one.textContent).toContain('غير مكتمل');expect(one.querySelectorAll('td')[2].textContent).toBe('—');expect(one.querySelectorAll('td')[7].textContent).toContain('0.00');expect(within(one).queryByRole('button',{name:'اعتماد عمل الأحد'})).toBeNull()
 const two=view.container.querySelector('[data-worker=two]');expect(two.textContent).toContain('14:03');expect(two.querySelectorAll('td')[7].textContent).toContain('40,000')
 const morning=view.container.querySelector('[data-worker=morning]');expect(morning.textContent).toContain('غير مكتمل');expect(morning.querySelectorAll('td')[7].textContent).toContain('0.00')
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
 expect(doc.querySelectorAll('.sunday-team')).toHaveLength(1);expect(doc.querySelector('.sunday-team thead').querySelectorAll('th')).toHaveLength(8);expect(doc.querySelector('.sunday-team tfoot')).not.toBeNull();expect(doc.querySelector('.sunday-grand')).not.toBeNull();expect(doc.body.textContent).not.toContain('One punch');expect(doc.body.textContent).toContain('40,000');expect(doc.querySelector('button')).toBeNull();expect(html).toContain('A4 landscape');expect(doc.documentElement.dir).toBe(language==='ar'?'rtl':'ltr')
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'no match'}});expect(view.container.querySelectorAll('.sunday-team')).toHaveLength(0)
})
it('rejects a non-Sunday without requesting/replacing the selected date',async()=>{
 api.load.mockResolvedValue(fixture());const view=mount();await screen.findByText('One punch');const input=view.container.querySelector('input[type=date]');fireEvent.change(input,{target:{value:'2026-08-24'}});expect(input.value).toBe(date);expect(api.load).toHaveBeenCalledTimes(1)
})
