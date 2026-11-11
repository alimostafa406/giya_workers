// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import BiometricLatenessReview from './BiometricLatenessReview'
globalThis.React=React
const mock=vi.hoisted(()=>({load:vi.fn(),decide:vi.fn(),batch:vi.fn()}))
vi.mock('../api/biometricLatenessApi',()=>({getBiometricLatenessReviews:mock.load,decideBiometricLateness:mock.decide,saveBiometricLatenessBatch:mock.batch}))
vi.mock('../utils/attendanceOperationalGate',()=>({kinshasaClock:()=>({date:'2026-11-11'})}))
const row=(id,team='Team')=>({worker:{id,full_name:id,employee_code:id,team_id:team,team_name:team},attendance:{id,attendance_date:'2026-11-11',check_in:'08:35:19'},evidence:{raw_minutes:35,source_fingerprint:'raw'},calculation:{daily_wage:10000,scheduled_paid_minutes:540,fingerprint:'cost'},review:null,locked:false})
const saved=(id,decision,amount,version=1)=>({worker_id:id,decision,approved_minutes:35,raw_minutes:35,source_fingerprint:'raw',calculation_snapshot:{mode:'automatic_daily_wage_v1',fingerprint:'cost'},automatic_deduction:648.15,adjusted_deduction:amount,deduction_amount:decision==='approved'?(amount??648.15):0,version,adjustment_source:'single'})
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('single 2000 override preserves automatic amount; clearing returns to auto and never implicitly approves',async()=>{
 mock.load.mockResolvedValue([row('One')]);mock.decide.mockImplementation(async(_date,r,decision,_minutes,_note,override)=>[saved(r.worker.id,decision,override.adjusted_deduction)])
 render(<BiometricLatenessReview />)
 await screen.findByLabelText('الخصم المعتمد One')
 expect(screen.getByLabelText('خصم التأخير المحسوب One').textContent).toContain('648.15')
 fireEvent.change(screen.getByLabelText('الخصم المعتمد One'),{target:{value:'2000'}})
 fireEvent.click(screen.getByRole('button',{name:'حفظ الخصم',exact:true}))
 await waitFor(()=>expect(mock.decide).toHaveBeenLastCalledWith('2026-11-11',expect.anything(),'pending',35,'',{adjusted_deduction:2000,adjustment_source:'single'}))
 expect(screen.getByLabelText('خصم التأخير المحسوب One').textContent).toContain('648.15')
 fireEvent.change(screen.getByLabelText('الخصم المعتمد One'),{target:{value:''}})
 fireEvent.click(screen.getByRole('button',{name:'موافقة',exact:true}))
 await waitFor(()=>expect(mock.decide).toHaveBeenLastCalledWith('2026-11-11',expect.anything(),'approved',35,'',{adjusted_deduction:null,adjustment_source:'single'}))
})
it('select all visible and bulk 2000 saves five pending overrides, not the hidden sixth worker',async()=>{
 const rows=[...Array.from({length:5},(_,i)=>row(`Worker${i}`)),row('Hidden','Other')],before=JSON.stringify(rows)
 mock.load.mockResolvedValue(rows);mock.batch.mockImplementation(async(_date,entries)=>entries.map(e=>({...saved(e.worker_id,'pending',e.adjusted_deduction),adjustment_source:'bulk'})))
 render(<BiometricLatenessReview />);await screen.findByLabelText('الخصم المعتمد Hidden')
 fireEvent.change(screen.getByLabelText('الفريق'),{target:{value:'Team'}})
 fireEvent.click(screen.getByRole('button',{name:'اختيار الكل الظاهر'}))
 expect(screen.getAllByRole('checkbox').filter(c=>c.checked)).toHaveLength(5)
 fireEvent.change(screen.getByLabelText('الخصم المشترك CDF'),{target:{value:'2000'}})
 fireEvent.click(screen.getByRole('button',{name:'تطبيق الخصم على المختارين'}))
 await waitFor(()=>expect(mock.batch).toHaveBeenCalled())
 const entries=mock.batch.mock.calls[0][1]
 expect(entries).toHaveLength(5)
 entries.forEach(e=>expect(e).toMatchObject({adjusted_deduction:2000,decision:'pending',adjustment_source:'bulk'}))
 await waitFor(()=>expect(screen.getByLabelText('الخصم المعتمد Worker4').value).toBe('2000'))
 expect(mock.decide).not.toHaveBeenCalled()
 expect(screen.getByLabelText('خصم التأخير المحسوب Worker4').textContent).toContain('648.15')
 expect(JSON.stringify(rows)).toBe(before)
})
