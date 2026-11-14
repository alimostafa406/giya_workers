// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import ExtraDayOvertime from './ExtraDayOvertime'
globalThis.React=React
const m=vi.hoisted(()=>({rules:vi.fn(),reviews:vi.fn(),save:vi.fn(),decide:vi.fn()}))
vi.mock('../api/extraDayOvertimeApi',()=>({getExtraDayRules:m.rules,getExtraDayReviews:m.reviews,getExtraDayTeams:async()=>[{id:'team',name:'Any Team'}],saveExtraDayRule:m.save,decideExtraDays:m.decide}))
vi.mock('../api/workersApi',()=>({getWorkersRequest:async()=>({data:[{id:'w',full_name:'Worker',employee_code:'1',team_id:'team',team_name:'Any Team'}]})}))
vi.mock('../utils/attendanceOperationalGate',()=>({kinshasaClock:()=>({date:'2026-11-14'})}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('generic settings save actual selected team/worker, dates and configurable cross-midnight window',async()=>{
 m.rules.mockResolvedValue([]);m.save.mockResolvedValue({});render(<ExtraDayOvertime settings />)
 await screen.findByText('Any Team')
 for(const[label,value]of [['اسم القاعدة','Any project'],['من تاريخ','2026-11-14'],['إلى تاريخ','2026-11-20'],['بداية نافذة الأدلة','18:10'],['نهاية نافذة الأدلة','03:30'],['الحد الأدنى للمدة بالدقائق','240']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 fireEvent.click(screen.getByRole('checkbox',{name:'Any Team'}));fireEvent.click(screen.getByRole('checkbox',{name:'Worker #1'}))
 fireEvent.click(screen.getByRole('button',{name:'حفظ القاعدة'}))
 await waitFor(()=>expect(m.save).toHaveBeenCalledWith(expect.objectContaining({name:'Any project',team_ids:['team'],worker_ids:['w'],start_time:'18:10',window_end:'03:30',minimum_minutes:'240'}),null,0))
})
it.each(['approved','rejected'])('visible bulk %s sends only selected review records and keeps locks',async decision=>{
 m.rules.mockResolvedValue([{id:'r',name:'Generic rule'}]);m.decide.mockResolvedValue([])
 const rows=['A','B'].map(worker_id=>({rule_id:'r',worker_id,work_date:'2026-11-14',status:'pending',locked:false,review:{version:0,rule_snapshot:{name:'Generic rule'}},source:{worker:{full_name:worker_id,employee_code:worker_id,team_name:'Team'},attendance:{status:'present'},events:[],qualified:true,daily_wage:20000,currency:'CDF',duration_minutes:300}}))
 m.reviews.mockResolvedValue(rows);render(<ExtraDayOvertime />);await screen.findByLabelText('اختيار A')
 fireEvent.click(screen.getByRole('button',{name:'اختيار الكل الظاهر'}));fireEvent.click(screen.getByRole('button',{name:decision==='approved'?'موافقة على المختارين':'رفض المختارين'}))
 await waitFor(()=>expect(m.decide).toHaveBeenCalledWith(rows,decision))
})
