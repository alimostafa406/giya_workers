import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkersRequest, getWorkersActivatedTodayRequest } from './workersApi'
import { getAttendanceRowsRequest, getWorkerLastNonAbsentBeforeRequest } from './attendanceApi'
import { getBiometricMappingsRequest, getInactiveWorkerBiometricActivityRequest, getWorkerBiometricSearchIndexRequest } from './biometricMappingApi'
import { clearWorkerControlDataCache, getWorkerControlDataSnapshot, invalidateWorkerControlAttendanceCache, loadWorkerControlData, loadWorkerControlHistoryRows, loadWorkerControlSearchMappings, workerControlAttendanceParams, WORKER_CONTROL_CACHE_TTL, WORKER_CONTROL_READ_TIMEOUT_MS } from './workerControlData'

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
  getWorkerLastNonAbsentBeforeRequest: vi.fn(async () => ({ data: null })),
}))
vi.mock('./biometricMappingApi', () => ({
  getBiometricMappingsRequest: vi.fn(async () => ({ data: [] })),
  getWorkerBiometricSearchIndexRequest: vi.fn(async () => ({ data: [] })),
  getInactiveWorkerBiometricActivityRequest: vi.fn(async () => ({ data: [] })),
}))

const date = '2026-09-29'
beforeEach(() => { clearWorkerControlDataCache(); vi.clearAllMocks() })
afterEach(() => { clearWorkerControlDataCache(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Worker Control Center bulk data loading', () => {
  it('loads one-worker bounded history and reuses the same-period cache', async () => {
    await loadWorkerControlHistoryRows({ workerId: 'one', dateFrom: '2026-08-01', dateTo: date })
    await loadWorkerControlHistoryRows({ workerId: 'one', dateFrom: '2026-08-01', dateTo: date })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(1)
    expect(getAttendanceRowsRequest).toHaveBeenCalledWith(expect.objectContaining({ worker_id: 'one', date_from: '2026-08-01', date_to: date, paginate: true, signal: expect.any(AbortSignal) }))
  })

  it('reads a cached confirmed-mapping search index only on demand', async () => {
    await loadWorkerControlSearchMappings()
    await loadWorkerControlSearchMappings()
    expect(getWorkerBiometricSearchIndexRequest).toHaveBeenCalledTimes(1)
  })
  it('bounds the weekly read to Monday and reads no unused RPC or mappings', async () => {
    const data = await loadWorkerControlData({ date, category: 'weekly' })
    expect(workerControlAttendanceParams(date, 'weekly')).toEqual({ date_from: '2026-09-28', date_to: date, paginate: true })
    expect(getAttendanceRowsRequest).toHaveBeenCalledWith(expect.objectContaining({ date_from: '2026-09-28', date_to: date, paginate: true, signal: expect.any(AbortSignal) }))
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
    expect(getWorkersRequest).toHaveBeenCalledWith({ includePayrollProfiles: false })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(1)
    expect(getInactiveWorkerBiometricActivityRequest).not.toHaveBeenCalled()
    expect(getWorkersActivatedTodayRequest).not.toHaveBeenCalled()
    expect(getBiometricMappingsRequest).not.toHaveBeenCalled()
    expect(data.workers).toHaveLength(1)
  })

  it('keeps hub history-free and shares the consecutive history with later category navigation', async () => {
    await loadWorkerControlData({ date, category: null })
    expect(getAttendanceRowsRequest).not.toHaveBeenCalled()
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
    getWorkerLastNonAbsentBeforeRequest.mockResolvedValueOnce({ data: { worker_id: 'one', attendance_date: '2026-08-30', status: 'present' } })
    const detail = await loadWorkerControlData({ date, category: 'worker-detail', workerId: 'one' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledWith(expect.objectContaining({ worker_id: 'one', date_from: '2026-09-01', date_to: date, paginate: true }))
    expect(getWorkerLastNonAbsentBeforeRequest).toHaveBeenCalledWith(expect.objectContaining({ workerId: 'one', dateBefore: '2026-09-01' }))
    expect(getBiometricMappingsRequest).toHaveBeenCalledWith({ workerId: 'one' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(1)
    expect(detail.attendance).toContainEqual({ worker_id: 'one', attendance_date: '2026-08-30', status: 'present' })
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

  it('keeps the shared roster through normal navigation after 45 seconds', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    await loadWorkerControlData({ date, category: null })
    now += 45_000
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
  })

  it('reuses hub data through weekly, monthly, detail and back navigation', async () => {
    await loadWorkerControlData({ date, category: null })
    await loadWorkerControlData({ date, category: 'weekly' })
    await loadWorkerControlData({ date, category: 'monthly' })
    await loadWorkerControlData({ date, category: 'weekly' })
    await loadWorkerControlData({ date, category: 'worker-detail', workerId: 'one' })
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(3)
    expect(getBiometricMappingsRequest).toHaveBeenCalledTimes(1)
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly' })).not.toBeNull()
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly' })?.attendance).toHaveLength(3)
  })

  it('keeps the shared roster warm while each category reads only its own date scope', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    await loadWorkerControlData({ date, category: null })
    vi.clearAllMocks()
    now += 45_000
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getWorkersRequest).not.toHaveBeenCalled()
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(1)
    await loadWorkerControlData({ date, category: 'monthly' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
    await loadWorkerControlData({ date, category: 'worker-detail', workerId: 'one' })
    expect(getBiometricMappingsRequest).toHaveBeenCalledTimes(1)
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(3)
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getWorkersRequest).not.toHaveBeenCalled()
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(3)
  })

  it('keeps a stale snapshot visible while attendance revalidates after its shorter TTL', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    await loadWorkerControlData({ date, category: 'weekly' })
    now += WORKER_CONTROL_CACHE_TTL.attendance + 1
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly' })).not.toBeNull()
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly' })?.attendance).toHaveLength(3)
    getAttendanceRowsRequest.mockResolvedValueOnce({ data: [{ worker_id: 'one', attendance_date: date, status: 'present' }] })
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly' })?.attendance).toHaveLength(1)
  })

  it('deduplicates simultaneous reads of the same in-flight dataset', async () => {
    let release
    getAttendanceRowsRequest.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const first = loadWorkerControlData({ date, category: 'weekly' })
    const second = loadWorkerControlData({ date, category: 'weekly' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release({ data: [] })
    await Promise.all([first, second])
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(1)
  })

  it('invalidates attendance after recovery without needlessly refetching the roster', async () => {
    await loadWorkerControlData({ date, category: 'weekly' })
    invalidateWorkerControlAttendanceCache()
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly' })).toBeNull()
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
  })

  it('starts cold after the in-memory cache is cleared, as on a full app reload', async () => {
    await loadWorkerControlData({ date, category: 'weekly' })
    clearWorkerControlDataCache()
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly' })).toBeNull()
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getWorkersRequest).toHaveBeenCalledTimes(2)
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
  })

  it('does not reuse cached worker data across authenticated users', async () => {
    await loadWorkerControlData({ date, category: 'weekly', authKey: 'admin-one' })
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly', authKey: 'admin-two' })).toBeNull()
    await loadWorkerControlData({ date, category: 'weekly', authKey: 'admin-two' })
    expect(getWorkersRequest).toHaveBeenCalledTimes(2)
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
  })

  it('delivers core hub data without waiting for optional activity reads', async () => {
    let release
    getInactiveWorkerBiometricActivityRequest.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const onCore = vi.fn()
    const loading = loadWorkerControlData({ date, category: null, onCore })
    await vi.waitFor(() => expect(onCore).toHaveBeenCalledTimes(1))
    expect(onCore.mock.calls[0][0].workers).toHaveLength(1)
    release({ data: [] })
    await loading
  })

  it('keeps the core hub data when an optional read rejects and retries it later', async () => {
    getInactiveWorkerBiometricActivityRequest.mockRejectedValueOnce(new Error('Activity unavailable'))
    const onCore = vi.fn()
    const onOptionalError = vi.fn()
    const data = await loadWorkerControlData({ date, category: null, onCore, onOptionalError })
    expect(onCore).toHaveBeenCalledTimes(1)
    expect(data.workers).toHaveLength(1)
    expect(onOptionalError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Activity unavailable' }))
    await loadWorkerControlData({ date, category: null })
    expect(getInactiveWorkerBiometricActivityRequest).toHaveBeenCalledTimes(2)
  })

  it('times out a cold hanging read and removes its in-flight cache entry for retry', async () => {
    vi.useFakeTimers()
    getAttendanceRowsRequest.mockImplementationOnce(() => new Promise(() => {}))
    const first = loadWorkerControlData({ date, category: 'weekly' })
    const failure = expect(first).rejects.toThrow('Timed out loading Worker Control Center data')
    await vi.advanceTimersByTimeAsync(WORKER_CONTROL_READ_TIMEOUT_MS)
    await failure
    const recovered = await loadWorkerControlData({ date, category: 'weekly' })
    expect(recovered.attendance).toHaveLength(3)
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
  })

  it('aborts a timed-out one-worker history read without poisoning the warm hub cache', async () => {
    vi.useFakeTimers()
    await loadWorkerControlData({ date, category: null })
    getAttendanceRowsRequest.mockImplementationOnce(() => new Promise(() => {}))
    const first = loadWorkerControlHistoryRows({ workerId: 'one', dateFrom: '2026-08-01', dateTo: date })
    const failure = expect(first).rejects.toThrow('Timed out loading worker attendance history')
    await vi.advanceTimersByTimeAsync(WORKER_CONTROL_READ_TIMEOUT_MS)
    await failure
    expect(getAttendanceRowsRequest.mock.calls[0][0].signal.aborted).toBe(true)
    expect(getWorkerControlDataSnapshot({ date, category: null })?.workers).toHaveLength(1)
    await loadWorkerControlHistoryRows({ workerId: 'one', dateFrom: '2026-08-01', dateTo: date })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(2)
    expect(getWorkersRequest).toHaveBeenCalledTimes(1)
  })

  it('does not keep a failed stale refresh pending in the cache', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    await loadWorkerControlData({ date, category: 'weekly' })
    now += WORKER_CONTROL_CACHE_TTL.attendance + 1
    getAttendanceRowsRequest.mockRejectedValueOnce(new Error('Refresh failed'))
    await expect(loadWorkerControlData({ date, category: 'weekly' })).rejects.toThrow('Refresh failed')
    expect(getWorkerControlDataSnapshot({ date, category: 'weekly' })?.attendance).toHaveLength(3)
    await loadWorkerControlData({ date, category: 'weekly' })
    expect(getAttendanceRowsRequest).toHaveBeenCalledTimes(3)
  })
})
