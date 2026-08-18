import { useAuthStore } from '../../store/authStore'
import LanguageSwitcher from '../LanguageSwitcher'
import { useTranslation } from '../../i18n/LanguageContext'

function Navbar({ onOpenSidebar }) {
  const user = useAuthStore((state) => state.user)
  const admin = useAuthStore((state) => state.admin)
  const logout = useAuthStore((state) => state.logout)
  const { t } = useTranslation()
  const displayName = admin?.full_name || user?.name || user?.username || user?.email || 'المدير'

  return (
    <header className="mb-6 flex items-center justify-between gap-3 border-b border-(--border) pb-4 sm:mb-7 sm:pb-5">
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

      <div className="flex items-center gap-2 sm:gap-3">
        <LanguageSwitcher />
        <div className="hidden text-left sm:block">
          <p className="text-xs font-medium text-(--muted)">{t('common.currentUser')}</p>
          <p className="mt-0.5 text-sm font-extrabold text-(--text)">{displayName}</p>
        </div>
        <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-(--primary-soft) text-sm font-extrabold text-(--primary-strong) sm:flex">
          {String(displayName).trim().charAt(0) || 'م'}
        </div>
        <button type="button" className="btn-secondary px-3 py-2 sm:px-4" onClick={logout}>
          <span className="hidden sm:inline">{t('common.logout')}</span>
          <span className="sm:hidden">{t('common.logout')}</span>
        </button>
      </div>
    </header>
  )
}

export default Navbar
