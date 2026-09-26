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
import DailyOperationalReports from '../pages/DailyOperationalReports'
import DailyReportsCenter from '../pages/DailyReportsCenter'
import Teams from '../pages/Teams'
import Supervisors from '../pages/Supervisors'
import Workers from '../pages/Workers'
import InactiveWorkers from '../pages/InactiveWorkers'
import WorkerControlCenter from '../pages/WorkerControlCenter'
import CompensationReviewReport from '../pages/CompensationReviewReport'
import AdvancedSettings from '../pages/AdvancedSettings'
import AttendanceOvertimeSettings from '../pages/AttendanceOvertimeSettings'
import Payroll from '../pages/Payroll'
import PayrollPublication from '../pages/PayrollPublication'
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
            <Route path="/worker-control-center" element={<WorkerControlCenter />} />
            <Route path="/worker-control-center/absent-today" element={<WorkerControlCenter category="absent-today" />} />
            <Route path="/worker-control-center/consecutive-absence" element={<WorkerControlCenter category="consecutive-absence" />} />
            <Route path="/worker-control-center/weekly" element={<WorkerControlCenter category="weekly" />} />
            <Route path="/worker-control-center/monthly" element={<WorkerControlCenter category="monthly" />} />
            <Route path="/worker-control-center/half-day" element={<WorkerControlCenter category="half-day" />} />
            <Route path="/worker-control-center/inactive-punched" element={<WorkerControlCenter category="inactive-punched" />} />
            <Route path="/worker-control-center/activated-today" element={<WorkerControlCenter category="activated-today" />} />
            <Route path="/worker-control-center/returned" element={<WorkerControlCenter category="returned" />} />
            <Route path="/worker-control-center/teams" element={<WorkerControlCenter category="teams" />} />
            <Route path="/worker-control-center/teams/:teamId" element={<WorkerControlCenter category="team-detail" />} />
            <Route path="/worker-control-center/worker/:workerId" element={<WorkerControlCenter category="worker-detail" />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/attendance/absence-report" element={<AbsenceReport />} />
            <Route path="/special-staff-attendance" element={<SpecialStaffAttendance />} />
            <Route path="/biometric-mapping" element={<BiometricMapping />} />
            <Route path="/missing-attendance" element={<MissingAttendance />} />
            <Route path="/reports/weekly-attendance" element={<WeeklyAttendanceReport />} />
            <Route path="/reports/daily" element={<DailyReportsCenter />} />
            <Route path="/reports/daily/:date" element={<DailyReportsCenter />} />
            <Route path="/reports/daily-attendance-exceptions" element={<DailyOperationalReports type="exceptions" />} />
            <Route path="/reports/daily-overtime" element={<DailyOperationalReports type="overtime" />} />
            <Route path="/advanced-settings" element={<AdvancedSettings />} />
            <Route path="/settings" element={<AttendanceOvertimeSettings />} />
            <Route path="/settings/attendance-overtime" element={<AttendanceOvertimeSettings />} />
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/payroll/publication" element={<PayrollPublication />} />
            <Route path="/payroll/compensation-review" element={<CompensationReviewReport />} />
          </Route>
        </Route>

        <Route path="*" element={<WildcardRedirect />} />
      </Routes>
    </BrowserRouter>
  )
}

export default AppRouter
