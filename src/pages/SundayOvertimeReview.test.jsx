// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import SundayOvertimeReview from './SundayOvertimeReview'
globalThis.React=React
const api=vi.hoisted(()=>({load:vi.fn().mockResolvedValue([])}))
vi.mock('../api/biometricOvertimeReviewApi',()=>({getBiometricOvertimeReviews:api.load,decideBiometricOvertime:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('preserves report Sunday and refuses weekday selection without loading it',async()=>{
 window.history.replaceState(null,'','/payroll/sunday-overtime?date=2026-11-22')
 render(<SundayOvertimeReview/>);await screen.findByText('لا يوجد إضافي أحد مطابق للفلاتر الحالية')
 const input=screen.getByLabelText('تاريخ الأحد');expect(input.value).toBe('2026-11-22')
 expect(api.load).toHaveBeenCalledWith('2026-11-22')
 expect(screen.getByRole('link',{name:'تقرير أجور الأحد'}).getAttribute('href')).toBe('/payroll/sunday?date=2026-11-22')
 fireEvent.change(input,{target:{value:'2026-11-23'}})
 expect(screen.getByRole('alert')).not.toBeNull();expect(api.load).toHaveBeenCalledTimes(1)
 fireEvent.change(input,{target:{value:'2026-11-15'}})
 await waitFor(()=>expect(api.load).toHaveBeenCalledWith('2026-11-15'))
})
it('filters teams locally while retaining status options and consistent compact toolbar',async()=>{
 const date='2026-11-22'
 const source=(id,team,name,decision)=>({sunday_evidence:true,work_date:date,worker:{id,full_name:name,team_id:team,team_name:team,employee_code:id},attendance:{attendance_date:date},evidence:{},raw_minutes:60,hourly_rate:3500,currency:'CDF',source_fingerprint:id,review:decision?{decision,minutes:60,source_fingerprint:id}:null})
 api.load.mockResolvedValue([source('1','Peinture Raghibe','Painter'),source('2','Chauffeur','Driver'),source('3','Chauffeur','Approved','approved')])
 window.history.replaceState(null,'','/payroll/sunday-overtime?date='+date)
 const view=render(<SundayOvertimeReview/>);await screen.findByText('Painter')
 const team=screen.getByLabelText('الفريق'),status=screen.getByLabelText('الحالة')
 expect(team.value).toBe('');expect(screen.getByRole('option',{name:'كل الفرق'})).not.toBeNull()
 expect(view.container.querySelectorAll('[data-sunday-ot-team]')).toHaveLength(2)
 fireEvent.change(team,{target:{value:'Peinture Raghibe'}})
 expect(screen.getByText('Painter')).not.toBeNull();expect(screen.queryByText('Driver')).toBeNull()
 expect(view.container.querySelectorAll('[data-sunday-ot-team]')).toHaveLength(1)
 fireEvent.change(status,{target:{value:'approved'}})
 expect(screen.getByText('لا يوجد إضافي أحد مطابق للفلاتر الحالية')).not.toBeNull()
 fireEvent.change(team,{target:{value:''}})
 expect(screen.getByText('Approved')).not.toBeNull();expect(screen.queryByText('Painter')).toBeNull()
 expect(api.load).toHaveBeenCalledTimes(1)
 expect(view.container.querySelector('.sunday-ot-filters').contains(screen.getByLabelText('تاريخ الأحد'))).toBe(true)
 expect(view.container.querySelector('.sunday-ot-filters').contains(team)).toBe(true)
})
