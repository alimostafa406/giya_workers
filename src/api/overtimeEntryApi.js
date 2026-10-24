import { getWorkersRequest } from './workersApi'
import { getAttendanceRowsRequest } from './attendanceApi'
import { getSupabaseClient } from '../lib/supabase'

// Bulk reads only; no request per worker or per search keystroke.
export async function getOvertimeEntryPayrollLocks(date) {
  const locked = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabaseClient().from('payroll_line')
      .select('id,worker_id,payroll_run:payroll_run!inner(status)')
      .lte('attendance_period_start', date).gte('attendance_period_end', date)
      .in('payroll_run.status', ['finalized', 'paid']).order('id').range(offset, offset + 499)
    if (error) throw error
    locked.push(...(data || []).map((row) => String(row.worker_id)))
    if ((data || []).length < 500) return [...new Set(locked)]
  }
}
export async function getOvertimeEntryData(date) {
  const [workers, attendance, lockedIds] = await Promise.all([
    getWorkersRequest({ includePayrollProfiles: false }), getAttendanceRowsRequest({ date, paginate: true }), getOvertimeEntryPayrollLocks(date),
  ])
  return { date, workers: workers.data || [], attendance: attendance.data || [], lockedIds }
}
export async function saveOvertimeEntry({ requestId, date, entries }) {
  if (!entries.length || entries.length > 200 || new Set(entries.map((row) => row.worker_id)).size !== entries.length
    || entries.some((row) => !row.expected_updated_at || !Number.isInteger(row.minutes) || row.minutes < 1 || row.minutes > 1440)) throw new Error('Invalid overtime batch')
  const { data, error } = await getSupabaseClient().rpc('admin_apply_bulk_emergency_overtime', {
    p_request_id: requestId, p_date: date, p_mode: 'manual_overtime_duration',
    p_reason: 'Weekly team overtime entry (SET duration)', p_note: null,
    p_entries: entries.map(({ worker_id, expected_updated_at, minutes }) => ({ worker_id, expected_updated_at, minutes })),
  })
  if (error) throw error
  return data
}
