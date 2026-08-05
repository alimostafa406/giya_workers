import { getSupabaseClient } from '../lib/supabase'

const toArray = (value) => (Array.isArray(value) ? value : [])

const buildWorkerPayload = (payload) => {
	const workerPayload = {
		full_name: payload.full_name,
		employee_code: payload.employee_code,
		phone: payload.phone,
		team_id: payload.team_id || null,
		is_active: Boolean(payload.is_active),
	}

	return workerPayload
}

const readWorkers = async (client) => {
	const { data, error } = await client
		.from('workers')
		.select('id,team_id,full_name,employee_code,phone,is_active,created_at,updated_at')
		.order('created_at', { ascending: false })

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

export const getWorkersRequest = async () => {
	const client = getSupabaseClient()
	const [workers, teams] = await Promise.all([readWorkers(client), readTeams(client)])

	const teamsById = new Map(teams.map((team) => [String(team.id), team]))

	const data = workers.map((worker) => {
		const team = teamsById.get(String(worker.team_id)) || null

		return {
			...worker,
			team,
			team_name: team?.name || '-',
		}
	})

	return { data }
}

export const createWorkerRequest = async (payload) => {
	const client = getSupabaseClient()
	const insertPayload = buildWorkerPayload(payload)

	const { data, error } = await client
		.from('workers')
		.insert(insertPayload)
		.select('id,team_id,full_name,employee_code,phone,is_active,created_at,updated_at')
		.single()

	if (error) {
		throw error
	}

	return { data }
}

export const updateWorkerRequest = async (id, payload) => {
	const client = getSupabaseClient()
	const updatePayload = buildWorkerPayload(payload)

	const { data, error } = await client
		.from('workers')
		.update(updatePayload)
		.eq('id', id)
		.select('id,team_id,full_name,employee_code,phone,is_active,created_at,updated_at')
		.single()

	if (error) {
		throw error
	}

	return { data }
}
