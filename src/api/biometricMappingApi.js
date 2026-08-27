import { getHikvisionDeviceUsers, normalizeDeviceEmployeeNo, normalizePersonName } from '../data/hikvisionRawData'
import { getSupabaseClient } from '../lib/supabase'
import { createWorkerRequest, getWorkersRequest, updateWorkerRequest } from './workersApi'
import { getTeamsRequest } from './teamsApi'

const toArray = (value) => (Array.isArray(value) ? value : [])
const mappingFields = 'id,worker_id,device_id,device_employee_no,device_name,device_picture_url,is_active,mapping_review_state,created_at,updated_at'
const deviceIdentityKey = (deviceId, employeeNo) => `${String(deviceId || '').trim()}::${normalizeDeviceEmployeeNo(employeeNo)}`
const currentBusinessDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' })

const isMissingRecentActivityRpc = (error) => (
  error?.code === '42883'
  || error?.code === 'PGRST202'
  || /get_recent_unmapped_biometric_identities/i.test(String(error?.message || ''))
)

export const getRecentUnmappedBiometricIdentitiesRequest = async ({ endDate = currentBusinessDate(), days = 7 } = {}) => {
  const { data, error } = await getSupabaseClient().rpc('get_recent_unmapped_biometric_identities', {
    p_end_date: endDate,
    p_days: days,
  })
  if (error && isMissingRecentActivityRpc(error)) return { data: [], unavailable: true, endDate, days }
  if (error) throw error
  return { data: toArray(data), unavailable: false, endDate, days }
}

export class BiometricMappingConflictError extends Error {
  constructor(conflicts) {
    super('يوجد ربط قائم يجب تأكيد استبداله أولاً.')
    this.name = 'BiometricMappingConflictError'
    this.conflicts = conflicts
  }
}

export const getBiometricMappingsRequest = async () => {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('biometric_worker_mapping')
    .select(mappingFields)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return { data: toArray(data) }
}

const getWorkerClassificationsRequest = async () => {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('worker_staff_classification')
    .select('worker_id,classification')

  if (error) throw error
  return toArray(data)
}

const getIgnoredDeviceIdentitiesRequest = async () => {
  const { data, error } = await getSupabaseClient()
    .from('biometric_device_identity_review')
    .select('device_id,device_employee_no,review_state,note,updated_at')
    .eq('review_state', 'ignored')
  if (error) throw error
  return toArray(data)
}

const getDeviceIdentityPresenceRequest = async () => {
  const { data, error } = await getSupabaseClient()
    .from('biometric_device_identity_presence')
    .select('device_id,device_employee_no,first_seen_at,last_seen_at,is_current')
  if (error) throw error
  return toArray(data)
}

export const setDeviceIdentityIgnoredRequest = async (deviceUser) => {
  const employeeNo = normalizeDeviceEmployeeNo(deviceUser?.employeeNo)
  const deviceId = String(deviceUser?.deviceId || '').trim()
  if (!deviceId || !employeeNo) throw new Error('الجهاز ورقم هوية الجهاز مطلوبان.')
  const { data, error } = await getSupabaseClient()
    .from('biometric_device_identity_review')
    .insert({ device_id: deviceId, device_employee_no: employeeNo, review_state: 'ignored' })
    .select('device_id,device_employee_no,review_state')
    .single()
  if (error) throw error
  return { data }
}

// A null mapping is the normal representation of an unmapped device identity.
// Only persisted, structurally valid mapping records participate in lookup maps.
const isMappingRecord = (mapping) => Boolean(
  mapping
  && typeof mapping === 'object'
  && mapping.worker_id
  && normalizeDeviceEmployeeNo(mapping.device_employee_no),
)

const getActiveMappings = (mappings) => toArray(mappings).filter(
  (mapping) => isMappingRecord(mapping) && mapping.is_active !== false,
)

export const getBiometricMappingWorkspaceRequest = async () => {
  const [workersResponse, mappingsResponse, classifications, ignoredIdentities, teamsResponse] = await Promise.all([
    getWorkersRequest(),
    getBiometricMappingsRequest(),
    getWorkerClassificationsRequest(),
    getIgnoredDeviceIdentitiesRequest(),
    getTeamsRequest(),
  ])
  let presences = []
  let identityPresenceError = null
  try {
    presences = await getDeviceIdentityPresenceRequest()
  } catch (error) {
    identityPresenceError = error
  }

  const workers = toArray(workersResponse.data).filter(Boolean)
  const mappings = toArray(mappingsResponse.data).filter(isMappingRecord)
  const activeMappings = getActiveMappings(mappings)
  const mappingsByDeviceIdentity = new Map()
  const legacyMappingsByEmployeeNo = new Map()
  const mappingsByWorker = new Map()

  activeMappings.forEach((mapping) => {
    const deviceNo = normalizeDeviceEmployeeNo(mapping.device_employee_no)
    const workerId = String(mapping.worker_id)
    if (mapping.device_id) {
      const key = deviceIdentityKey(mapping.device_id, deviceNo)
      mappingsByDeviceIdentity.set(key, [...(mappingsByDeviceIdentity.get(key) || []), mapping])
    } else {
      legacyMappingsByEmployeeNo.set(deviceNo, [...(legacyMappingsByEmployeeNo.get(deviceNo) || []), mapping])
    }
    mappingsByWorker.set(workerId, [...(mappingsByWorker.get(workerId) || []), mapping])
  })

  const classificationsByWorkerId = new Map(
    toArray(classifications)
      .filter((item) => item?.worker_id)
      .map((item) => [String(item.worker_id), item.classification]),
  )
  const enrichedWorkers = workers.map((worker) => ({
    ...worker,
    staffClassification: classificationsByWorkerId.get(String(worker.id)) || 'normal',
  }))
  const workersById = new Map(enrichedWorkers.map((worker) => [String(worker.id), worker]))
  const ignoredByDeviceIdentity = new Set(ignoredIdentities
    .filter((row) => row.device_id)
    .map((row) => deviceIdentityKey(row.device_id, row.device_employee_no)))
  const legacyIgnoredEmployeeNos = new Set(ignoredIdentities
    .filter((row) => !row.device_id)
    .map((row) => normalizeDeviceEmployeeNo(row.device_employee_no)))
  const presenceByDeviceIdentity = new Map()
  presences.filter((presence) => presence.is_current).forEach((presence) => {
    presenceByDeviceIdentity.set(deviceIdentityKey(presence.device_id, presence.device_employee_no), presence)
  })
  const rawDeviceUsers = getHikvisionDeviceUsers()
  const deviceNameCounts = rawDeviceUsers.reduce((counts, user) => {
    const name = normalizePersonName(user.name)
    counts.set(name, (counts.get(name) || 0) + 1)
    return counts
  }, new Map())
  const deviceUsers = rawDeviceUsers.map((deviceUser) => {
    const key = deviceIdentityKey(deviceUser.deviceId, deviceUser.employeeNo)
    const deviceMappings = mappingsByDeviceIdentity.get(key)
      || legacyMappingsByEmployeeNo.get(deviceUser.employeeNo)
      || []
    const linkedWorker = deviceMappings.length === 1
      ? workersById.get(String(deviceMappings[0]?.worker_id || '')) || null
      : null
    const sameNameWorkers = enrichedWorkers.filter((worker) => (
      worker.is_active !== false
      && normalizePersonName(worker.full_name) === normalizePersonName(deviceUser.name)
    ))

    const suggestedWorker = sameNameWorkers[0] || null
    const isUniqueExactMatch = sameNameWorkers.length === 1
      && deviceNameCounts.get(normalizePersonName(deviceUser.name)) === 1
      && suggestedWorker?.staffClassification === 'normal'
      && deviceMappings.length === 0
      && !(mappingsByWorker.get(String(suggestedWorker?.id)) || []).length
    const isAmbiguousMatch = !isUniqueExactMatch && sameNameWorkers.length > 0
    return {
      ...deviceUser,
      firstSeenAt: presenceByDeviceIdentity.get(key)?.first_seen_at || null,
      lastSeenAt: presenceByDeviceIdentity.get(key)?.last_seen_at || null,
      ignored: ignoredByDeviceIdentity.has(key) || legacyIgnoredEmployeeNos.has(deviceUser.employeeNo),
      mapping: deviceMappings[0] || null,
      mappingCount: deviceMappings.length,
      linkedWorker,
      suggestion: isUniqueExactMatch ? sameNameWorkers[0] : null,
      duplicateGroupKey: sameNameWorkers.length > 1 && deviceNameCounts.get(normalizePersonName(deviceUser.name)) > 1 ? normalizePersonName(deviceUser.name) : null,
      sameNameWorkers,
      sourceMatchCategory: (ignoredByDeviceIdentity.has(key) || legacyIgnoredEmployeeNos.has(deviceUser.employeeNo)) ? 'ignored' : isUniqueExactMatch ? 'unique_exact' : isAmbiguousMatch ? 'ambiguous' : 'device_only',
      matchCategory: deviceMappings.length ? 'mapped' : isUniqueExactMatch ? 'unique_exact' : isAmbiguousMatch ? 'ambiguous' : 'device_only',
      isAmbiguousName: isAmbiguousMatch,
      isConflict: deviceMappings.length > 1 || (deviceMappings.length === 1 && !linkedWorker),
    }
  })

  const workerMappings = new Map(
    enrichedWorkers.map((worker) => [String(worker.id), mappingsByWorker.get(String(worker.id)) || []]),
  )
  const supabaseOnlyWorkers = enrichedWorkers.filter((worker) => (
    worker.is_active !== false && (workerMappings.get(String(worker.id)) || []).length === 0
  ))

  return {
    data: {
      workers: enrichedWorkers,
      mappings,
      deviceUsers,
      workerMappings,
      supabaseOnlyWorkers,
      teams: toArray(teamsResponse.data).filter((team) => team?.is_active !== false),
      ignoredIdentities,
      identityPresenceError,
    },
  }
}

export const createWorkerAndConfirmBiometricMappingRequest = async ({ deviceUser, fullName, employeeCode, teamId }) => {
  const employeeNo = normalizeDeviceEmployeeNo(deviceUser?.employeeNo)
  const deviceId = String(deviceUser?.deviceId || '').trim()
  const name = String(fullName || '').trim()
  const code = String(employeeCode || '').trim()
  if (!deviceId || !employeeNo || !name || !code || !teamId) {
    throw new Error('Device identity, worker name, employee code, and team are required.')
  }
  const { data, error } = await getSupabaseClient().rpc('create_worker_and_confirm_biometric_mapping', {
    p_full_name: name,
    p_employee_code: code,
    p_team_id: teamId,
    p_device_employee_no: employeeNo,
    p_device_id: deviceId,
    p_device_name: String(deviceUser?.name || '').trim() || null,
    p_device_picture_url: deviceUser?.attendancePhotoUrl || null,
  })
  if (error) throw error
  return { data: Array.isArray(data) ? data[0] : data }
}

export const saveBiometricMappingRequest = async ({ deviceUser, workerId, replaceExisting = false, reviewState = 'needs_review' }) => {
  const client = getSupabaseClient()
  const employeeNo = normalizeDeviceEmployeeNo(deviceUser?.employeeNo)
  const deviceId = String(deviceUser?.deviceId || '').trim()

  if (!deviceId || !employeeNo || !workerId) {
    throw new Error('يجب اختيار مستخدم الجهاز والعامل قبل الحفظ.')
  }

  const { data: deviceRecords, error: deviceError } = await client
    .from('biometric_worker_mapping')
    .select(mappingFields)
    .eq('device_employee_no', employeeNo)
    .eq('is_active', true)

  if (deviceError) {
    throw deviceError
  }
  const existingDeviceRecord = toArray(deviceRecords).filter(isMappingRecord).find((mapping) => (
    !mapping.device_id || String(mapping.device_id) === deviceId
  )) || null
  const deviceWouldBeReplaced = Boolean(existingDeviceRecord)
    && existingDeviceRecord.is_active !== false
    && String(existingDeviceRecord.worker_id) !== String(workerId)

  if (!replaceExisting && deviceWouldBeReplaced) {
    throw new BiometricMappingConflictError({
      deviceRecord: deviceWouldBeReplaced ? existingDeviceRecord : null,
      workerRecord: null,
    })
  }

  const payload = {
    worker_id: workerId,
    device_id: deviceId,
    device_employee_no: employeeNo,
    device_name: String(deviceUser.name || '').trim() || null,
    device_picture_url: deviceUser.attendancePhotoUrl || null,
    is_active: true,
    mapping_review_state: reviewState,
  }

  const request = existingDeviceRecord
    ? client.from('biometric_worker_mapping').update(payload).eq('id', existingDeviceRecord.id)
    : client.from('biometric_worker_mapping').insert(payload)
  const { data, error } = await request.select(mappingFields).single()

  if (error) {
    throw error
  }

  return { data }
}

export const setBiometricMappingReviewStateRequest = async (mappingId, mappingReviewState) => {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('biometric_worker_mapping')
    .update({ mapping_review_state: mappingReviewState })
    .eq('id', mappingId)
    .select(mappingFields)
    .single()
  if (error) throw error
  return { data }
}

export const createSafeMappingCandidatesRequest = async (deviceUsers) => {
  const candidates = deviceUsers.filter((user) => user.suggestion && !user.mapping)
  const results = []
  for (const user of candidates) {
    const result = await saveBiometricMappingRequest({
      deviceUser: user,
      workerId: user.suggestion.id,
      reviewState: 'confirmed',
    })
    results.push(result.data)
  }
  return { data: results }
}

export const updateWorkerTeamFromBiometricRequest = async (worker, teamId) => updateWorkerRequest(worker.id, {
  full_name: worker.full_name,
  employee_code: worker.employee_code,
  phone: worker.phone,
  team_id: teamId,
  is_active: worker.is_active,
})

export const setWorkerStaffClassificationRequest = async (workerId, classification) => {
  const client = getSupabaseClient()
  const payload = { worker_id: workerId, classification }
  const { data, error } = await client
    .from('worker_staff_classification')
    .upsert(payload, { onConflict: 'worker_id' })
    .select('worker_id,classification')
    .single()
  if (error) throw error
  return { data }
}

const getSpecialStaffEmployeeCode = (employeeNo, workers) => {
  const suffix = normalizeDeviceEmployeeNo(employeeNo).replace(/[^a-zA-Z0-9]/g, '') || 'DEVICE'
  const base = `HIK-${suffix}`
  const existingCodes = new Set(toArray(workers).map((worker) => String(worker.employee_code || '').trim().toLocaleLowerCase()))
  let candidate = base
  let sequence = 2
  while (existingCodes.has(candidate.toLocaleLowerCase())) {
    candidate = `${base}-${sequence}`
    sequence += 1
  }
  return candidate
}

// Explicit device-only action. Preflights the required additive tables before a worker is created.
export const createSpecialStaffFromDeviceOnlyRequest = async (deviceUser) => {
  const employeeNo = normalizeDeviceEmployeeNo(deviceUser?.employeeNo)
  const fullName = String(deviceUser?.name || '').trim()
  if (!employeeNo || !fullName) throw new Error('تعذر قراءة رقم الجهاز أو اسم مستخدم البصمة.')

  const [workersResponse, mappingsResponse] = await Promise.all([
    getWorkersRequest(),
    getBiometricMappingsRequest(),
    getWorkerClassificationsRequest(),
  ])
  const workers = toArray(workersResponse.data)
  const normalizedName = normalizePersonName(fullName)
  if (workers.some((worker) => normalizePersonName(worker.full_name) === normalizedName)) {
    throw new Error('يوجد عامل بنفس الاسم بالفعل. استخدم «ربط بعامل موجود» لتجنب إنشاء سجل مكرر.')
  }
  if (toArray(mappingsResponse.data).some((mapping) => (
    isMappingRecord(mapping)
    && mapping.is_active !== false
    && normalizeDeviceEmployeeNo(mapping.device_employee_no) === employeeNo
  ))) {
    throw new Error('هذه الهوية مرتبطة بالفعل. راجع الربط الحالي بدل إنشاء موظف جديد.')
  }

  const { data: worker } = await createWorkerRequest({
    full_name: fullName,
    employee_code: getSpecialStaffEmployeeCode(employeeNo, workers),
    phone: null,
    team_id: null,
    is_active: true,
    payment_type: 'monthly',
    monthly_salary: null,
  })

  try {
    await setWorkerStaffClassificationRequest(worker.id, 'special_staff')
    await saveBiometricMappingRequest({
      deviceUser,
      workerId: worker.id,
      reviewState: 'confirmed',
    })
  } catch (error) {
    throw new Error(`تم إنشاء الموظف، لكن تعذر إكمال التصنيف أو الربط: ${error.message || 'خطأ غير معروف'}`)
  }

  return { data: worker }
}

export const unlinkBiometricMappingRequest = async (mappingId) => {
  if (!mappingId) {
    throw new Error('تعذر العثور على الربط المطلوب.')
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('biometric_worker_mapping')
    .update({ is_active: false })
    .eq('id', mappingId)
    .select(mappingFields)
    .single()

  if (error) {
    throw error
  }

  if (!data?.worker_id) {
    return { data: null, reason: 'unmapped' }
  }

  const { data: worker, error: workerLookupError } = await client
    .from('workers')
    .select('id,is_active')
    .eq('id', data.worker_id)
    .maybeSingle()

  if (workerLookupError) {
    throw workerLookupError
  }

  if (!worker) {
    return { data: null, reason: 'ignored_missing_worker' }
  }

  if (worker.is_active === false) {
    return { data: null, reason: 'ignored_inactive_worker' }
  }

  return { data, reason: null }
}

// Attendance sync will use this lookup exclusively; device names are never part of identity resolution.
export const getMappedWorkerByDeviceEmployeeNoRequest = async (deviceEmployeeNo, deviceId) => {
  const employeeNo = normalizeDeviceEmployeeNo(deviceEmployeeNo)
  const normalizedDeviceId = String(deviceId || '').trim()
  if (!normalizedDeviceId || !employeeNo) return { data: null }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('biometric_worker_mapping')
    .select('worker_id,device_id,device_employee_no')
    .eq('device_employee_no', employeeNo)
    .eq('is_active', true)
    .eq('mapping_review_state', 'confirmed')

  if (error) {
    throw error
  }

  return { data: toArray(data).find((mapping) => mapping.device_id === normalizedDeviceId)
    || toArray(data).find((mapping) => !mapping.device_id)
    || null }
}
