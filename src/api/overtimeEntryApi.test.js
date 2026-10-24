// @vitest-environment jsdom
import { expect, it, vi, beforeEach } from 'vitest'
const mock = vi.hoisted(() => ({ rpc: vi.fn(), workers: vi.fn(), attendance: vi.fn(), query: null, from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ from: mock.from, rpc: mock.rpc }) }))
vi.mock('./workersApi', () => ({ getWorkersRequest: mock.workers }))
vi.mock('./attendanceApi', () => ({ getAttendanceRowsRequest: mock.attendance }))
vi.mock('./biometricMappingApi', () => ({ getWorkerBiometricSearchIndexRequest: vi.fn(async () => ({ data: [{ worker_id: 'w1', device_employee_no: '025', is_active: true, mapping_review_state: 'confirmed' }] })) }))
import { getOvertimeEntryData, saveOvertimeEntry } from './overtimeEntryApi'
beforeEach(() => {
  mock.rpc.mockReset().mockResolvedValue({ data: { updated: 1 }, error: null })
  const query = {}; for (const method of ['select','lte','gte','in','order','range']) query[method] = vi.fn(() => query)
  query.then = (resolve) => Promise.resolve({ data: [{ worker_id: 'w1' }], error: null }).then(resolve)
  mock.query = query; mock.from.mockReset().mockReturnValue(query)
  mock.workers.mockResolvedValue({ data: [] }); mock.attendance.mockResolvedValue({ data: [] })
})
it('uses the canonical RPC, SET duration, version token and no fake times or extra fields', async () => {
  await saveOvertimeEntry({ requestId: 'request', date: '2026-10-23', entries: [{ worker_id: 'w1', minutes: 120, expected_updated_at: 'version', name: 'NAME', check_out: '19:00' }] })
  expect(mock.rpc).toHaveBeenCalledWith('admin_apply_bulk_emergency_overtime', {
    p_request_id: 'request', p_date: '2026-10-23', p_mode: 'manual_overtime_duration', p_reason: 'Weekly team overtime entry (SET duration)', p_note: null,
    p_entries: [{ worker_id: 'w1', minutes: 120, expected_updated_at: 'version' }],
  })
})
it('bulk-loads date attendance and finalized/paid payroll locks, not one request per worker', async () => {
  const data = await getOvertimeEntryData('2026-10-23')
  expect(data.lockedIds).toEqual(['w1'])
  expect(data.mappings[0].device_employee_no).toBe('025')
  expect(mock.workers).toHaveBeenCalledWith()
  expect(mock.attendance).toHaveBeenCalledWith({ date: '2026-10-23', paginate: true })
  expect(mock.query.in).toHaveBeenCalledWith('payroll_run.status', ['finalized','paid'])
  expect(mock.query.lte).toHaveBeenCalledWith('attendance_period_start', '2026-10-23')
  expect(mock.query.gte).toHaveBeenCalledWith('attendance_period_end', '2026-10-23')
  expect(mock.from).toHaveBeenCalledTimes(1)
})
it('rejects duplicate, empty and invalid-duration batches before contacting the writer', async () => {
  for (const entries of [[], [{ worker_id: 'w', minutes: 0, expected_updated_at: 'v' }], [
    { worker_id: 'w', minutes: 120, expected_updated_at: 'v' }, { worker_id: 'w', minutes: 120, expected_updated_at: 'v' },
  ]]) await expect(saveOvertimeEntry({ date: '2026-10-23', entries })).rejects.toThrow('Invalid overtime batch')
  expect(mock.rpc).not.toHaveBeenCalled()
})
