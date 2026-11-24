import { useAuthStore } from '../../store/authStore'
import { useState } from 'react'
import Modal from '../Modal/Modal'
import AdminPasswordChange from '../Forms/AdminPasswordChange'
import LanguageSwitcher from '../LanguageSwitcher'
import { useTranslation } from '../../i18n/LanguageContext'

function Navbar({ onOpenSidebar }) {
  const user = useAuthStore((state) => state.user)
  const admin = useAuthStore((state) => state.admin)
  const logout = useAuthStore((state) => state.logout)
  const { t, language } = useTranslation()
  const [passwordOpen,setPasswordOpen]=useState(false)
  const [passwordBusy,setPasswordBusy]=useState(false)
  const passwordTitle=({ar:'تغيير كلمة المرور',en:'Change password',fr:'Changer le mot de passe'})[language]||'Change password'
  const displayName = admin?.full_name || user?.name || user?.username || user?.email || 'المدير'

  return (
    <><header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-(--border) pb-4 sm:mb-7 sm:pb-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t('navigation.dashboard')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-(--border) bg-white text-(--text) shadow-sm lg:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <div>
          <p className="text-xs font-semibold text-(--muted)">{t('app.name')}</p>
          <h2 className="mt-0.5 text-lg font-extrabold tracking-tight text-(--text)">{t('navigation.dashboard')}</h2>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <LanguageSwitcher />
        <div className="hidden text-left sm:block">
          <p className="text-xs font-medium text-(--muted)">{t('common.currentUser')}</p>
          <p className="mt-0.5 text-sm font-extrabold text-(--text)">{displayName}</p>
        </div>
        <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-(--primary-soft) text-sm font-extrabold text-(--primary-strong) sm:flex">
          {String(displayName).trim().charAt(0) || 'م'}
        </div>
        {admin?.is_active&&<button type="button" data-admin-password-entry className="btn-secondary px-3 py-2 text-sm" onClick={()=>setPasswordOpen(true)} aria-haspopup="dialog">{passwordTitle}</button>}
        <button type="button" className="btn-secondary px-3 py-2 sm:px-4" onClick={logout} disabled={passwordBusy}>
          <span className="hidden sm:inline">{t('common.logout')}</span>
          <span className="sm:hidden">{t('common.logout')}</span>
        </button>
      </div>
    </header>
    <Modal isOpen={passwordOpen&&Boolean(admin?.is_active)} title={passwordTitle} onClose={()=>{if(!passwordBusy)setPasswordOpen(false)}}>
      <AdminPasswordChange embedded onBusyChange={setPasswordBusy}/>
    </Modal></>
  )
}

export default Navbar
