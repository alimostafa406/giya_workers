import { getWorkersRequest, getWorkersActivatedTodayRequest } from './workersApi'
import { getAttendanceRowsRequest } from './attendanceApi'
import { getBiometricMappingsRequest, getInactiveWorkerBiometricActivityRequest } from './biometricMappingApi'
import { workerControlPeriods } from '../utils/workerControlPeriods'

// Reuse in-flight reads and short-lived results while moving between Control
// Center categories. The date is part of every date-dependent key.
const CACHE_MS = 30_000
const cache = new Map()
const cached = (key, read) => {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.started < CACHE_MS) return entry.promise
  const promise = Promise.resolve().then(read).catch((error) => {
    if (cache.get(key)?.promise === promise) cache.delete(key)
    throw error
  })
  cache.set(key, { promise, started: Date.now() })
  return promise
}

export const clearWorkerControlDataCache = () => cache.clear()

export const workerControlAttendanceParams = (date, category, workerId) => {
  if (category === 'worker-detail') return { worker_id: workerId, date_to: date, paginate: true }
  if (category === 'weekly') return { date_from: workerControlPeriods(date).weekStart, date_to: date, paginate: true }
  if (category === null || category === 'consecutive-absence') return { date_to: date, paginate: true }
  return { date_from: workerControlPeriods(date).monthStart, date_to: date, paginate: true }
}

const attendanceFor = async (date, category, workerId) => {
  // These two lists come from their dedicated current-day RPCs; they do not
  // display attendance-derived counts.
  if (category === 'inactive-punched' || category === 'activated-today') return { data: [] }
  const params = workerControlAttendanceParams(date, category, workerId)
  const historyKey = `attendance:${date}:history`
  const history = cache.get(historyKey)
  if (history && Date.now() - history.started < CACHE_MS && category !== null && category !== 'consecutive-absence') {
    const response = await history.promise
    return { data: (response.data || []).filter((row) =>
      (!params.date_from || row.attendance_date >= params.date_from)
      && (!workerId || String(row.worker_id) === String(workerId))) }
  }
  const key = category === null || category === 'consecutive-absence' ? historyKey
    : `attendance:${date}:${params.date_from || 'history'}:${workerId || 'all'}`
  return cached(key, () => getAttendanceRowsRequest(params))
}

export const loadWorkerControlData = async ({ date, category, workerId }) => {
  const needsEvents = category === null || category === 'inactive-punched' || category === 'worker-detail'
  const needsActivated = category === null || category === 'activated-today' || category === 'worker-detail'
  const [workers, attendance, events, activated, mappings] = await Promise.all([
    cached('workers', () => getWorkersRequest({ includePayrollProfiles: false })),
    attendanceFor(date, category, workerId),
    needsEvents ? cached(`inactive-events:${date}`, () => getInactiveWorkerBiometricActivityRequest({ attendanceDate: date })) : { data: [] },
    needsActivated ? cached(`activated:${date}`, getWorkersActivatedTodayRequest) : { data: [] },
    category === 'worker-detail' ? cached(`mappings:${workerId}`, () => getBiometricMappingsRequest({ workerId }).catch(() => ({ data: [] }))) : { data: [] },
  ])
  return { workers: workers.data || [], attendance: attendance.data || [], events: events.data || [], activated: activated.data || [], mappings: mappings.data || [] }
}
