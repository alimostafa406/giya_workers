import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBiometricMappingsRequest, unlinkBiometricMappingRequest } from '../api/biometricMappingApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import {
  createWorkerRequest,
  getWorkersRequest,
  updateWorkerRequest,
} from '../api/workersApi'
import WorkerForm from '../components/Forms/WorkerForm'
import Modal from '../components/Modal/Modal'
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

const getWorkerIsActive = (worker) => {
  return Boolean(worker?.is_active)
}

function Workers() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [workers, setWorkers] = useState([])
  const [teams, setTeams] = useState([])
  const [biometricMappings, setBiometricMappings] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedWorker, setSelectedWorker] = useState(null)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [workersRes, teamsRes] = await Promise.all([
        getWorkersRequest(),
        getTeamsRequest(),
      ])

      setWorkers(asArray(workersRes.data))
      setTeams(asArray(teamsRes.data))
      try {
        const mappingsRes = await getBiometricMappingsRequest()
        setBiometricMappings(asArray(mappingsRes.data).filter((mapping) => mapping.is_active !== false))
      } catch {
        // The core worker page stays available until the new mapping migration is applied.
        setBiometricMappings([])
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const biometricByWorkerId = useMemo(() => {
    const mappingsByWorker = new Map()
    biometricMappings.forEach((mapping) => {
      const workerId = String(mapping.worker_id)
      mappingsByWorker.set(workerId, [...(mappingsByWorker.get(workerId) || []), mapping])
    })
    return mappingsByWorker
  }, [biometricMappings])

  const filteredWorkers = useMemo(() => {
    const searchValue = String(searchQuery || '').trim().toLowerCase()

    if (!searchValue) {
      return workers
    }

    return workers.filter((worker) => {
      const fullName = String(worker.full_name || '').toLowerCase()
      const employeeCode = String(worker.employee_code || '').toLowerCase()
      const phone = String(worker.phone || '').toLowerCase()
      const teamName = String(worker.team?.name || worker.team_name || '').toLowerCase()

      return (
        fullName.includes(searchValue)
        || employeeCode.includes(searchValue)
        || phone.includes(searchValue)
        || teamName.includes(searchValue)
      )
    })
  }, [searchQuery, workers])

  const openCreate = () => {
    setSelectedWorker(null)
    setIsModalOpen(true)
  }

  const openEdit = (worker) => {
    setSelectedWorker(worker)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedWorker(null)
  }

  const handleSubmit = async (values) => {
    setIsSaving(true)
    setError('')
    try {
      if (selectedWorker?.id) {
        await updateWorkerRequest(selectedWorker.id, values)
      } else {
        await createWorkerRequest(values)
      }
      closeModal()
      await loadData()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleActive = async (worker) => {
    setError('')
    try {
      await updateWorkerRequest(worker.id, {
        full_name: worker.full_name,
        employee_code: worker.employee_code,
        phone: worker.phone,
        team_id: worker.team_id,
        is_active: !getWorkerIsActive(worker),
      })
      await loadData()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const handleUnlinkBiometric = async (worker) => {
    const mappings = biometricByWorkerId.get(String(worker.id)) || []
    const mapping = mappings[0]
    if (!mapping) {
      navigate(`/biometric-mapping?workerId=${encodeURIComponent(worker.id)}`)
      return
    }

    const confirmed = window.confirm(t('workers.unlinkConfirm'))
    if (!confirmed) return

    setError('')
    try {
      await unlinkBiometricMappingRequest(mapping.id)
      await loadData()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const columns = [
    {
      key: 'full_name',
      header: t('workers.name'),
      render: (row) => row.full_name,
    },
    {
      key: 'employee_code',
      header: t('workers.employeeCode'),
      render: (row) => row.employee_code || '-',
    },
    {
      key: 'phone',
      header: t('workers.phone'),
      render: (row) => row.phone || '-',
    },
    {
      key: 'team',
      header: t('common.team'),
      render: (row) => row.team?.name || row.team_name || '-',
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (getWorkerIsActive(row) ? t('common.active') : t('common.inactive')),
    },
    {
      key: 'biometric',
      header: t('workers.biometric'),
      render: (row) => {
        const mappings = biometricByWorkerId.get(String(row.id)) || []
        const mapping = mappings[0]
        if (mappings.length > 1) return <span className="status-badge status-badge--danger">{t('workers.conflict')}</span>
        if (!mapping) return <span className="status-badge status-badge--neutral">{t('workers.unlinked')}</span>
        return <div className="flex items-center gap-2">{mapping.device_picture_url ? <img src={mapping.device_picture_url} alt="" className="h-7 w-7 rounded-lg border border-(--border) object-cover" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}<span className="status-badge status-badge--success">{t('workers.linked')}</span><span dir="ltr" className="text-xs font-bold text-(--muted)">{mapping.device_employee_no}</span></div>
      },
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <div className="flex gap-2">
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
            {getWorkerIsActive(row) ? t('common.disable') : t('common.enable')}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/biometric-mapping?workerId=${encodeURIComponent(row.id)}`)}
            className="btn-secondary px-3 py-1"
          >
            {(biometricByWorkerId.get(String(row.id)) || []).length ? t('workers.changeBiometric') : t('workers.linkBiometric')}
          </button>
          <button
            type="button"
            onClick={() => handleUnlinkBiometric(row)}
            className="btn-secondary px-3 py-1"
          >
            {t('workers.unlinkBiometric')}
          </button>
        </div>
      ),
    },
  ]

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">{t('workers.title')}</h2>
        <button type="button" className="btn-primary" onClick={openCreate}>
          {t('workers.add')}
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mb-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-base"
          placeholder={t('workers.searchPlaceholder')}
        />
      </div>

      <Table
        columns={columns}
        data={filteredWorkers}
        loading={loading}
        emptyMessage={searchQuery.trim() ? t('common.noResults') : t('workers.noWorkers')}
      />

      <Modal
        isOpen={isModalOpen}
        title={selectedWorker ? t('workers.edit') : t('workers.add')}
        onClose={closeModal}
      >
        <WorkerForm
          initialValues={selectedWorker}
          teams={teams}
          onSubmit={handleSubmit}
          isSaving={isSaving}
        />
      </Modal>
    </section>
  )
}

export default Workers
