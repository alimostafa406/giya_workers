import { create } from 'zustand'
import {
  getCurrentAdminRequest,
  getCurrentUserRequest,
  loginRequest,
  logoutRequest,
} from '../api/authApi'
import { getErrorMessage } from '../api/axios'

export const useAuthStore = create(
  (set, get) => ({
    user: null,
    admin: null,
    session: null,
    isLoading: false,
    isReady: false,
    error: null,

    clearSession: () => {
      set({ user: null, admin: null, session: null, error: null })
    },

    hydrateAdminSession: async (session) => {
      if (!session?.user?.id) {
        set({ user: null, admin: null, session: null, isReady: true })
        return null
      }

      const { data: admin } = await getCurrentAdminRequest(session.user.id)

      if (!admin || !admin.is_active) {
        await logoutRequest().catch(() => {})
        set({ user: null, admin: null, session: null, isReady: true })
        return null
      }

      set({ user: session.user, admin, session, isReady: true })
      return admin
    },

    login: async (email, password) => {
      set({ isLoading: true, error: null })
      try {
        const { data } = await loginRequest({ email, password })
        const session = data?.session || null
        if (!session?.user?.id) {
          throw new Error('لم يتم استلام جلسة المصادقة من الخادم')
        }

        const admin = await get().hydrateAdminSession(session)

        if (!admin) {
          throw new Error('هذا الحساب ليس لديه صلاحية دخول لوحة الإدارة أو أنه غير نشط')
        }

        set({ isLoading: false, error: null })

        return { success: true }
      } catch (error) {
        set({
          isLoading: false,
          error: getErrorMessage(error),
        })
        return { success: false, message: getErrorMessage(error) }
      }
    },

    logout: async () => {
      try {
        await logoutRequest()
      } catch {
        // Clear local auth state regardless of remote logout errors.
      } finally {
        set({ user: null, admin: null, session: null, error: null })
      }
    },

    bootstrapUser: async () => {
      try {
        const { data } = await getCurrentUserRequest()
        if (!data?.user?.id) {
          set({ user: null, admin: null, session: null, isReady: true })
          return
        }

        await get().hydrateAdminSession(data)
      } catch {
        set({ user: null, admin: null, session: null, isReady: true })
      }
    },

    setSession: (session) => {
      set({
        session,
        user: session?.user || null,
        admin: null,
        isReady: true,
      })
    },
  }),
)
