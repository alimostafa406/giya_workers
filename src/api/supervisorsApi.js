import { getSupabaseClient } from '../lib/supabase'

const toArray = (value) => (Array.isArray(value) ? value : [])

const CREATE_SUPERVISOR_RPC =
	import.meta.env.VITE_SUPABASE_RPC_CREATE_SUPERVISOR || 'admin_create_supervisor'
const UPDATE_SUPERVISOR_RPC =
	import.meta.env.VITE_SUPABASE_RPC_UPDATE_SUPERVISOR || 'admin_update_supervisor'

const readTeams = async (client) => {
	const { data, error } = await client.from('teams').select('id,name,is_active')

	if (error) {
		throw error
	}

	return toArray(data)
}

const readSupervisors = async (client) => {
	const { data, error } = await client
		.from('supervisors')
		.select('id,username,password_hash,full_name,phone,team_id,is_active,created_at')
		.order('created_at', { ascending: false })

	if (error) {
		throw error
	}

	return toArray(data)
}

export const getSupervisorsRequest = async () => {
	const client = getSupabaseClient()
	const [supervisors, teams] = await Promise.all([
		readSupervisors(client),
		readTeams(client),
	])

	const teamsById = new Map(teams.map((team) => [String(team.id), team]))

	const data = supervisors.map((supervisor) => {
		const team = teamsById.get(String(supervisor.team_id)) || null

		return {
			...supervisor,
			team,
			team_name: team?.name || '-',
			display_name: supervisor.full_name,
		}
	})

	return { data }
}

const clearTeamsForSupervisor = async (client, supervisorId) => {
	const { data, error } = await client
		.from('teams')
		.select('id,supervisor_id')
		.eq('supervisor_id', supervisorId)

	if (error) {
		throw error
	}

	if (!Array.isArray(data) || data.length === 0) {
		return
	}

	const { error: updateError } = await client
		.from('teams')
		.update({ supervisor_id: null })
		.eq('supervisor_id', supervisorId)

	if (updateError) {
		throw updateError
	}
}

const buildPayload = async (payload) => {
	return {
		username: payload.username,
		password: payload.password,
		full_name: payload.full_name,
		phone: payload.phone,
		team_id: payload.team_id,
		is_active: payload.is_active,
	}
}

const normalizeOptionalPhone = (phone) => {
	const normalized = String(phone || '').trim()

	if (!normalized) {
		return null
	}

	if (!normalized.startsWith('+243')) {
		throw new Error('رقم الهاتف يجب أن يبدأ بـ +243')
	}

	return normalized
}

const updateSupervisorPhone = async (client, supervisorId, phone) => {
	const { error } = await client
		.from('supervisors')
		.update({ phone })
		.eq('id', String(supervisorId))

	if (error) {
		throw error
	}
}

const ensureTeamIsAvailable = async (client, teamId, supervisorId = null) => {
	if (!teamId) {
		throw new Error('يجب اختيار المجموعة')
	}

	const { data, error } = await client
		.from('teams')
		.select('id,supervisor_id')
		.eq('id', teamId)
		.single()

	if (error) {
		throw error
	}

	if (!data) {
		throw new Error('Selected team is not valid')
	}

	if (data.supervisor_id && String(data.supervisor_id) !== String(supervisorId || '')) {
		throw new Error('هذه المجموعة لديها مشرف بالفعل')
	}
}

const normalizeRpcRow = (data) => {
	if (Array.isArray(data)) {
		return data[0] || null
	}

	return data || null
}

export const createSupervisorRequest = async (payload) => {
	const client = getSupabaseClient()
	const insertPayload = await buildPayload(payload)
	const normalizedPhone = normalizeOptionalPhone(insertPayload.phone)

	if (!insertPayload.team_id) {
		throw new Error('يجب اختيار المجموعة')
	}

	await ensureTeamIsAvailable(client, insertPayload.team_id)

	const { data, error } = await client.rpc(CREATE_SUPERVISOR_RPC, {
		p_username: insertPayload.username,
		p_password: insertPayload.password,
		p_full_name: insertPayload.full_name,
		p_team_id: insertPayload.team_id,
		p_is_active: Boolean(insertPayload.is_active),
	})

	if (error) {
		throw error
	}

	const row = normalizeRpcRow(data)

	if (!row) {
		throw new Error('لم يتم استلام بيانات المشرف بعد الإنشاء')
	}

	await updateSupervisorPhone(client, row.id, normalizedPhone)

	const responseData = {
		...row,
		phone: normalizedPhone,
	}

	return { data: responseData }
	}

	export const updateSupervisorRequest = async (id, payload) => {
	const client = getSupabaseClient()
	const updatePayload = await buildPayload(payload)
	const normalizedPhone = normalizeOptionalPhone(updatePayload.phone)

	if (!updatePayload.team_id) {
		throw new Error('يجب اختيار المجموعة')
	}

	const { data: currentSupervisor, error: currentSupervisorError } = await client
		.from('supervisors')
		.select('id,team_id')
		.eq('id', String(id))
		.single()

	if (currentSupervisorError) {
		throw currentSupervisorError
	}

	if (!currentSupervisor) {
		throw new Error('Selected supervisor is not valid')
	}

	if (String(currentSupervisor.team_id || '') !== String(updatePayload.team_id || '')) {
		await ensureTeamIsAvailable(client, updatePayload.team_id, id)
	}

	const { data, error } = await client.rpc(UPDATE_SUPERVISOR_RPC, {
		p_id: String(id),
		p_username: updatePayload.username,
		p_full_name: updatePayload.full_name,
		p_team_id: updatePayload.team_id,
		p_is_active: Boolean(updatePayload.is_active),
		p_password: updatePayload.password || null,
	})

	if (error) {
		throw error
	}

	const row = normalizeRpcRow(data)

	if (!row) {
		throw new Error('لم يتم استلام بيانات المشرف بعد التحديث')
	}

	await updateSupervisorPhone(client, id, normalizedPhone)

	const responseData = {
		...row,
		phone: normalizedPhone,
	}

	return { data: responseData }
}

export const deleteSupervisorRequest = async (id) => {
	const client = getSupabaseClient()

	await clearTeamsForSupervisor(client, id)

	const { data, error } = await client
		.from('supervisors')
		.delete()
		.eq('id', id)
		.select('id,username,full_name,team_id,is_active')
		.single()

	if (error) {
		throw error
	}

	return { data }
}
