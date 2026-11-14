// @vitest-environment jsdom
import React from 'react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import ExtraDayOvertime from './ExtraDayOvertime'
globalThis.React=React
const m=vi.hoisted(()=>({reviews:vi.fn(),decide:vi.fn()}))
vi.mock('../api/extraDayOvertimeApi',()=>({getDailyExtraDayReviews:m.reviews,getExtraDayTeams:async()=>[{id:'painting',name:'Peinture Raghibe'},{id:'other',name:'Any Other Team'}],decideExtraDays:m.decide}))
vi.mock('../utils/attendanceOperationalGate',()=>({kinshasaClock:()=>({date:'2026-11-14'})}))
const row=name=>({rule_id:'internal',worker_id:name,work_date:'2026-11-13',status:'pending',locked:false,review:{version:0},source:{fingerprint:'real',worker:{full_name:name,employee_code:name,team_name:'Peinture Raghibe'},attendance:{status:'present'},events:[{id:'event',employee_no:'025',device:'office-main',timestamp:'2026-11-13T18:00:00Z'}],qualified:true,daily_wage:20000,currency:'CDF',duration_minutes:300}})
beforeEach(()=>{m.reviews.mockResolvedValue([row('A'),row('B')]);m.decide.mockResolvedValue([])})
afterEach(()=>{cleanup();vi.clearAllMocks()})
async function chooseTeam(team='painting'){
 await screen.findByRole('option',{name:'Peinture Raghibe'})
 fireEvent.change(screen.getByLabelText('التاريخ'),{target:{value:'2026-11-13'}})
 fireEvent.change(screen.getByLabelText('الفريق'),{target:{value:team}})
 await screen.findByLabelText('اختيار A')
}
it('date/team loads evidence without rule creation, also supports arbitrary teams',async()=>{
 render(<ExtraDayOvertime />)
 expect(m.reviews).not.toHaveBeenCalled()
 expect(screen.queryByText('اسم القاعدة')).toBeNull();expect(screen.queryByText('حفظ القاعدة')).toBeNull()
 await chooseTeam()
 expect(m.reviews).toHaveBeenLastCalledWith('2026-11-13','painting')
 fireEvent.change(screen.getByLabelText('الفريق'),{target:{value:'other'}})
 await waitFor(()=>expect(m.reviews).toHaveBeenLastCalledWith('2026-11-13','other'))
})
it.each(['approved','rejected'])('bulk %s sends selected workers only, selection itself never pays',async decision=>{
 render(<ExtraDayOvertime />);await chooseTeam()
 fireEvent.click(screen.getByLabelText('اختيار A'))
 expect(m.decide).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:decision==='approved'?'موافقة على المختارين':'رفض المختارين'}))
 await waitFor(()=>expect(m.decide).toHaveBeenCalledWith([row('A')],decision))
 expect(screen.getAllByText(/20,000/)).toHaveLength(4)
})
it('select all visible excludes locked workers and reload displays persisted decision',async()=>{
 m.reviews.mockResolvedValueOnce([row('A'),{...row('B'),locked:true}]).mockResolvedValue([{...row('A'),status:'approved'},{...row('B'),locked:true}])
 render(<ExtraDayOvertime />);await chooseTeam()
 fireEvent.click(screen.getByRole('button',{name:'اختيار الكل الظاهر'}))
 expect(screen.getByLabelText('اختيار A').checked).toBe(true)
 expect(screen.getByLabelText('اختيار B').checked).toBe(false)
 fireEvent.click(screen.getByRole('button',{name:'موافقة على المختارين'}))
 await screen.findByText('موافق عليه')
 expect(m.decide).toHaveBeenCalledWith([row('A')],'approved')
})
it('ignores stale asynchronous responses when date/team changes',async()=>{
 let resolveOld
 m.reviews.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve})).mockResolvedValue([row('New')])
 render(<ExtraDayOvertime />)
 await screen.findByRole('option',{name:'Peinture Raghibe'})
 fireEvent.change(screen.getByLabelText('الفريق'),{target:{value:'painting'}})
 fireEvent.change(screen.getByLabelText('الفريق'),{target:{value:'other'}})
 await screen.findByLabelText('اختيار New')
 resolveOld([row('Old')])
 await waitFor(()=>expect(screen.queryByLabelText('اختيار Old')).toBeNull())
})
