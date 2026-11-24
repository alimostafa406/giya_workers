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
 render(<SundayOvertimeReview/>);await screen.findByText('لا يوجد إضافي أحد مؤهل')
 const input=screen.getByLabelText('تاريخ الأحد');expect(input.value).toBe('2026-11-22')
 expect(api.load).toHaveBeenCalledWith('2026-11-22')
 expect(screen.getByRole('link',{name:'تقرير أجور الأحد'}).getAttribute('href')).toBe('/payroll/sunday?date=2026-11-22')
 fireEvent.change(input,{target:{value:'2026-11-23'}})
 expect(screen.getByRole('alert')).not.toBeNull();expect(api.load).toHaveBeenCalledTimes(1)
 fireEvent.change(input,{target:{value:'2026-11-15'}})
 await waitFor(()=>expect(api.load).toHaveBeenCalledWith('2026-11-15'))
})
