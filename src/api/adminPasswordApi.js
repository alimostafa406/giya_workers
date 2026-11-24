import {supabase,createPasswordVerificationClient} from '../lib/supabase'

const failure=code=>Object.assign(new Error(code),{code})
export function passwordValidation(currentPassword,newPassword,confirmation){
 if(!currentPassword)return 'currentRequired'
 if(newPassword.length<12)return 'tooShort'
 if(newPassword!==confirmation)return 'mismatch'
 if(newPassword===currentPassword)return 'samePassword'
 return null
}
export async function changeAdminPassword(currentPassword,newPassword,confirmation){
 const invalid=passwordValidation(currentPassword,newPassword,confirmation)
 if(invalid)throw failure(invalid)
 const {data:userData,error:userError}=await supabase.auth.getUser()
 if(userError||!userData?.user?.id||!userData.user.email)throw failure('authRequired')
 const user=userData.user
 const {data:admin,error:adminError}=await supabase.from('admins').select('id,is_active').eq('id',user.id).maybeSingle()
 if(adminError||!admin?.is_active)throw failure('adminRequired')
 const verifier=createPasswordVerificationClient()
 try{
  const {data,error}=await verifier.auth.signInWithPassword({email:user.email,password:currentPassword})
  if(error)throw failure(error.code==='invalid_credentials'?'currentInvalid':'verifyFailed')
  if(data?.user?.id!==user.id)throw failure('verifyFailed')
 }finally{
  // Only the isolated verification session is closed. Never sign out the app.
  await verifier.auth.signOut({scope:'local'}).catch(()=>{})
 }
 const {error}=await supabase.auth.updateUser({password:newPassword,current_password:currentPassword})
 if(error){
  if(['reauthentication_needed','reauthentication_not_valid','session_not_found'].includes(error.code))throw failure('reauthRequired')
  if(error.code==='weak_password')throw failure('weakPassword')
  if(error.code==='same_password')throw failure('samePassword')
  if(error.code==='invalid_credentials')throw failure('currentInvalid')
  throw failure('updateFailed')
 }
}
