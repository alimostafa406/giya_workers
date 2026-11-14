// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import TeamWeeklyReport from './TeamWeeklyReport'
import {LanguageProvider} from '../i18n/LanguageContext'
globalThis.React=React
const mock=vi.hoisted(()=>({load:vi.fn()}))
vi.mock('../api/payrollOperationsApi',()=>({getPayrollOperationsDataRequest:mock.load}))
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();window.history.replaceState({},'','/')})
it.each(['weekly','monthly'])('%s premium has its own columns and prints once without another attendance day',async payment_type=>{
 const date='2026-11-09',worker={id:'w',full_name:'Extra Worker',employee_code:'99',team_id:'t',team_name:'Any Team',payment_type,is_active:true,staff_classification:'normal',payroll_compensation:{daily_rate:20000,daily_transport_allowance:0,currency_code:'CDF',overtime_rate_per_hour:1000}}
 const data={workers:[worker],rules:{},holidays:[],runs:[],payrollLines:[],attendance:[{worker_id:'w',attendance_date:date,status:'present',check_in:'08:00',check_out:'23:00',manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:300}],
 extraDayReviews:[{rule_id:'r',worker_id:'w',work_date:date,status:'approved',source:{qualified:true,fingerprint:'fp'},review:{source_fingerprint:'fp'},payroll_source:{rule_id:'r',worker_id:'w',date,version:1,amount:20000,currency:'CDF',source_fingerprint:'fp',extra_days:1}}]}
 mock.load.mockResolvedValue(data);localStorage.setItem('workers_app_language','ar');window.history.replaceState({},'',`/?date=${date}`)
 const popup={document:{write:vi.fn(),close:vi.fn(),fonts:{ready:Promise.resolve()}},focus:vi.fn(),print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>);await screen.findByText('Extra Worker')
 const team=screen.getByRole('region',{name:'تقرير الفريق: Any Team'}),row=team.querySelector('tbody tr')
 expect(row.cells[8].textContent).toBe('1');expect(row.cells[10].textContent).toBe(payment_type==='monthly'?'—':'0 h')
 expect(row.cells[15].textContent).toBe('1');expect(row.cells[16].textContent).toContain('20,000')
 expect(row.cells[17].textContent).toContain(payment_type==='monthly'?'20,000':'40,000')
 fireEvent.click(screen.getByRole('button',{name:'طباعة كل الفرق',exact:true}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 expect(doc.querySelector('.team-report-team tbody tr').textContent).toBe(row.textContent)
 expect(doc.querySelector('.team-report-team thead').textContent).toContain('أيام إضافية')
 expect(doc.querySelector('.team-report-summary tfoot').textContent).toContain('20,000')
})
