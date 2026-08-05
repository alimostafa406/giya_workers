import { getSupabaseClient } from '../lib/supabase'

const toArray = (value) => (Array.isArray(value) ? value : [])

const readAttendance = async (client) => {
  const { data, error } = await client
    .from('attendance')
    .select('id,worker_id,attendance_date,status,check_in,check_out,note,recorded_by,created_at,updated_at')
    .order('attendance_date', { ascending: false })

  if (error) {
    throw error
  }

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

export const getAttendanceRequest = async (params = {}) => {
  const client = getSupabaseClient()
  const [attendance, workers, teams] = await Promise.all([
    readAttendance(client),
    readWorkers(client),
    readTeams(client),
  ])

  const workersById = new Map(workers.map((worker) => [String(worker.id), worker]))
  const teamsById = new Map(teams.map((team) => [String(team.id), team]))

  const filtered = attendance.filter((row) => {
    const worker = workersById.get(String(row.worker_id)) || null
    const matchesDate = !params.date || row.attendance_date === params.date
    const matchesTeam = !params.team_id || String(worker?.team_id ?? '') === String(params.team_id)
    const matchesWorker = !params.worker_id || String(row.worker_id ?? '') === String(params.worker_id)

    return matchesDate && matchesTeam && matchesWorker
  })

  const data = filtered.map((row) => {
    const worker = workersById.get(String(row.worker_id)) || null
    const team = teamsById.get(String(worker?.team_id ?? '')) || null

    return {
      ...row,
      worker,
      team,
      worker_name: worker?.full_name || '-',
      team_name: team?.name || '-',
      date: row.attendance_date,
    }
  })

  return { data }
}
