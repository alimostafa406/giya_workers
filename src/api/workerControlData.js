import { getWorkersRequest, getWorkersActivatedTodayRequest } from './workersApi'
import { getAttendanceRowsRequest, getWorkerLastNonAbsentBeforeRequest } from './attendanceApi'
import { getBiometricMappingsRequest, getInactiveWorkerBiometricActivityRequest, getWorkerBiometricSearchIndexRequest } from './biometricMappingApi'
import { workerControlPeriods } from '../utils/workerControlPeriods'

// This module is shared by every Control Center route for the lifetime of the
// SPA. Attendance stays short-lived; the slower-changing roster lasts longer.
export const WORKER_CONTROL_CACHE_TTL = { roster: 120_000, attendance: 60_000, activity: 60_000, mappings: 120_000 }
export const WORKER_CONTROL_READ_TIMEOUT_MS = 30_000
const cache = new Map()
let cacheDate = null
let cacheAuthKey = null
const isFresh = (entry, ttl) => entry?.value !== undefined && Date.now() - entry.loadedAt < ttl
const peek = (key) => cache.get(key)?.value
const readWithTimeout = (read, timeoutMessage) => new Promise((resolve, reject) => {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
    reject(new Error(timeoutMessage))
  }, WORKER_CONTROL_READ_TIMEOUT_MS)
  Promise.resolve().then(() => read(controller.signal)).then(resolve, reject).finally(() => clearTimeout(timer))
})
const cached = (key, read, ttl, timeoutMessage = 'Timed out loading Worker Control Center data. Please retry.') => {
  const entry = cache.get(key)
  if (entry?.pending) return entry.promise
  if (isFresh(entry, ttl)) return Promise.resolve(entry.value)
  const next = { value: entry?.value, loadedAt: entry?.loadedAt || 0, pending: true, promise: null }
  next.promise = readWithTimeout(read, timeoutMessage).then((value) => {
    next.value = value
    next.loadedAt = Date.now()
    next.pending = false
    return value
  }).catch((error) => {
    next.pending = false
    if (cache.get(key) === next) {
      if (next.value === undefined) cache.delete(key)
      else cache.set(key, { value: next.value, loadedAt: next.loadedAt, pending: false, promise: Promise.resolve(next.value) })
    }
    throw error
  })
  cache.set(key, next)
  return next.promise
}

const ensureScope = (date, authKey = '') => {
  if (cacheAuthKey !== null && cacheAuthKey !== authKey) cache.clear()
  cacheAuthKey = authKey
  if (cacheDate && cacheDate !== date) {
    for (const key of cache.keys()) {
      if (key !== 'workers' && key !== 'search-mappings' && !key.startsWith('mappings:') && !key.startsWith('attendance:worker-history:')) cache.delete(key)
    }
  }
  cacheDate = date
}

export const clearWorkerControlDataCache = () => { cache.clear(); cacheDate = null; cacheAuthKey = null }
export const invalidateWorkerControlAttendanceCache = () => {
  for (const key of cache.keys()) if (key.startsWith('attendance:')) cache.delete(key)
}

export const loadWorkerControlSearchMappings = (authKey = '') => {
  ensureScope(cacheDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' }), authKey)
  return cached('search-mappings', getWorkerBiometricSearchIndexRequest, WORKER_CONTROL_CACHE_TTL.mappings,
    'Timed out loading biometric search IDs. Please retry.')
}

export const loadWorkerControlHistoryRows = ({ workerId, dateFrom, dateTo, authKey = '' }) => {
  if (!workerId || !dateFrom || !dateTo) return Promise.reject(new Error('Worker and date range are required.'))
  ensureScope(cacheDate || dateTo, authKey)
  return cached(`attendance:worker-history:${workerId}:${dateFrom}:${dateTo}`,
    (signal) => getAttendanceRowsRequest({ worker_id: workerId, date_from: dateFrom, date_to: dateTo, paginate: true, signal }),
    WORKER_CONTROL_CACHE_TTL.attendance, 'Timed out loading worker attendance history. Please retry.')
}

export const workerControlAttendanceParams = (date, category, workerId) => {
  if (category === 'worker-detail') return { worker_id: workerId, date_from: workerControlPeriods(date).monthStart, date_to: date, paginate: true }
  if (category === 'weekly') return { date_from: workerControlPeriods(date).weekStart, date_to: date, paginate: true }
  if (category === 'consecutive-absence') return { date_to: date, paginate: true }
  return { date_from: workerControlPeriods(date).monthStart, date_to: date, paginate: true }
}

const attendanceFor = async (date, category, workerId, authKey) => {
  // These two lists come from their dedicated current-day RPCs; they do not
  // display attendance-derived counts.
  if (category === null || category === 'inactive-punched' || category === 'activated-today') return { data: [] }
  const params = workerControlAttendanceParams(date, category, workerId)
  if (category === 'worker-detail') {
    const [month, boundary] = await Promise.all([
      loadWorkerControlHistoryRows({ workerId, dateFrom: params.date_from, dateTo: date, authKey }),
      cached(`attendance:streak-boundary:${workerId}:${params.date_from}`,
        (signal) => getWorkerLastNonAbsentBeforeRequest({ workerId, dateBefore: params.date_from, signal }), WORKER_CONTROL_CACHE_TTL.attendance),
    ])
    return { data: [...(month.data || []), ...(boundary.data ? [boundary.data] : [])] }
  }
  const historyKey = `attendance:${date}:history`
  const key = category === 'consecutive-absence' ? historyKey
    : `attendance:${date}:${params.date_from || 'history'}:${workerId || 'all'}`
  const target = cache.get(key)
  if (target?.pending || isFresh(target, WORKER_CONTROL_CACHE_TTL.attendance)) {
    return cached(key, (signal) => getAttendanceRowsRequest({ ...params, signal }), WORKER_CONTROL_CACHE_TTL.attendance)
  }
  const history = cache.get(historyKey)
  if (key !== historyKey && (history?.pending || isFresh(history, WORKER_CONTROL_CACHE_TTL.attendance))) {
    const response = history.pending ? await history.promise : history.value
    const derived = { data: (response.data || []).filter((row) =>
      (!params.date_from || row.attendance_date >= params.date_from)
      && (!workerId || String(row.worker_id) === String(workerId))) }
    cache.set(key, { value: derived, loadedAt: history.loadedAt, pending: false, promise: Promise.resolve(derived) })
    return derived
  }
  return cached(key, (signal) => getAttendanceRowsRequest({ ...params, signal }), WORKER_CONTROL_CACHE_TTL.attendance)
}

const attendanceSnapshot = (date, category, workerId) => {
  if (category === null || category === 'inactive-punched' || category === 'activated-today') return { data: [] }
  const params = workerControlAttendanceParams(date, category, workerId)
  if (category === 'worker-detail') {
    const month = peek(`attendance:worker-history:${workerId}:${params.date_from}:${date}`)
    const boundary = peek(`attendance:streak-boundary:${workerId}:${params.date_from}`)
    return month && boundary ? { data: [...(month.data || []), ...(boundary.data ? [boundary.data] : [])] } : null
  }
  const historyKey = `attendance:${date}:history`
  const key = category === 'consecutive-absence' ? historyKey
    : `attendance:${date}:${params.date_from || 'history'}:${workerId || 'all'}`
  const direct = peek(key)
  if (direct) return direct
  const history = peek(historyKey)
  if (!history) return null
  return { data: (history.data || []).filter((row) =>
    (!params.date_from || row.attendance_date >= params.date_from)
    && (!workerId || String(row.worker_id) === String(workerId))) }
}

// Synchronous snapshot lets a remounted route show usable cached rows before
// its stale datasets are revalidated in the background.
export const getWorkerControlDataSnapshot = ({ date, category, workerId, authKey = '' }) => {
  ensureScope(date, authKey)
  const workers = peek('workers')
  const attendance = attendanceSnapshot(date, category, workerId)
  const events = peek(`inactive-events:${date}`)
  const activated = peek(`activated:${date}`)
  const mappings = peek(`mappings:${workerId}`)
  if (!workers || !attendance) return null
  if (category === 'inactive-punched' && !events) return null
  if (category === 'activated-today' && !activated) return null
  return { workers: workers.data || [], attendance: attendance.data || [], events: events?.data || [], activated: activated?.data || [], mappings: mappings?.data || [] }
}

export const loadWorkerControlData = async ({ date, category, workerId, authKey = '', onRoster, onCore, onOptionalError }) => {
  ensureScope(date, authKey)
  const needsEvents = category === null || category === 'inactive-punched' || category === 'worker-detail'
  const needsActivated = category === null || category === 'activated-today' || category === 'worker-detail'
  const eventRead = needsEvents ? cached(`inactive-events:${date}`, () => getInactiveWorkerBiometricActivityRequest({ attendanceDate: date }), WORKER_CONTROL_CACHE_TTL.activity,
    'Timed out loading inactive-worker biometric activity. Please retry.') : Promise.resolve({ data: [] })
  const activationRead = needsActivated ? cached(`activated:${date}`, getWorkersActivatedTodayRequest, WORKER_CONTROL_CACHE_TTL.activity,
    'Timed out loading worker activation activity. Please retry.') : Promise.resolve({ data: [] })
  const mappingRead = category === 'worker-detail' ? cached(`mappings:${workerId}`, () => getBiometricMappingsRequest({ workerId }), WORKER_CONTROL_CACHE_TTL.mappings,
    'Timed out loading worker biometric mappings. Please retry.') : Promise.resolve({ data: [] })
  // Attach handlers immediately: optional reads may reject before core reads finish.
  const optional = Promise.allSettled([eventRead, activationRead, mappingRead])
  const rosterRead = cached('workers', () => getWorkersRequest({ includePayrollProfiles: false }), WORKER_CONTROL_CACHE_TTL.roster)
  if (category === 'worker-detail') rosterRead.then((response) => onRoster?.(response.data || []), () => {})
  const [workers, attendance, requiredEvents, requiredActivated] = await Promise.all([
    rosterRead,
    attendanceFor(date, category, workerId, authKey),
    category === 'inactive-punched' ? eventRead : Promise.resolve(null),
    category === 'activated-today' ? activationRead : Promise.resolve(null),
  ])
  const core = {
    workers: workers.data || [], attendance: attendance.data || [],
    events: requiredEvents?.data || peek(`inactive-events:${date}`)?.data || [],
    activated: requiredActivated?.data || peek(`activated:${date}`)?.data || [],
    mappings: peek(`mappings:${workerId}`)?.data || [],
  }
  onCore?.(core)
  const results = await optional
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length) onOptionalError?.(failures[0].reason)
  return {
    ...core,
    events: results[0].status === 'fulfilled' ? results[0].value.data || [] : core.events,
    activated: results[1].status === 'fulfilled' ? results[1].value.data || [] : core.activated,
    mappings: results[2].status === 'fulfilled' ? results[2].value.data || [] : core.mappings,
  }
}
