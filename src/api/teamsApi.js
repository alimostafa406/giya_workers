import { getSupabaseClient } from '../lib/supabase'

const toArray = (value) => (Array.isArray(value) ? value : [])

const readTeams = async (client) => {
	const { data, error } = await client
		.from('teams')
		.select('id,name,supervisor_id,is_active,created_at,updated_at')
		.order('created_at', { ascending: false })

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

const readSupervisors = async (client) => {
	const { data, error } = await client
		.from('supervisors')
		.select('id,username,password_hash,full_name,phone,team_id,is_active,created_at')

	if (error) {
		throw error
	}

	return toArray(data)
}

const buildPayload = (payload) => {
	const teamPayload = {
		name: String(payload.name || '').trim(),
		supervisor_id: String(payload.supervisor_id || '').trim() || null,
		is_active: Boolean(payload.is_active),
	}

	return teamPayload
}

const ensureSupervisorIsAvailable = async (client, supervisorId, teamId = null) => {
	if (!supervisorId) {
		return
	}

	const { data, error } = await client
		.from('supervisors')
		.select('id,team_id')
		.eq('id', supervisorId)
		.single()

	if (error) {
		throw error
	}

	if (!data) {
		throw new Error('Selected supervisor is not valid')
	}

	const assignedTeamId = String(data.team_id || '')
	const currentTeamId = String(teamId || '')

	if (assignedTeamId && assignedTeamId !== currentTeamId) {
		throw new Error('هذا المشرف مرتبط بمجموعة أخرى')
	}
}

export const getTeamsRequest = async () => {
	const client = getSupabaseClient()
	const [teams, workers, supervisors] = await Promise.all([
		readTeams(client),
		readWorkers(client),
		readSupervisors(client),
	])

	const supervisorsById = new Map(
		supervisors.map((supervisor) => [String(supervisor.id), supervisor]),
	)

	const data = teams.map((team) => {
		const teamWorkers = workers.filter(
			(worker) => String(worker.team_id ?? '') === String(team.id),
		)
		const supervisor = supervisorsById.get(String(team.supervisor_id ?? '')) || null

		return {
			...team,
			workers: teamWorkers,
			workers_count: teamWorkers.length,
			supervisor,
			supervisor_name: supervisor?.full_name || supervisor?.username || '-',
		}
	})

	return { data }
}

export const createTeamRequest = async (payload) => {
	const client = getSupabaseClient()
	const insertPayload = buildPayload(payload)

	await ensureSupervisorIsAvailable(client, insertPayload.supervisor_id)

	const { data, error } = await client
		.from('teams')
		.insert(insertPayload)
		.select('id,name,supervisor_id,is_active,created_at,updated_at')
		.single()

	if (error) {
		throw error
	}

	return { data }
}

export const updateTeamRequest = async (id, payload) => {
	const client = getSupabaseClient()
	const updatePayload = buildPayload(payload)

	await ensureSupervisorIsAvailable(client, updatePayload.supervisor_id, id)

	const { data, error } = await client
		.from('teams')
		.update(updatePayload)
		.eq('id', id)
		.select('id,name,supervisor_id,is_active,created_at,updated_at')
		.single()

	if (error) {
		throw error
	}

	return { data }
}
