import {useState} from 'react'
import {useAuthStore} from '../../store/authStore'
import {useTranslation} from '../../i18n/LanguageContext'
import {changeAdminPassword,passwordValidation} from '../../api/adminPasswordApi'

const labels={
 ar:{title:'تغيير كلمة مرور حساب الإدارة',current:'كلمة المرور الحالية',next:'كلمة المرور الجديدة',confirm:'تأكيد كلمة المرور الجديدة',save:'تغيير كلمة المرور',saving:'جاري الحفظ...',help:'استخدم 12 حرفاً على الأقل. أدخل كلمة المرور هنا فقط؛ لن يتغير بريد الحساب.',success:'تم تغيير كلمة المرور بنجاح. استخدم الكلمة الجديدة عند تسجيل الدخول.',currentRequired:'أدخل كلمة المرور الحالية.',tooShort:'يجب ألا تقل كلمة المرور الجديدة عن 12 حرفاً.',mismatch:'كلمة المرور الجديدة والتأكيد غير متطابقين.',samePassword:'اختر كلمة مرور مختلفة عن الحالية.',authRequired:'يرجى تسجيل الدخول مجدداً.',adminRequired:'يتطلب هذا الإجراء حساب إدارة نشطاً.',currentInvalid:'كلمة المرور الحالية غير صحيحة.',verifyFailed:'تعذر التحقق من كلمة المرور الحالية. تحقق من الاتصال وحاول مرة أخرى.',reauthRequired:'تتطلب حماية الحساب تسجيل الدخول مجدداً قبل تغيير كلمة المرور.',weakPassword:'كلمة المرور لا تستوفي سياسة أمان الحساب. اختر كلمة أقوى.',updateFailed:'تعذر تغيير كلمة المرور. تحقق من الاتصال وحاول مرة أخرى.'},
 en:{title:'Change administrator password',current:'Current password',next:'New password',confirm:'Confirm new password',save:'Change password',saving:'Saving...',help:'Use at least 12 characters. Enter your password only here; your account email stays the same.',success:'Password changed successfully. Use the new password when signing in.',currentRequired:'Enter your current password.',tooShort:'Use at least 12 characters for the new password.',mismatch:'The new password and confirmation do not match.',samePassword:'Choose a password different from the current one.',authRequired:'Please sign in again.',adminRequired:'An active administrator account is required.',currentInvalid:'The current password is incorrect.',verifyFailed:'Unable to verify your current password. Check your connection and try again.',reauthRequired:'Account security requires you to sign in again before changing your password.',weakPassword:'This password does not meet the account security policy. Choose a stronger password.',updateFailed:'Unable to change the password. Check your connection and try again.'},
 fr:{title:'Changer le mot de passe administrateur',current:'Mot de passe actuel',next:'Nouveau mot de passe',confirm:'Confirmer le nouveau mot de passe',save:'Changer le mot de passe',saving:'Enregistrement...',help:'Utilisez au moins 12 caractères. Saisissez le mot de passe uniquement ici ; votre adresse e-mail reste inchangée.',success:'Mot de passe modifié. Utilisez le nouveau mot de passe pour vous connecter.',currentRequired:'Saisissez votre mot de passe actuel.',tooShort:'Utilisez au moins 12 caractères.',mismatch:'Les nouveaux mots de passe ne correspondent pas.',samePassword:'Choisissez un mot de passe différent.',authRequired:'Veuillez vous reconnecter.',adminRequired:'Un compte administrateur actif est requis.',currentInvalid:'Le mot de passe actuel est incorrect.',verifyFailed:'Vérification impossible. Vérifiez la connexion et réessayez.',reauthRequired:'Reconnectez-vous avant de changer le mot de passe.',weakPassword:'Choisissez un mot de passe plus fort conforme aux règles du compte.',updateFailed:'Modification impossible. Vérifiez la connexion et réessayez.'},
}
export default function AdminPasswordChange(){
 const admin=useAuthStore(s=>s.admin),{language}=useTranslation(),l=labels[language]||labels.en
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState('')
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false)
 if(!admin?.is_active)return null
 const submit=async e=>{
  e.preventDefault();if(saving)return
  setSuccess(false);const invalid=passwordValidation(current,next,confirm)
  if(invalid){setError(invalid);return}
  setSaving(true);setError('')
  try{await changeAdminPassword(current,next,confirm);setSuccess(true)}catch(e){setError(labels.en[e.code]?e.code:'updateFailed')}
  finally{setCurrent('');setNext('');setConfirm('');setSaving(false)}
 }
 return <section className="surface-card mt-6 max-w-xl p-4" aria-label={l.title}>
  <h2 className="font-extrabold">{l.title}</h2><p className="my-2 text-sm text-(--muted)">{l.help}</p>
  <form onSubmit={submit}><fieldset disabled={saving} className="space-y-3">
   <label className="block text-sm">{l.current}<input className="input-base mt-1" type="password" autoComplete="current-password" required value={current} onChange={e=>setCurrent(e.target.value)}/></label>
   <label className="block text-sm">{l.next}<input className="input-base mt-1" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={e=>setNext(e.target.value)}/></label>
   <label className="block text-sm">{l.confirm}<input className="input-base mt-1" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
   {error&&<p role="alert" className="text-sm text-red-700">{l[error]||l.updateFailed}</p>}
   {success&&<p role="status" className="text-sm text-green-700">{l.success}</p>}
   <button className="btn-primary" type="submit">{saving?l.saving:l.save}</button>
  </fieldset></form>
 </section>
}
