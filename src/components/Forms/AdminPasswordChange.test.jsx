// @vitest-environment jsdom
import React from 'react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
const mock=vi.hoisted(()=>({admin:{is_active:true},change:vi.fn()}))
vi.mock('../../store/authStore',()=>({useAuthStore:selector=>selector({admin:mock.admin})}))
vi.mock('../../i18n/LanguageContext',()=>({useTranslation:()=>({language:'ar'})}))
vi.mock('../../api/adminPasswordApi',async importOriginal=>({...await importOriginal(),changeAdminPassword:mock.change}))
import AdminPasswordChange from './AdminPasswordChange'
globalThis.React=React
beforeEach(()=>{mock.admin={is_active:true};mock.change.mockReset();mock.change.mockResolvedValue(undefined)})
afterEach(cleanup)
const fill=(confirmation='test-new-password-long')=>{
 fireEvent.change(screen.getByLabelText('كلمة المرور الحالية'),{target:{value:'test-current-password'}})
 fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'),{target:{value:'test-new-password-long'}})
 fireEvent.change(screen.getByLabelText('تأكيد كلمة المرور الجديدة'),{target:{value:confirmation}})
}
it('uses masked password fields and validates confirmation without submitting',()=>{
 render(<AdminPasswordChange/>);fill('mismatched-password')
 fireEvent.click(screen.getByRole('button',{name:'تغيير كلمة المرور'}))
 expect(screen.getByRole('alert').textContent).toContain('غير متطابقين');expect(mock.change).not.toHaveBeenCalled()
 for(const label of ['كلمة المرور الحالية','كلمة المرور الجديدة','تأكيد كلمة المرور الجديدة'])expect(screen.getByLabelText(label).type).toBe('password')
})
it('shows success and clears all sensitive fields after the existing Auth request',async()=>{
 render(<AdminPasswordChange/>);fill();fireEvent.click(screen.getByRole('button',{name:'تغيير كلمة المرور'}))
 await screen.findByRole('status');expect(mock.change).toHaveBeenCalledOnce()
 expect(screen.getByLabelText('كلمة المرور الحالية').value).toBe('');expect(screen.getByLabelText('كلمة المرور الجديدة').value).toBe('');expect(screen.getByLabelText('تأكيد كلمة المرور الجديدة').value).toBe('')
})
it('renders useful sanitized failure and does not retain passwords',async()=>{
 mock.change.mockRejectedValue({code:'currentInvalid',message:'test-new-password-long'})
 render(<AdminPasswordChange/>);fill();fireEvent.click(screen.getByRole('button',{name:'تغيير كلمة المرور'}))
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('الحالية غير صحيحة'))
 expect(screen.getByRole('alert').textContent).not.toContain('test-new-password-long');expect(screen.getByLabelText('كلمة المرور الجديدة').value).toBe('')
})
it('is unavailable to inactive/non-admin users',()=>{
 mock.admin=null;const view=render(<AdminPasswordChange/>);expect(view.container.textContent).toBe('')
 mock.admin={is_active:false};view.rerender(<AdminPasswordChange/>);expect(view.container.textContent).toBe('')
})
it('accepts seven digits in the visible form without character-class rules',async()=>{
 render(<AdminPasswordChange/>);fill('1234567')
 const input=screen.getByLabelText('كلمة المرور الجديدة');fireEvent.change(input,{target:{value:'1234567'}})
 expect(input.minLength).toBe(7);expect(input.pattern).toBe('')
 fireEvent.click(screen.getByRole('button',{name:'تغيير كلمة المرور'}));await screen.findByRole('status')
 expect(mock.change).toHaveBeenCalledWith('test-current-password','1234567','1234567')
})
it('shows the exact Arabic minimum-length message and surfaces Supabase policy rejection without success',async()=>{
 render(<AdminPasswordChange/>);fill('123456');fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'),{target:{value:'123456'}})
 fireEvent.submit(screen.getByRole('button',{name:'تغيير كلمة المرور'}).closest('form'))
 expect(screen.getByRole('alert').textContent).toBe('يجب أن تتكون كلمة المرور من 7 أحرف على الأقل')
 expect(mock.change).not.toHaveBeenCalled()
 fill('1234567');fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'),{target:{value:'1234567'}})
 mock.change.mockRejectedValue({code:'weakPassword'})
 fireEvent.click(screen.getByRole('button',{name:'تغيير كلمة المرور'}))
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('سياسة أمان الحساب'))
 expect(screen.queryByRole('status')).toBeNull()
})
