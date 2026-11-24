import {beforeEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({getUser:vi.fn(),updateUser:vi.fn(),select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(),signIn:vi.fn(),signOut:vi.fn(),create:vi.fn()}))
vi.mock('../lib/supabase',()=>({supabase:{auth:{getUser:mock.getUser,updateUser:mock.updateUser},from:()=>({select:mock.select})},createPasswordVerificationClient:mock.create}))
import {changeAdminPassword,passwordValidation} from './adminPasswordApi'
// Test-only values; never production credentials.
const current='test-current-password',next='test-new-password-long'
beforeEach(()=>{
 vi.clearAllMocks();mock.getUser.mockResolvedValue({data:{user:{id:'admin-id',email:'admin@example.test'}}})
 mock.select.mockReturnValue({eq:mock.eq});mock.eq.mockReturnValue({maybeSingle:mock.maybeSingle})
 mock.maybeSingle.mockResolvedValue({data:{id:'admin-id',is_active:true}})
 mock.create.mockReturnValue({auth:{signInWithPassword:mock.signIn,signOut:mock.signOut}})
 mock.signIn.mockResolvedValue({data:{user:{id:'admin-id'}}});mock.signOut.mockResolvedValue({error:null});mock.updateUser.mockResolvedValue({data:{user:{id:'admin-id'}}})
})
it('uses the existing own-user Auth update, verifies current password in isolation, and leaves email/session management alone',async()=>{
 await changeAdminPassword(current,next,next)
 expect(mock.signIn).toHaveBeenCalledWith({email:'admin@example.test',password:current})
 expect(mock.signOut).toHaveBeenCalledWith({scope:'local'})
 expect(mock.updateUser).toHaveBeenCalledWith({password:next,current_password:current})
 expect(mock.eq).toHaveBeenCalledWith('id','admin-id')
})
it('wrong current password cannot update and verification session is cleaned up',async()=>{
 mock.signIn.mockResolvedValue({error:{code:'invalid_credentials'}})
 await expect(changeAdminPassword(current,next,next)).rejects.toMatchObject({code:'currentInvalid'})
 expect(mock.updateUser).not.toHaveBeenCalled();expect(mock.signOut).toHaveBeenCalledOnce()
})
it('inactive/non-admin or unauthenticated callers never verify or update passwords',async()=>{
 mock.maybeSingle.mockResolvedValue({data:null})
 await expect(changeAdminPassword(current,next,next)).rejects.toMatchObject({code:'adminRequired'})
 expect(mock.create).not.toHaveBeenCalled();expect(mock.updateUser).not.toHaveBeenCalled()
 mock.getUser.mockResolvedValue({data:{user:null}})
 await expect(changeAdminPassword(current,next,next)).rejects.toMatchObject({code:'authRequired'})
})
it('validates confirmation, length and password reuse before any network requests',async()=>{
 expect(passwordValidation(current,'short','short')).toBe('tooShort')
 expect(passwordValidation(current,next,'different')).toBe('mismatch')
 expect(passwordValidation(current,current,current)).toBe('samePassword')
 await expect(changeAdminPassword(current,next,'different')).rejects.toMatchObject({code:'mismatch'})
 expect(mock.getUser).not.toHaveBeenCalled()
})
it('server reauthentication policy is preserved and raw server errors are not exposed',async()=>{
 mock.updateUser.mockResolvedValue({error:{code:'reauthentication_needed',message:next}})
 await expect(changeAdminPassword(current,next,next)).rejects.toMatchObject({code:'reauthRequired',message:'reauthRequired'})
})
it.each(['1234567','abcdefg','a1b2c3d'])('submits seven-character password %s unchanged to Supabase Auth',async password=>{
 expect(passwordValidation(current,password,password)).toBeNull()
 await changeAdminPassword(current,password,password)
 expect(mock.updateUser).toHaveBeenCalledWith({password,current_password:current})
})
it('six characters are blocked locally, but a Supabase rejection of seven characters remains an error',async()=>{
 expect(passwordValidation(current,'123456','123456')).toBe('tooShort')
 mock.updateUser.mockResolvedValue({error:{code:'weak_password'}})
 await expect(changeAdminPassword(current,'1234567','1234567')).rejects.toMatchObject({code:'weakPassword'})
})
