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

const isMissingPayrollProfileTableError = (error) => (
	error?.code === '42P01'
	|| error?.code === 'PGRST205'
	|| /worker_payroll_profile/i.test(String(error?.message || ''))
)

const readPayrollProfiles = async (client) => {
	const { data, error } = await client
		.from('worker_payroll_profile')
		.select('worker_id,payment_type,monthly_salary')

	if (error && isMissingPayrollProfileTableError(error)) {
		return []
	}
	if (error) throw error
	return toArray(data)
}

const readWorkerClassifications = async (client) => {
	const { data, error } = await client
		.from('worker_staff_classification')
		.select('worker_id,classification')

	if (error) throw error
	return toArray(data)
}

const payrollProfilePayload = (payload) => {
	if (!payload.payment_type) return null
	return {
		payment_type: payload.payment_type,
		monthly_salary: payload.payment_type === 'monthly' && payload.monthly_salary !== '' && payload.monthly_salary != null
			? Number(payload.monthly_salary)
			: null,
	}
}

export const saveWorkerPayrollProfileRequest = async (workerId, values) => {
	const profile = payrollProfilePayload(values)
	if (!profile) return null
	const client = getSupabaseClient()
	const { data, error } = await client
		.from('worker_payroll_profile')
		.upsert({ worker_id: workerId, ...profile }, { onConflict: 'worker_id' })
		.select('worker_id,payment_type,monthly_salary')
		.single()

	if (error) throw error
	return { data }
}

export const getWorkersRequest = async () => {
	const client = getSupabaseClient()
	const [workers, teams, payrollProfiles, classifications] = await Promise.all([
		readWorkers(client),
		readTeams(client),
		readPayrollProfiles(client),
		readWorkerClassifications(client),
	])

	const teamsById = new Map(teams.map((team) => [String(team.id), team]))
	const payrollByWorkerId = new Map(payrollProfiles.map((profile) => [String(profile.worker_id), profile]))
	const classificationByWorkerId = new Map(classifications.map((item) => [String(item.worker_id), item.classification]))

	const data = workers.map((worker) => {
		const team = teamsById.get(String(worker.team_id)) || null
		const staffClassification = classificationByWorkerId.get(String(worker.id)) || 'normal'
		const payrollProfile = payrollByWorkerId.get(String(worker.id)) || null

		return {
			...worker,
			team,
			team_name: team?.name || '-',
			staff_classification: staffClassification,
			payroll_profile: payrollProfile,
			payment_type: payrollProfile?.payment_type || (staffClassification === 'special_staff' ? 'monthly' : 'weekly'),
			monthly_salary: payrollProfile?.monthly_salary ?? null,
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

	await saveWorkerPayrollProfileRequest(data.id, {
		payment_type: payload.payment_type || 'weekly',
		monthly_salary: payload.monthly_salary,
	})

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

	if (payload.payment_type) {
		await saveWorkerPayrollProfileRequest(id, payload)
	}

	return { data }
}
