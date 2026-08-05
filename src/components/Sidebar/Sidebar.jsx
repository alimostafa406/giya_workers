import { NavLink, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: 'الرئيسية' },
  { to: '/teams', label: 'الفرق' },
  { to: '/supervisors', label: 'المشرفون' },
  { to: '/workers', label: 'العمال' },
  { to: '/attendance', label: 'الحضور' },
  { to: '/missing-attendance', label: 'فرق لم تسجل' },
  { to: '/reports/weekly-attendance', label: 'تقرير الحضور الأسبوعي' },
]

function Sidebar({ isOpen, onClose }) {
  const location = useLocation()

  return (
    <aside
      className={`fixed right-0 top-0 z-40 h-screen w-72 border-l border-(--border) bg-(--bg-soft) p-4 transition-transform lg:static lg:w-64 lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
      }`}
    >
      <div className="mb-8 rounded-2xl bg-(--primary) p-4 text-white">
        <p className="text-xs text-white/80">Workers Attendance</p>
        <h1 className="mt-2 text-xl font-bold">لوحة إدارة المقاولات</h1>
      </div>

      <nav className="space-y-2">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            onClick={() => {
              onClose?.()
            }}
            className={({ isActive }) =>
              `block rounded-xl px-4 py-3 text-sm font-semibold transition ${
                isActive
                  ? 'bg-(--primary) text-white'
                  : 'text-(--text) hover:bg-stone-100'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
