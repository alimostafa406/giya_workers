import { useEffect, useState } from 'react'
import { getAttendanceAgentDeviceStatusesRequest, getAttendanceAgentStatusRequest, isAttendanceAgentOnline } from '../../api/attendanceAgentApi'

const formatDateTime = (value) => value
  ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—'

function AttendanceAgentStatus() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(false)
  const [devices, setDevices] = useState([])

  const load = async () => {
    try {
      const nextStatus = await getAttendanceAgentStatusRequest()
      setStatus(nextStatus)
      setDevices(await getAttendanceAgentDeviceStatusesRequest(nextStatus?.agent_id))
      setError(false)
    } catch {
      // The reviewed migration may not have been applied yet; the manual helper
      // controls remain available independently during transition.
      setError(true)
    }
  }

  useEffect(() => {
    load()
    const interval = window.setInterval(load, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const online = isAttendanceAgentOnline(status)
  const state = !status ? 'غير مسجل بعد' : online ? 'متصل' : 'غير متصل'
  const stateClass = online ? 'status-badge--success' : 'status-badge--neutral'

  return <div className="surface-card mb-5 flex flex-wrap items-center justify-between gap-4 p-4">
    <div>
      <h3 className="font-extrabold">حالة وكيل الحضور بالمكتب</h3>
      <p className="mt-1 text-sm text-(--muted)">الحالة تُقرأ من Supabase؛ لا يحتاج عرض الحضور إلى اتصال Vercel بجهاز البصمة.</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`status-badge ${stateClass}`}>الوكيل: {state}</span>
      {status ? <>
        <span className={`status-badge ${status.hikvision_reachable ? 'status-badge--success' : 'status-badge--neutral'}`}>Hikvision: {status.hikvision_reachable ? 'متصل' : 'غير متصل'}</span>
        <span className={`status-badge ${status.supabase_reachable ? 'status-badge--success' : 'status-badge--neutral'}`}>Supabase: {status.supabase_reachable ? 'متصل' : 'غير متصل'}</span>
      </> : null}
    </div>
      {status ? <div className="w-full grid gap-2 border-t border-slate-100 pt-3 text-xs text-(--muted) sm:grid-cols-3">
      <span>آخر نبض: {formatDateTime(status.last_seen_at)}</span>
      <span>آخر مزامنة مستخدمين: {formatDateTime(status.last_user_sync_at)}</span>
      <span>آخر مزامنة حضور: {formatDateTime(status.last_attendance_sync_at)}</span>
      {status.last_error ? <span className="sm:col-span-3 text-amber-700">آخر خطأ: {status.last_error}</span> : null}
    </div> : error ? <p className="w-full text-xs text-(--muted)">ستظهر الحالة هنا بعد مراجعة وتشغيل migration الخاصة بالوكيل وبدء الوكيل المحلي.</p> : null}
    {devices.length ? <div className="w-full border-t border-slate-100 pt-3 text-xs text-(--muted)">{devices.map((device) => <div key={device.device_id} className="flex flex-wrap justify-between gap-2 py-1"><span>{device.device_id}: {device.hikvision_reachable ? 'متصل' : 'غير متصل'}</span><span>آخر قراءة: {formatDateTime(device.last_successful_read_at)}</span>{device.last_error ? <span className="text-amber-700">{device.last_error}</span> : null}</div>)}</div> : null}
  </div>
}

export default AttendanceAgentStatus
