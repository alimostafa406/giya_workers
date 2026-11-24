// @vitest-environment jsdom
import React from 'react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react'
import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom'
import Layout from '../Layout/Layout'
const mock=vi.hoisted(()=>({admin:{full_name:'Admin',is_active:true},change:vi.fn(),logout:vi.fn()}))
vi.mock('../../store/authStore',()=>({useAuthStore:selector=>selector({admin:mock.admin,user:{email:'admin@example.test'},logout:mock.logout})}))
vi.mock('../../i18n/LanguageContext',()=>({useTranslation:()=>({language:'ar',direction:'rtl',setLanguage:vi.fn(),t:key=>key==='common.cancel'?'إغلاق':key})}))
vi.mock('../../api/adminPasswordApi',async original=>({...await original(),changeAdminPassword:mock.change}))
globalThis.React=React
beforeEach(()=>{mock.admin={full_name:'Admin',is_active:true};mock.change.mockReset();mock.change.mockResolvedValue(undefined);mock.logout.mockClear()})
afterEach(cleanup)
function Home(){return <><p>لوحة الإدارة</p><output data-testid="path">{useLocation().pathname}</output></>}
function mount(){return render(<MemoryRouter initialEntries={['/']}><Routes><Route element={<Layout/>}><Route path="/" element={<Home/>}/></Route></Routes></MemoryRouter>)}
it('dashboard header visibly opens the real password form without navigating to a hidden route',async()=>{
 const view=mount();expect(screen.getByText('لوحة الإدارة')).not.toBeNull()
 const entry=within(view.container.querySelector('header')).getByRole('button',{name:'تغيير كلمة المرور'})
 expect(entry.className).not.toContain('hidden');fireEvent.click(entry)
 const dialog=screen.getByRole('dialog',{name:'تغيير كلمة المرور'}),form=within(dialog)
 expect(screen.getByTestId('path').textContent).toBe('/')
 fireEvent.change(form.getByLabelText('كلمة المرور الحالية'),{target:{value:'test-current-password'}})
 fireEvent.change(form.getByLabelText('كلمة المرور الجديدة'),{target:{value:'test-new-password-long'}})
 fireEvent.change(form.getByLabelText('تأكيد كلمة المرور الجديدة'),{target:{value:'different-password'}})
 fireEvent.click(form.getByRole('button',{name:'تغيير كلمة المرور'}));expect(form.getByRole('alert').textContent).toContain('غير متطابقين');expect(mock.change).not.toHaveBeenCalled()
 fireEvent.change(form.getByLabelText('تأكيد كلمة المرور الجديدة'),{target:{value:'test-new-password-long'}})
 fireEvent.click(form.getByRole('button',{name:'تغيير كلمة المرور'}))
 await waitFor(()=>expect(form.getByRole('status').textContent).toContain('بنجاح'))
 expect(mock.change).toHaveBeenCalledWith('test-current-password','test-new-password-long','test-new-password-long')
 expect(form.getByLabelText('كلمة المرور الجديدة').value).toBe('')
 fireEvent.click(form.getByRole('button',{name:'إغلاق'}));expect(screen.queryByRole('dialog')).toBeNull()
 expect(screen.getByTestId('path').textContent).toBe('/')
})
it('does not expose the entry to non-admin/inactive users',()=>{
 mock.admin=null;mount();expect(screen.queryByRole('button',{name:'تغيير كلمة المرور'})).toBeNull()
})
it('cannot close the form or sign out while its password request is running',async()=>{
 let complete;mock.change.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
 const view=mount();fireEvent.click(within(view.container.querySelector('header')).getByRole('button',{name:'تغيير كلمة المرور'}))
 const dialog=screen.getByRole('dialog'),form=within(dialog)
 for(const label of ['كلمة المرور الحالية','كلمة المرور الجديدة','تأكيد كلمة المرور الجديدة'])fireEvent.change(form.getByLabelText(label),{target:{value:label==='كلمة المرور الحالية'?'test-current-password':'test-new-password-long'}})
 fireEvent.click(form.getByRole('button',{name:'تغيير كلمة المرور'}));fireEvent.click(form.getByRole('button',{name:'إغلاق'}))
 expect(screen.getByRole('dialog')).not.toBeNull();expect(screen.getByRole('button',{name:/common.logout/}).disabled).toBe(true)
 complete();await form.findByRole('status');expect(mock.logout).not.toHaveBeenCalled()
})
