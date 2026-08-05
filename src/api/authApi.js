import { supabase } from '../lib/supabase'

export const loginRequest = async ({ email, password }) => {
	const { data, error } = await supabase.auth.signInWithPassword({
		email,
		password,
	})

	if (error) {
		throw error
	}

	return { data }
}

export const getCurrentAdminRequest = async (userId) => {
	if (!userId) {
		return { data: null }
	}

	const { data, error } = await supabase
		.from('admins')
		.select('id,full_name,is_active,created_at')
		.eq('id', userId)
		.maybeSingle()

	if (error) {
		throw error
	}

	return { data }
}

export const logoutRequest = async () => {
	const { error } = await supabase.auth.signOut()

	if (error) {
		throw error
	}

	return { data: null }
}

export const getCurrentUserRequest = async () => {
	const {
		data: { session },
		error,
	} = await supabase.auth.getSession()

	if (error) {
		throw error
	}

	if (!session?.user) {
		return { data: null }
	}

	return { data: session }
}
