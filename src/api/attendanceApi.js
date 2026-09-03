import { getSupabaseClient } from '../lib/supabase'

const toArray = (value) => (Array.isArray(value) ? value : [])

const attendanceFields = 'id,worker_id,attendance_date,status,check_in,check_out,note,recorded_by,created_at,updated_at'

const isMissingManualSyncColumnError = (error) => (
  error?.code === '42703'
  || error?.code === 'PGRST204'
  || /manual_override|attendance_source|biometric_sync_metadata/i.test(String(error?.message || ''))
)

export const getCheckoutOnlyInfo = (row) => {
  if (row?.status !== 'absent') return null
  const metadata = typeof row.biometric_sync_metadata === 'string'
    ? (() => { try { return JSON.parse(row.biometric_sync_metadata) } catch { return null } })()
    : row?.biometric_sync_metadata
  if (!metadata?.checkout_only) return null
  return {
    eveningPunchTime: metadata.evening_punch_time || null,
    eveningEventTimestamp: metadata.evening_event_timestamp || null,
  }
}

const defaultWorkdayTimes = (attendanceDate) => {
  const day = new Date(`${attendanceDate}T12:00:00+01:00`).getDay()
  return {
    checkIn: '08:00:00',
    checkOut: day === 6 ? '14:30:00' : '17:00:00',
  }
}

const normalizeAttendanceTime = (timeValue) => {
  const match = String(timeValue || '').match(/(?:T)?(\d{2}:\d{2})(?::(\d{2}))?/)
  if (!match) return null
  return `${match[1]}:${match[2] || '00'}`
}

export const getAttendanceTimeInputValue = (value) => {
  const normalized = normalizeAttendanceTime(value)
  return normalized ? normalized.slice(0, 5) : ''
}

export const buildManualAttendancePayload = (row, values) => {
  const status = values.status
  const attendanceDate = row.attendance_date || row.date
  const defaults = defaultWorkdayTimes(attendanceDate)
  const existingCheckIn = getAttendanceTimeInputValue(row.check_in)
  const existingCheckOut = getAttendanceTimeInputValue(row.check_out)
  const manualFields = { manual_override: true, attendance_source: 'manual' }

  if (status === 'absent') {
    return { status, check_in: null, check_out: null, ...manualFields }
  }

  if (status === 'pending') {
    return { status, check_in: null, check_out: null, ...manualFields }
  }

  if ((status === 'half_day' || status === 'late') && !values.check_in && !existingCheckIn) {
    throw new Error('وقت الدخول مطلوب عند اختيار نصف يوم.')
  }
  const checkIn = values.check_in || existingCheckIn || defaults.checkIn
  if (!checkIn) throw new Error('وقت الدخول مطلوب لهذه الحالة.')

  if (status === 'half_day' || status === 'in_progress') {
    return {
      status,
      check_in: normalizeAttendanceTime(checkIn),
      check_out: null,
      ...manualFields,
    }
  }

  if (status === 'late') {
    return {
      status,
      check_in: normalizeAttendanceTime(checkIn),
      check_out: normalizeAttendanceTime(values.check_out || existingCheckOut),
      ...manualFields,
    }
  }

  if (status === 'present') {
    const checkOut = values.check_out || existingCheckOut || defaults.checkOut
    return {
      status,
      check_in: normalizeAttendanceTime(checkIn),
      check_out: normalizeAttendanceTime(checkOut),
      ...manualFields,
    }
  }

  throw new Error('حالة الحضور المختارة غير مدعومة.')
}

const readAttendance = async (client, params = {}) => {
  let query = client
    .from('attendance')
    .select(`${attendanceFields},biometric_sync_metadata,manual_override,attendance_source`)
    .order('attendance_date', { ascending: false })
  if (params.date) query = query.eq('attendance_date', params.date)
  if (params.date_from) query = query.gte('attendance_date', params.date_from)
  if (params.date_to) query = query.lte('attendance_date', params.date_to)
  if (params.worker_id) query = query.eq('worker_id', params.worker_id)
  const { data, error } = await query

  if (error && isMissingManualSyncColumnError(error)) {
    let fallbackQuery = client
      .from('attendance')
      .select(attendanceFields)
      .order('attendance_date', { ascending: false })
    if (params.date) fallbackQuery = fallbackQuery.eq('attendance_date', params.date)
    if (params.date_from) fallbackQuery = fallbackQuery.gte('attendance_date', params.date_from)
    if (params.date_to) fallbackQuery = fallbackQuery.lte('attendance_date', params.date_to)
    if (params.worker_id) fallbackQuery = fallbackQuery.eq('worker_id', params.worker_id)
    const fallback = await fallbackQuery
    if (fallback.error) throw fallback.error
    return toArray(fallback.data)
  }

  if (error) throw error

  return toArray(data)
}

const readWorkers = async (client) => {
  const { data, error } = await client
    .from('workers')
    .select('id,team_id,full_name,employee_code,phone,is_active,created_at,updated_at')

  if (error) {
    throw error
  }

  return toArray(data)
}

const readTeams = async (client) => {
  const { data, error } = await client.from('teams').select('id,name,is_active')

  if (error) {
    throw error
  }

  return toArray(data)
}

const readWorkerClassifications = async (client) => {
  const { data, error } = await client
    .from('worker_staff_classification')
    .select('worker_id,classification')

  if (error) throw error
  return toArray(data)
}

const readConfirmedBiometricMappings = async (client) => {
  const { data, error } = await client
    .from('biometric_worker_mapping')
    .select('worker_id,device_employee_no,is_active,mapping_review_state')
    .eq('is_active', true)
    .eq('mapping_review_state', 'confirmed')

  if (error) throw error
  return toArray(data)
}

export const getAttendanceRequest = async (params = {}) => {
  const client = getSupabaseClient()
  const [attendance, workers, teams, classifications, confirmedMappings] = await Promise.all([
    readAttendance(client, params),
    readWorkers(client),
    readTeams(client),
    readWorkerClassifications(client),
    readConfirmedBiometricMappings(client),
  ])

  const classificationsByWorkerId = new Map(
    classifications.filter((item) => item?.worker_id).map((item) => [String(item.worker_id), item.classification]),
  )
  const confirmedMappingByWorkerId = new Map(
    confirmedMappings.filter((mapping) => mapping?.worker_id && mapping?.device_employee_no).map((mapping) => [String(mapping.worker_id), mapping]),
  )
  const workersById = new Map(workers.map((worker) => [String(worker.id), {
    ...worker,
    staff_classification: classificationsByWorkerId.get(String(worker.id)) || 'normal',
  }]))
  const teamsById = new Map(teams.map((team) => [String(team.id), team]))

  const filtered = attendance.filter((row) => {
    const worker = workersById.get(String(row.worker_id)) || null
    const matchesDate = !params.date || row.attendance_date === params.date
    const matchesDateFrom = !params.date_from || row.attendance_date >= params.date_from
    const matchesDateTo = !params.date_to || row.attendance_date <= params.date_to
    const matchesTeam = !params.team_id || String(worker?.team_id ?? '') === String(params.team_id)
    const matchesWorker = !params.worker_id || String(row.worker_id ?? '') === String(params.worker_id)
    const matchesClassification = !params.staff_classification
      || (worker?.staff_classification || 'normal') === params.staff_classification

    return matchesDate && matchesDateFrom && matchesDateTo && matchesTeam && matchesWorker && matchesClassification
  })

  const data = filtered.map((row) => {
    const worker = workersById.get(String(row.worker_id)) || null
    const team = teamsById.get(String(worker?.team_id ?? '')) || null
    const biometricMapping = confirmedMappingByWorkerId.get(String(row.worker_id)) || null

    return {
      ...row,
      worker,
      team,
      worker_name: worker?.full_name || '-',
      team_name: team?.name || '-',
      biometric_employee_no: biometricMapping?.device_employee_no || null,
      staff_classification: worker?.staff_classification || 'normal',
      date: row.attendance_date,
    }
  })

  return { data }
}

export const getSpecialStaffAttendanceRequest = async (params = {}) => getAttendanceRequest({
  ...params,
  staff_classification: 'special_staff',
})

// Read-only roster view for the standalone foreign/special-staff attendance page.
// Unlike getSpecialStaffAttendanceRequest, this includes every current special-staff
// worker, including people with no attendance row on the selected date.
export const getForeignAttendanceRequest = async (params = {}) => {
  const client = getSupabaseClient()
  const [attendance, workers, teams, classifications] = await Promise.all([
    readAttendance(client, { date: params.date }),
    readWorkers(client),
    readTeams(client),
    readWorkerClassifications(client),
  ])

  const classificationsByWorkerId = new Map(
    classifications
      .filter((item) => item?.worker_id)
      .map((item) => [String(item.worker_id), item.classification]),
  )
  const teamsById = new Map(teams.map((team) => [String(team.id), team]))
  const attendanceByWorkerId = new Map(
    attendance
      .filter((row) => row.attendance_date === params.date)
      .map((row) => [String(row.worker_id), row]),
  )

  const data = workers
    .filter((worker) => (
      worker.is_active !== false
      && classificationsByWorkerId.get(String(worker.id)) === 'special_staff'
      && (!params.team_id || String(worker.team_id || '') === String(params.team_id))
    ))
    .map((worker) => {
      const attendanceRow = attendanceByWorkerId.get(String(worker.id)) || null
      const team = teamsById.get(String(worker.team_id || '')) || null
      return {
        worker_id: worker.id,
        worker_name: worker.full_name || '-',
        employee_code: worker.employee_code || null,
        team_id: worker.team_id || null,
        team_name: team?.name || '-',
        attendance_date: params.date || null,
        status: attendanceRow?.status || null,
        check_in: attendanceRow?.check_in || null,
        check_out: attendanceRow?.check_out || null,
      }
    })
    .sort((left, right) => String(left.worker_name).localeCompare(String(right.worker_name)))

  return { data, teams: teams.filter((team) => team.is_active !== false) }
}

export const updateAttendanceManuallyRequest = async (row, values) => {
  const client = getSupabaseClient()
  const payload = buildManualAttendancePayload(row, values)
  const update = async (nextPayload) => client
    .from('attendance')
    .update(nextPayload)
    .eq('id', row.id)
    .select(attendanceFields)
    .single()

  let { data, error } = await update(payload)
  // Before the reviewed migration is applied, retain legacy edit support for
  // present/absent without requiring source/override columns.
  if (error && isMissingManualSyncColumnError(error)) {
    ({ data, error } = await update({
      status: payload.status,
      check_in: payload.check_in,
      check_out: payload.check_out,
    }))
  }
  if (error) throw error
  return { data }
}

// Uses the same normalized manual-correction payload for an existing row or an
// explicitly requested missing worker/day record.  The worker/date unique key
// prevents a second attendance row from being created for the same day.
export const saveAttendanceManuallyRequest = async ({ row = null, workerId, attendanceDate, values }) => {
  if (row?.id) return updateAttendanceManuallyRequest(row, values)
  if (!workerId || !attendanceDate) throw new Error('Worker and attendance date are required.')

  const client = getSupabaseClient()
  const baseRow = { worker_id: workerId, attendance_date: attendanceDate }
  const payload = buildManualAttendancePayload(baseRow, values)
  const insert = async (nextPayload) => client
    .from('attendance')
    .upsert({ ...baseRow, ...nextPayload }, { onConflict: 'worker_id,attendance_date' })
    .select(attendanceFields)
    .single()

  let { data, error } = await insert(payload)
  if (error && isMissingManualSyncColumnError(error)) {
    ({ data, error } = await insert({
      status: payload.status,
      check_in: payload.check_in,
      check_out: payload.check_out,
    }))
  }
  if (error) throw error
  return { data }
}
