import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useTranslation } from '../i18n/LanguageContext'

function Login() {
  const { t } = useTranslation()
  const isReady = useAuthStore((state) => state.isReady)
  const login = useAuthStore((state) => state.login)
  const isLoading = useAuthStore((state) => state.isLoading)
  const error = useAuthStore((state) => state.error)

  const [form, setForm] = useState({
    email: '',
    password: '',
  })

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-(--muted)">
        {t('app.loading')}
      </div>
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    await login(form.email, form.password)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-(--border) bg-(--bg-soft) p-6 shadow-xl">
        <p className="text-xs text-(--muted)">Workers Attendance Admin</p>
        <h1 className="mb-5 mt-2 text-2xl font-extrabold">{t('app.name')}</h1>
        <p className="mb-5 text-sm text-(--muted)">{t('common.currentUser')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold">{t('login.email')}</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              className="input-base"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">{t('login.password')}</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, password: e.target.value }))
              }
              className="input-base"
              required
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button className="btn-primary w-full" type="submit" disabled={isLoading}>
            {isLoading ? '...' : t('login.signIn')}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
