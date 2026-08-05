import { useAuthStore } from '../../store/authStore'

function Navbar({ onOpenSidebar }) {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  return (
    <header className="surface-card mb-4 flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="btn-secondary lg:hidden"
        >
          القائمة
        </button>
        <div>
          <p className="text-xs text-(--muted)">نظام الحضور</p>
          <h2 className="text-base font-bold text-(--text)">لوحة التحكم</h2>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="text-left">
          <p className="text-xs text-(--muted)">المستخدم الحالي</p>
          <p className="text-sm font-semibold">
            {user?.name || user?.username || user?.email || 'Admin'}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={logout}>
          تسجيل الخروج
        </button>
      </div>
    </header>
  )
}

export default Navbar
