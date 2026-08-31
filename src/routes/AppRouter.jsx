import { useEffect } from 'react'
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout/Layout'
import Attendance from '../pages/Attendance'
import AbsenceReport from '../pages/AbsenceReport'
import SpecialStaffAttendance from '../pages/SpecialStaffAttendance'
import BiometricMapping from '../pages/BiometricMapping'
import Dashboard from '../pages/Dashboard'
import Login from '../pages/Login'
import MissingAttendance from '../pages/MissingAttendance'
import WeeklyAttendanceReport from '../pages/WeeklyAttendanceReport'
import Teams from '../pages/Teams'
import Supervisors from '../pages/Supervisors'
import Workers from '../pages/Workers'
import InactiveWorkers from '../pages/InactiveWorkers'
import AdvancedSettings from '../pages/AdvancedSettings'
import Payroll from '../pages/Payroll'
import ForeignAttendance from '../pages/ForeignAttendance'
import { useAuthStore } from '../store/authStore'

function ProtectedRoute() {
  const isReady = useAuthStore((state) => state.isReady)
  const admin = useAuthStore((state) => state.admin)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isReady || admin) {
      return
    }

    if (location.pathname !== '/login') {
      navigate('/login', { replace: true })
    }
  }, [admin, isReady, location.pathname, navigate])

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-(--muted)">
        جاري التحقق من الجلسة...
      </div>
    )
  }

  if (!admin) {
    return null
  }

  return <Outlet />
}

function LoginRoute() {
  const admin = useAuthStore((state) => state.admin)
  const isReady = useAuthStore((state) => state.isReady)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isReady || !admin) {
      return
    }

    if (location.pathname !== '/') {
      navigate('/', { replace: true })
    }
  }, [admin, isReady, location.pathname, navigate])

  return <Login />
}

function WildcardRedirect() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.pathname !== '/') {
      navigate('/', { replace: true })
    }
  }, [location.pathname, navigate])

  return null
}

function AppRouter() {
  const bootstrapUser = useAuthStore((state) => state.bootstrapUser)

  useEffect(() => {
    bootstrapUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        bootstrapUser()
      }
    })

    return () => subscription.unsubscribe()
  }, [bootstrapUser])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/foreign-attendance" element={<ForeignAttendance />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/supervisors" element={<Supervisors />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/inactive-workers" element={<InactiveWorkers />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/attendance/absence-report" element={<AbsenceReport />} />
            <Route path="/special-staff-attendance" element={<SpecialStaffAttendance />} />
            <Route path="/biometric-mapping" element={<BiometricMapping />} />
            <Route path="/missing-attendance" element={<MissingAttendance />} />
            <Route path="/reports/weekly-attendance" element={<WeeklyAttendanceReport />} />
            <Route path="/advanced-settings" element={<AdvancedSettings />} />
            <Route path="/payroll" element={<Payroll />} />
          </Route>
        </Route>

        <Route path="*" element={<WildcardRedirect />} />
      </Routes>
    </BrowserRouter>
  )
}

export default AppRouter
