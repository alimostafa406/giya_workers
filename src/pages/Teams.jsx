import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../api/axios'
import { getBiometricMappingsRequest } from '../api/biometricMappingApi'
import { getSupervisorsRequest } from '../api/supervisorsApi'
import {
  createTeamRequest,
  getTeamsRequest,
  updateTeamRequest,
} from '../api/teamsApi'
import TeamForm from '../components/Forms/TeamForm'
import Modal from '../components/Modal/Modal'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import {
  biometricCoverageBadgeClass,
  biometricCoverageForWorker,
  biometricCoverageLabel,
  buildBiometricCoverageByWorker,
} from '../utils/biometricMappingCoverage'

const asArray = (value) => {
  if (Array.isArray(value)) {
    return value
  }
  if (Array.isArray(value?.data)) {
    return value.data
  }
  return []
}

function Teams() {
  const { t, language } = useTranslation()
  const [teams, setTeams] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [detailsTeam, setDetailsTeam] = useState(null)
  const [biometricMappings, setBiometricMappings] = useState([])

  const getTeamIsActive = (team) => {
    return Boolean(team?.is_active)
  }

  const filteredTeams = useMemo(() => {
    const searchValue = String(searchQuery || '').trim().toLowerCase()

    if (!searchValue) {
      return teams
    }

    return teams.filter((team) => {
      const teamName = String(team.name || '').toLowerCase()
      const supervisorName = String(team.supervisor_name || team.supervisor?.full_name || '').toLowerCase()

      return teamName.includes(searchValue) || supervisorName.includes(searchValue)
    })
  }, [searchQuery, teams])

  const availableSupervisors = useMemo(() => {
    const currentTeamId = String(selectedTeam?.id || '')
    const currentSupervisorId = String(selectedTeam?.supervisor_id || '')

    return supervisors.filter((supervisor) => {
      const supervisorTeamId = String(supervisor.team_id || '')

      if (!supervisorTeamId) {
        return true
      }

      if (currentTeamId && supervisorTeamId === currentTeamId) {
        return true
      }

      return currentSupervisorId && String(supervisor.id) === currentSupervisorId
    })
  }, [selectedTeam, supervisors])

  const loadTeams = async () => {
    setLoading(true)
    setError('')
    try {
      const [teamsRes, supervisorsRes] = await Promise.all([
        getTeamsRequest(),
        getSupervisorsRequest(),
      ])
      setTeams(asArray(teamsRes.data))
      setSupervisors(asArray(supervisorsRes.data))
      try {
        const mappingsRes = await getBiometricMappingsRequest()
        setBiometricMappings(asArray(mappingsRes.data).filter((mapping) => mapping.is_active !== false))
      } catch {
        // Teams remain usable before the biometric mapping migration is applied.
        setBiometricMappings([])
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTeams()
  }, [])

  const biometricByWorkerId = useMemo(() => {
    const result = new Map()
    biometricMappings.forEach((mapping) => {
      const workerId = String(mapping.worker_id)
      result.set(workerId, [...(result.get(workerId) || []), mapping])
    })
    return result
  }, [biometricMappings])

  const biometricCoverageByWorkerId = useMemo(
    () => buildBiometricCoverageByWorker(biometricMappings),
    [biometricMappings],
  )

  const openCreate = () => {
    setSelectedTeam(null)
    setIsModalOpen(true)
  }

  const openEdit = (team) => {
    setSelectedTeam(team)
    setIsModalOpen(true)
  }

  const openDetails = (team) => {
    setDetailsTeam(team)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedTeam(null)
  }

  const closeDetails = () => {
    setDetailsTeam(null)
  }

  const handleSubmit = async (values) => {
    setIsSaving(true)
    setError('')
    try {
      const payload = {
        name: String(values.name || '').trim(),
        supervisor_id: String(values.supervisor_id || '').trim() || null,
        is_active: Boolean(values.is_active),
      }

      console.log('TEAM UPDATE PAYLOAD', payload)
      console.log(
        'SUPERVISOR IDS',
        supervisors.map((supervisor) => String(supervisor.id)),
      )

      if (!payload.name) {
        throw new Error('Team name is required')
      }

      if (payload.supervisor_id) {
        const supervisorExists = supervisors.some(
          (supervisor) => String(supervisor.id) === payload.supervisor_id,
        )

        if (!supervisorExists) {
          throw new Error('Selected supervisor is not valid')
        }
      }

      if (selectedTeam?.id) {
        await updateTeamRequest(selectedTeam.id, payload)
      } else {
        await createTeamRequest(payload)
      }
      closeModal()
      await loadTeams()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleActive = async (team) => {
    setError('')
    try {
      await updateTeamRequest(team.id, {
        name: team.name,
        supervisor_id: team.supervisor_id,
        is_active: !getTeamIsActive(team),
      })
      await loadTeams()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const columns = [
    {
      key: 'name',
      header: t('teams.name'),
      render: (row) => row.name,
    },
    {
      key: 'supervisor_name',
      header: t('teams.supervisor'),
      render: (row) => row.supervisor_name || row.supervisor?.name || t('common.noSupervisor'),
    },
    {
      key: 'workers_count',
      header: t('teams.workerCount'),
      render: (row) => row.workers_count || row.workers?.length || 0,
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (getTeamIsActive(row) ? t('common.active') : t('common.inactive')),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => openDetails(row)}
            className="btn-secondary px-3 py-1"
          >
            {t('teams.viewMembers')}
          </button>
          <button
            type="button"
            onClick={() => openEdit(row)}
            className="btn-secondary px-3 py-1"
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={() => handleToggleActive(row)}
            className="btn-secondary px-3 py-1"
          >
            {getTeamIsActive(row) ? t('common.disable') : t('common.enable')}
          </button>
        </div>
      ),
    },
  ]

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">{t('teams.title')}</h2>
        <button type="button" className="btn-primary" onClick={openCreate}>
          {t('teams.add')}
        </button>
      </div>

      <div className="mb-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-base"
          placeholder={t('teams.searchPlaceholder')}
        />
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Table
        columns={columns}
        data={filteredTeams}
        loading={loading}
        emptyMessage={searchQuery.trim() ? t('common.noResults') : t('teams.noTeams')}
      />

      <Modal
        isOpen={isModalOpen}
        title={selectedTeam ? t('teams.edit') : t('teams.add')}
        onClose={closeModal}
      >
        <TeamForm
          initialValues={selectedTeam}
          supervisors={availableSupervisors}
          onSubmit={handleSubmit}
          isSaving={isSaving}
        />
      </Modal>

      <Modal
        isOpen={Boolean(detailsTeam)}
        title={`${t('common.details')}: ${detailsTeam?.name || ''}`}
        onClose={closeDetails}
      >
        <div className="space-y-4">
          <div>
            <p className="text-sm text-(--muted)">{t('teams.supervisor')}</p>
            <p className="mt-1 font-semibold">
              {detailsTeam?.supervisor_name || detailsTeam?.supervisor?.name || t('common.noSupervisor')}
            </p>
          </div>

          <div>
            <p className="text-sm text-(--muted)">{t('teams.members')}</p>
            <div className="mt-2 space-y-2">
              {detailsTeam?.workers?.length ? (
                detailsTeam.workers.map((worker) => (
                  (() => {
                    const mappings = biometricByWorkerId.get(String(worker.id)) || []
                    const mapping = mappings[0]
                    const coverage = biometricCoverageForWorker(biometricCoverageByWorkerId, worker.id)
                    return <div key={worker.id} className="rounded-xl border border-(--border) bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2">{mapping?.device_picture_url ? <img src={mapping.device_picture_url} alt="" className="h-7 w-7 rounded-lg border border-(--border) object-cover" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}<p className="truncate font-semibold">{worker.full_name}</p></div><span className={`status-badge ${biometricCoverageBadgeClass(coverage.status)}`}>{biometricCoverageLabel(coverage.status, language)}</span></div>
                      <p className="mt-1 text-xs text-(--muted)">{worker.is_active === false ? t('common.inactive') : t('common.active')}{mapping ? ` · ${t('teams.deviceNumber')}: ${mapping.device_employee_no}` : ''}</p>
                    </div>
                  })()
                ))
              ) : (
                <p className="text-sm text-(--muted)">{t('teams.noMembers')}</p>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </section>
  )
}

export default Teams
