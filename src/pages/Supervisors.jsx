import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import {
	createSupervisorRequest,
	deleteSupervisorRequest,
	getSupervisorsRequest,
	updateSupervisorRequest,
} from '../api/supervisorsApi'
import Modal from '../components/Modal/Modal'
import SupervisorForm from '../components/Forms/SupervisorForm'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'

const asArray = (value) => {
	if (Array.isArray(value)) {
		return value
	}
	if (Array.isArray(value?.data)) {
		return value.data
	}
	return []
}

const getSupervisorIsActive = (supervisor) => {
	return Boolean(supervisor?.is_active)
}

function Supervisors() {
	const { t } = useTranslation()
	const [supervisors, setSupervisors] = useState([])
	const [teams, setTeams] = useState([])
	const [searchQuery, setSearchQuery] = useState('')
	const [loading, setLoading] = useState(false)
	const [isSaving, setIsSaving] = useState(false)
	const [error, setError] = useState('')
	const [success, setSuccess] = useState('')
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [selectedSupervisor, setSelectedSupervisor] = useState(null)

	const loadData = async () => {
		setLoading(true)
		setError('')
		setSuccess('')
		try {
			const [supervisorsRes, teamsRes] = await Promise.all([
				getSupervisorsRequest(),
				getTeamsRequest(),
			])

			setSupervisors(asArray(supervisorsRes.data))
			setTeams(asArray(teamsRes.data))
		} catch (err) {
			setError(getErrorMessage(err))
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		loadData()
	}, [])

	const filteredSupervisors = useMemo(() => {
		const searchValue = String(searchQuery || '').trim().toLowerCase()

		if (!searchValue) {
			return supervisors
		}

		return supervisors.filter((supervisor) => {
			const username = String(supervisor.username || '').toLowerCase()
			const fullName = String(supervisor.full_name || '').toLowerCase()
			const teamName = String(supervisor.team_name || supervisor.team?.name || '').toLowerCase()

			return username.includes(searchValue) || fullName.includes(searchValue) || teamName.includes(searchValue)
		})
	}, [searchQuery, supervisors])

	const openCreate = () => {
		setSelectedSupervisor(null)
		setIsModalOpen(true)
		setError('')
		setSuccess('')
	}

	const openEdit = (supervisor) => {
		setSelectedSupervisor(supervisor)
		setIsModalOpen(true)
		setError('')
		setSuccess('')
	}

	const closeModal = () => {
		setIsModalOpen(false)
		setSelectedSupervisor(null)
	}

	const handleDelete = async (supervisor) => {
		const confirmed = window.confirm(t('supervisors.deleteConfirm'))

		if (!confirmed) {
			return
		}

		setError('')
		setSuccess('')
		try {
			await deleteSupervisorRequest(supervisor.id)
			await loadData()
			setSuccess(t('supervisors.deleted'))
		} catch (err) {
			setError(getErrorMessage(err))
		}
	}

	const handleSubmit = async (values) => {
		setIsSaving(true)
		setError('')
		setSuccess('')
		try {
			if (selectedSupervisor?.id) {
				await updateSupervisorRequest(selectedSupervisor.id, values)
			} else {
				await createSupervisorRequest(values)
			}
			closeModal()
			await loadData()
			setSuccess(selectedSupervisor?.id ? t('supervisors.updated') : t('supervisors.created'))
		} catch (err) {
			setError(getErrorMessage(err))
		} finally {
			setIsSaving(false)
		}
	}

	const handleToggleActive = async (supervisor) => {
		setError('')
		setSuccess('')
		try {
			await updateSupervisorRequest(supervisor.id, {
				username: supervisor.username,
				full_name: supervisor.full_name,
				team_id: supervisor.team_id,
				is_active: !getSupervisorIsActive(supervisor),
			})
			await loadData()
			setSuccess(getSupervisorIsActive(supervisor) ? t('supervisors.disabled') : t('supervisors.enabled'))
		} catch (err) {
			setError(getErrorMessage(err))
		}
	}

	const columns = [
		{ key: 'username', header: t('supervisors.username'), render: (row) => row.username || '-' },
		{ key: 'display_name', header: t('supervisors.fullName'), render: (row) => row.full_name || '-' },
		{ key: 'team_name', header: t('common.team'), render: (row) => row.team_name || row.team?.name || '-' },
		{ key: 'status', header: t('common.status'), render: (row) => (getSupervisorIsActive(row) ? t('common.active') : t('common.inactive')) },
		{
			key: 'actions',
			header: t('common.actions'),
			render: (row) => (
				<div className="flex gap-2">
					<button type="button" onClick={() => openEdit(row)} className="btn-secondary px-3 py-1">
						{t('common.edit')}
					</button>
					<button type="button" onClick={() => handleToggleActive(row)} className="btn-secondary px-3 py-1">
						{getSupervisorIsActive(row) ? t('common.disable') : t('common.enable')}
					</button>
					<button
						type="button"
						onClick={() => handleDelete(row)}
						className="rounded-lg bg-red-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-red-700"
					>
						{t('common.delete')}
					</button>
				</div>
			),
		},
	]

	return (
		<section>
			<div className="mb-4 flex items-center justify-between">
				<h2 className="text-xl font-extrabold">{t('supervisors.title')}</h2>
				<button type="button" className="btn-primary" onClick={openCreate}>
					{t('supervisors.add')}
				</button>
			</div>

			{error ? <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

			{success ? <p className="mb-4 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p> : null}

			<div className="mb-4">
				<input
					type="search"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="input-base"
					placeholder={t('supervisors.searchPlaceholder')}
				/>
			</div>

			<Table
				columns={columns}
				data={filteredSupervisors}
				loading={loading}
				emptyMessage={searchQuery.trim() ? t('common.noResults') : t('supervisors.noSupervisors')}
			/>

			<Modal isOpen={isModalOpen} title={selectedSupervisor ? t('supervisors.edit') : t('supervisors.add')} onClose={closeModal}>
				<SupervisorForm initialValues={selectedSupervisor} teams={teams} onSubmit={handleSubmit} isSaving={isSaving} />
			</Modal>
		</section>
	)
}

export default Supervisors
