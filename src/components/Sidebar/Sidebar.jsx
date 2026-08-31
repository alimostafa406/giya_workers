import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from '../../i18n/LanguageContext'

function NavIcon({ name }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    teams: <><path d="M8 21v-2a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v2" /><circle cx="14.5" cy="7" r="4" /><path d="M4 21v-2a4 4 0 0 1 2.4-3.66M7 3.34a4 4 0 0 0 0 7.32" /></>,
    supervisors: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1M18 9.5a3.5 3.5 0 0 0 0-5M20 21v-1a5.8 5.8 0 0 0-1.5-3.9" /></>,
    workers: <><circle cx="12" cy="7" r="4" /><path d="M5 21v-1a7 7 0 0 1 14 0v1" /><path d="M8 13h8" /></>,
    inactiveWorkers: <><circle cx="12" cy="7" r="4" /><path d="M5 21v-1a7 7 0 0 1 14 0v1" /><path d="m17 3 4 4M21 3l-4 4" /></>,
    attendance: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18M8 15l2.5 2.5L16 12" /></>,
    specialStaff: <><circle cx="12" cy="8" r="4" /><path d="M5 21v-1a7 7 0 0 1 14 0v1" /><path d="M18 4v5M15.5 6.5h5" /></>,
    biometric: <><path d="M12 11a3 3 0 1 0-3-3" /><path d="M12 3a5 5 0 0 1 5 5c0 5-2 7-2 11M7 8a5 5 0 0 1 5-5M7 12c0 3 1 5 1 8M12 13c0 3-.5 5-1.5 8M4 8c0 6 2 9 2 13M20 8c0 6-1 9-2 13" /></>,
    alert: <><path d="m10.3 3.5-8 14A2 2 0 0 0 4 20.5h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
    report: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 17v-5M12 17v-2M16 17v-7" /></>,
    payroll: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M7 10h10M7 14h6" /></>,
  }

  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">{paths[name]}</svg>
}

function Sidebar({ isOpen, onClose }) {
  const { t } = useTranslation()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const mainLinks = [
    { to: '/', label: t('navigation.dashboard'), icon: 'dashboard' },
    { to: '/attendance', label: t('navigation.attendance'), icon: 'attendance' },
    { to: '/workers', label: t('navigation.workers'), icon: 'workers' },
    { to: '/inactive-workers', label: t('navigation.inactiveWorkers'), icon: 'inactiveWorkers' },
    { to: '/teams', label: t('navigation.teams'), icon: 'teams' },
    { to: '/special-staff-attendance', label: t('navigation.specialStaff'), icon: 'specialStaff' },
    { to: '/reports/weekly-attendance', label: t('navigation.reports'), icon: 'report' },
    { to: '/payroll', label: t('navigation.payroll'), icon: 'payroll' },
  ]
  const advancedLinks = [
    { to: '/advanced-settings', label: t('navigation.agentStatus'), icon: 'alert' },
    { to: '/biometric-mapping', label: t('navigation.biometricMapping'), icon: 'biometric' },
    { to: '/supervisors', label: t('navigation.supervisors'), icon: 'supervisors' },
    { to: '/missing-attendance', label: t('navigation.missingAttendance'), icon: 'alert' },
  ]
  return (
    <aside
      className={`app-sidebar fixed right-0 top-0 z-40 flex h-screen w-72 flex-col border-l border-(--border) bg-white p-4 shadow-[-8px_0_24px_rgba(15,23,42,0.06)] transition-transform duration-200 lg:sticky lg:w-72 lg:translate-x-0 lg:shadow-none ${
        isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
      }`}
    >
      <div className="mb-7 flex items-center gap-3 px-2 pt-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-(--primary) text-lg font-extrabold text-white shadow-sm">و</div>
        <div>
          <h1 className="text-base font-extrabold tracking-tight text-(--text)">{t('app.name')}</h1>
          <p className="mt-0.5 text-xs font-medium text-(--muted)">{t('app.subtitle')}</p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 pb-4">
        <div className="space-y-1">
          {mainLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  onClick={() => onClose?.()}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                      isActive
                        ? 'bg-(--primary-soft) text-(--primary-strong)'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-(--text)'
                    }`
                  }
                >
                  <NavIcon name={link.icon} />
                  {link.label}
                </NavLink>
          ))}
        </div>
        <div className="border-t border-(--border) pt-4">
          <button type="button" onClick={() => setAdvancedOpen((open) => !open)} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-extrabold text-(--muted) hover:bg-slate-50"><span>{t('navigation.advanced')}</span><span>{advancedOpen ? '−' : '+'}</span></button>
          {advancedOpen ? <div className="mt-2 space-y-1">{advancedLinks.map((link) => <NavLink key={link.to} to={link.to} onClick={() => onClose?.()} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${isActive ? 'bg-(--primary-soft) text-(--primary-strong)' : 'text-slate-600 hover:bg-slate-50 hover:text-(--text)'}`}><NavIcon name={link.icon} />{link.label}</NavLink>)}</div> : null}
        </div>
      </nav>

      <div className="rounded-xl border border-(--border) bg-(--surface-subtle) px-3 py-3 text-xs leading-5 text-(--muted)">
        {t('app.subtitle')}
      </div>
    </aside>
  )
}

export default Sidebar
