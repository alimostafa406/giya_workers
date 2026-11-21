// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render} from '@testing-library/react'
import {LanguageProvider} from '../../i18n/LanguageContext'
import WeeklyPayrollSheet from './WeeklyPayrollSheet'
import {weeklyDates} from '../../utils/payrollCalculations'
import {calculateWeeklyPayoutLine} from '../../utils/weeklyPayoutLines'
globalThis.React=React
afterEach(()=>{cleanup();localStorage.clear()})
it('renders full-day money, hourly duration, hourly money and net in separate screen/print table columns',()=>{
 localStorage.setItem('workers_app_language','ar')
 const worker={id:'w',full_name:'Exception worker',employee_code:'1',team_id:'t',team_name:'Team',is_active:true,payment_type:'weekly',staff_classification:'normal',payroll_compensation:{daily_rate:20000,daily_transport_allowance:0,overtime_rate_per_hour:3000,currency_code:'CDF'}}
 const exception={id:'manual',version:1,date:'2026-11-20',extra_days:1,minutes:120,daily_wage:20000,hourly_rate:3000,full_day_amount:20000,hourly_amount:6000,currency:'CDF'}
 const data={rules:{},attendance:[],extraDayReviews:[{worker_id:'w',work_date:exception.date,status:'approved',manual_exception:exception,source:{qualified:true,fingerprint:'fp'},review:{source_fingerprint:'fp'},payroll_source:{date:exception.date,extra_days:1,amount:20000,currency:'CDF'}}]}
 const line=calculateWeeklyPayoutLine(data,'2026-11-16',worker)
 const view=render(<LanguageProvider><WeeklyPayrollSheet lines={[line]} dates={weeklyDates('2026-11-16')} onEdit={vi.fn()}/></LanguageProvider>)
 const cells=view.container.querySelector('tbody tr').querySelectorAll('td')
 expect(cells[8].textContent).toContain('2h00');expect(cells[9].textContent).toContain('6,000');expect(cells[10].textContent).toContain('1 يوم');expect(cells[10].textContent).toContain('20,000');expect(cells[12].textContent).toContain('26,000')
 expect(view.container.querySelector('tfoot').textContent).toContain('26,000')
})
