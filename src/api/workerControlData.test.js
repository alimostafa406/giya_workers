import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkersRequest, getWorkersActivatedTodayRequest } from './workersApi'
import { getAttendanceRowsRequest } from './attendanceApi'
import { getBiometricMappingsRequest, getInactiveWorkerBiometricActivityRequest } from './biometricMappingApi'
import { clearWorkerControlDataCache, loadWorkerControlData, workerControlAttendanceParams } from './workerControlData'

vi.mock('./workersApi', () => ({
  getWorkersRequest: vi.fn(async () => ({ data: [{ id: 'one' }] })),
  getWorkersActivatedTodayRequest: vi.fn(async () => ({ data: [] })),
}))
vi.mock('./attendanceApi', () => ({
  getAttendanceRowsRequest: vi.fn(async () => ({ data: [
    { worker_id: 'one', attendance_date: '2026-09-22', status: 'present' },
    { worker_id: 'two', attendance_date: '2026-09-28', status: 'absent' },
    { worker_id: 'one', attendance_date: '2026-09-29', status: 'half_day' },
  ] })),
}))
vi.mock('./biometricMappingApi', () => ({
  getBiometricMappingsRequest: vi.fn(async () => ({ data: [] })),
  getInactiveWorkerBiometricActivityRequest: vi.fn(async () => ({ data: [] })),
}))

const date = '2026-09-29'
beforeEach(() => { clearWorkerControlDataCache(); vi.clearAllMocks() })
afterEach(() => clearWorkerControlDataCache())

describe('Worker Control Center bulk data loading', () => {
  it('bounds the weekly read to Monday and reads no unused RPC or mappings', async () => {
    const data = await loadWorkerControlData({ date, category: 'weekly' })
    expect(workerControlAttendanceParams(date, 'weekly')).toEqual({ date_from: '2026-09-28', date_to: date, paginate: true })
    expect(getAttendanceRowsRequest).toHaveBeenCalledWith({ date_from: '2026-09-28', date_to: date, paginate: true })
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
    expect(getWorkersRequest).toHaveBeenCalledWith({ includePayrollProfiles: false })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(1)
    expect(getInactiveWorkerBiometricActivityRequest).not.toHaveBeenCalled()
    expect(getWorkersActivatedTodayRequest).not.toHaveBeenCalled()
    expect(getBiometricMappingsRequest).not.toHaveBeenCalled()
    expect(data.workers).toHaveLength(1)
  })

  it('shares full history between hub, consecutive and weekly navigation without another attendance read', async () => {
    await loadWorkerControlData({ date, category: null })
    const consecutive = await loadWorkerControlData({ date, category: 'consecutive-absence' })
    const weekly = await loadWorkerControlData({ date, category: 'weekly' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(1)
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
    expect(getInactiveWorkerBiometricActivityRequest).toHaveBeenCalledTimes(1)
    expect(getWorkersActivatedTodayRequest).toHaveBeenCalledTimes(1)
    expect(getBiometricMappingsRequest).not.toHaveBeenCalled()
    expect(consecutive.attendance).toHaveLength(3)
    expect(weekly.attendance.map((row) => row.attendance_date)).toEqual(['2026-09-28', '2026-09-29'])
  })

  it('loads only the selected worker mappings and attendance on a direct detail visit', async () => {
    await loadWorkerControlData({ date, category: 'worker-detail', workerId: 'one' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledWith({ worker_id: 'one', date_to: date, paginate: true })
    expect(getBiometricMappingsRequest).toHaveBeenCalledWith({ workerId: 'one' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(1)
  })

  it('does not read attendance for activity-only and activation-only lists', async () => {
    await loadWorkerControlData({ date, category: 'inactive-punched' })
    await loadWorkerControlData({ date, category: 'activated-today' })
    expect(getAttendanceRowsRequest).not.toHaveBeenCalled()
    expect(getInactiveWorkerBiometricActivityRequest).toHaveBeenCalledTimes(1)
    expect(getWorkersActivatedTodayRequest).toHaveBeenCalledTimes(1)
  })

  it('uses a new date key and explicit invalidation to fetch fresh data', async () => {
    await loadWorkerControlData({ date, category: 'weekly' })
    await loadWorkerControlData({ date: '2026-09-30', category: 'weekly' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
    clearWorkerControlDataCache()
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(3)
  })
})
