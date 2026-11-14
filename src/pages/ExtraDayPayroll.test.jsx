// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import TeamWeeklyReport from './TeamWeeklyReport'
import {LanguageProvider} from '../i18n/LanguageContext'
import {readFileSync} from 'node:fs'
import {teamWeeklyReport} from '../utils/teamWeeklyReport'
import {formatPayrollMoney} from '../utils/payrollCurrency'
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
 expect(row.cells).toHaveLength(13);expect(row.cells[8].textContent).toBe('—')
 expect(row.cells[1].textContent).toContain('حاضر + دوبل');expect(row.cells[10].textContent).toContain('20,000')
 expect(row.cells[12].textContent).toContain(payment_type==='monthly'?'20,000':'40,000')
 fireEvent.click(screen.getByRole('button',{name:'طباعة كل الفرق',exact:true}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 expect(doc.querySelector('.team-report-team tbody tr').textContent).toBe(row.textContent)
 expect(doc.querySelector('.team-report-team thead').textContent).toContain('الإضافي الدوبل')
 expect(doc.body.textContent).not.toContain('مبلغ الأيام الإضافية')
 expect(doc.body.textContent).not.toContain('أيام إضافية')
 expect(doc.querySelector('.team-report-summary tfoot').textContent).toContain('20,000')
})
it.skipIf(!process.env.SIMPLIFIED_PAYROLL_AUDIT)('real approved week keeps hourly OT separate from two Double OT premiums, on screen and print',async()=>{
 const data=JSON.parse(readFileSync(process.env.SIMPLIFIED_PAYROLL_AUDIT,'utf8'))
 const before=JSON.stringify(data),week='2026-11-09'
 const report=teamWeeklyReport(data,week)
 const chico=report.lines.find(l=>l.worker.employee_code==='15')
 expect(chico.extraDays).toBe(2);expect(chico.extraDayAmount).toBe(29000)
 for(const line of report.lines)expect(line.finalAmount).toBe(Math.round((line.basePay+line.overtimeAmount+line.extraDayAmount+line.transportAmount-line.lateDeduction)*100)/100)
 mock.load.mockResolvedValue(data);localStorage.setItem('workers_app_language','ar');window.history.replaceState({},'',`/?date=${week}`)
 const popup={document:{write:vi.fn(),close:vi.fn(),fonts:{ready:Promise.resolve()}},focus:vi.fn(),print:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup)
 render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>);await screen.findByText(chico.worker.full_name)
 const headers=['العامل','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','أجر العمل','الإضافي','مبلغ الإضافي','الإضافي الدوبل','النقل','صافي القبض']
 for(const line of report.lines){
   const row=screen.getByText(line.worker.full_name).closest('tr')
   expect(row.cells[10].textContent).toBe(line.extraDays>0?`${line.extraDays} يوم · ${formatPayrollMoney(line.extraDayAmount,{currency:line.currency,paymentType:'weekly'})}`:'—')
   expect(row.cells).toHaveLength(13)
   expect([...row.closest('table').tHead.rows[0].cells].map(c=>c.textContent)).toEqual(headers)
   for(const[index,field]of [[7,'basePay'],[9,'overtimeAmount'],[11,'transportAmount'],[12,'finalAmount']]){
     expect(row.cells[index].textContent).toBe(formatPayrollMoney(line[field]||0,{currency:line.currency,paymentType:'weekly'}))
   }
 }
 fireEvent.click(screen.getByRole('button',{name:'طباعة كل الفرق',exact:true}))
 const doc=new DOMParser().parseFromString(popup.document.write.mock.calls[0][0],'text/html')
 expect([...doc.querySelector('.team-report-team thead tr').cells].map(c=>c.textContent)).toEqual(headers)
 for(const forbidden of ['خصم التأخير','أيام إضافية','مبلغ الأيام الإضافية','بدل النقل اليومي'])expect(doc.body.textContent).not.toContain(forbidden)
 expect(JSON.stringify(data)).toBe(before)
})
