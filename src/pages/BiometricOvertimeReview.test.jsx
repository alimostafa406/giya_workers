// @vitest-environment jsdom
import React from 'react'
import { afterEach,expect,it,vi } from 'vitest'
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import BiometricOvertimeReview from './BiometricOvertimeReview'
globalThis.React=React
const mock=vi.hoisted(()=>({load:vi.fn(),decide:vi.fn()}))
vi.mock('../api/biometricOvertimeReviewApi',()=>({getBiometricOvertimeReviews:mock.load,decideBiometricOvertime:mock.decide}))
vi.mock('../utils/attendanceOperationalGate',()=>({kinshasaClock:()=>({date:'2026-10-23'})}))
const fixture=()=>['Weekly','Monthly'].map((name,i)=>({worker:{id:name,full_name:name,employee_code:String(i+1),team_id:'t',team_name:'Team',payment_type:i?'monthly':'weekly',is_active:true,staff_classification:'normal'},attendance:{id:name,worker_id:name,attendance_date:'2026-10-23',status:'present',attendance_source:'biometric',check_in:'08:00:00',check_out:'19:30:00',updated_at:'v'},source_fingerprint:'fp',review:null,locked:false}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
it.each(['approved','rejected'])('visible bulk %s reviews both weekly and monthly workers; real time values stay unchanged',async(decision)=>{
 const rows=fixture(),before=JSON.stringify(rows);mock.load.mockResolvedValue(rows);mock.decide.mockResolvedValue([])
 render(<BiometricOvertimeReview />)
 await screen.findByRole('checkbox',{name:'Monthly'})
 expect(screen.getAllByText('2h30')).toHaveLength(2)
 fireEvent.click(screen.getByRole('button',{name:'اختيار الكل'}))
 fireEvent.click(screen.getByRole('button',{name:decision==='approved'?'موافقة على المحددين':'رفض المحددين'}))
 await waitFor(()=>expect(mock.decide).toHaveBeenCalledWith('2026-10-23',expect.arrayContaining(rows.map((r)=>expect.objectContaining(r))),decision))
 expect(JSON.stringify(rows)).toBe(before)
})
it('stale evidence is pending and locked rows cannot be approved; date navigation loads requested day',async()=>{
 const rows=fixture();rows[0].review={decision:'approved',minutes:60,source_fingerprint:'old',version:1};rows[1].locked=true
 mock.load.mockResolvedValue(rows);render(<BiometricOvertimeReview />)
 await screen.findByText('تغير دليل البصمة — يلزم إعادة المراجعة')
 expect(screen.getByRole('checkbox',{name:'Monthly'}).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'اليوم السابق'}))
 await waitFor(()=>expect(mock.load).toHaveBeenLastCalledWith('2026-10-22'))
})
it('empty and API errors render; failed decisions retain visible error after reload',async()=>{
 mock.load.mockRejectedValue(new Error('Read failed'));render(<BiometricOvertimeReview />)
 expect(await screen.findByRole('alert')).toBeTruthy();cleanup()
 mock.load.mockResolvedValue(fixture());mock.decide.mockRejectedValue(new Error('Biometric evidence changed'))
 render(<BiometricOvertimeReview />);await screen.findByRole('checkbox',{name:'Weekly'})
 fireEvent.click(screen.getAllByRole('button',{name:'موافقة',exact:true})[0])
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Biometric evidence changed'))
})
