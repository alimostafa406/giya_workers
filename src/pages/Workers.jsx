import { useEffect, useMemo, useState } from 'react'
import { getBiometricMappingsRequest, saveBiometricMappingRequest, unlinkBiometricMappingRequest } from '../api/biometricMappingApi'
import { getHikvisionDeviceUsers } from '../data/hikvisionRawData'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import {
  createWorkerRequest,
  getWorkersRequest,
  updateWorkerRequest,
} from '../api/workersApi'
import WorkerForm from '../components/Forms/WorkerForm'
import WorkerWeekAttendanceRecovery from '../components/WorkerWeekAttendanceRecovery'
import Modal from '../components/Modal/Modal'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import { useAuthStore } from '../store/authStore'
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

const getWorkerIsActive = (worker) => {
  return Boolean(worker?.is_active)
}

function Workers() {
  const { t, language } = useTranslation()
  const admin = useAuthStore((state) => state.admin)
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

  const biometricCoverageByWorkerId = useMemo(
    () => buildBiometricCoverageByWorker(biometricMappings),
    [biometricMappings],
  )

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
        staff_classification: worker.staff_classification,
        payment_type: worker.payment_type,
        monthly_salary: worker.monthly_salary,
      })
      await loadData()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const handleMappingChange = async ({ mapping, deviceUser, replaceExisting = false }) => {
    setIsSaving(true); setError('')
    try {
      if (mapping) await unlinkBiometricMappingRequest(mapping.id)
      else await saveBiometricMappingRequest({ deviceUser, workerId: selectedWorker.id, replaceExisting, reviewState: 'confirmed' })
      await loadData()
    } catch (err) { setError(getErrorMessage(err)); throw err }
    finally { setIsSaving(false) }
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
        const coverage = biometricCoverageForWorker(biometricCoverageByWorkerId, row.id)
        const mapping = coverage.mappings[0]
        return <div className="flex items-center gap-2">{mapping?.device_picture_url ? <img src={mapping.device_picture_url} alt="" className="h-7 w-7 rounded-lg border border-(--border) object-cover" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}<span className={`status-badge ${biometricCoverageBadgeClass(coverage.status)}`}>{biometricCoverageLabel(coverage.status, language)}</span>{coverage.mappings.length ? <span dir="ltr" className="text-xs font-bold text-(--muted)">{coverage.mappings.map((item) => item.device_employee_no).join(' · ')}</span> : null}</div>
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
        {selectedWorker ? <WorkerBiometricMappings worker={selectedWorker} mappings={biometricByWorkerId.get(String(selectedWorker.id)) || []} allMappings={biometricMappings} workers={workers} deviceUsers={getHikvisionDeviceUsers()} isSaving={isSaving} onChange={handleMappingChange} /> : null}
        {selectedWorker && admin ? <WorkerWeekAttendanceRecovery worker={selectedWorker} disabled={isSaving} onRecovered={loadData} /> : null}
      </Modal>
    </section>
  )
}

function WorkerBiometricMappings({ worker, mappings, allMappings, workers, deviceUsers, isSaving, onChange }) {
  const { t } = useTranslation()
  const [identityKey, setIdentityKey] = useState('')
  const [pendingMove, setPendingMove] = useState(null)
  const active = mappings.filter((mapping) => mapping.is_active !== false)
  const available = deviceUsers.filter((user) => user?.deviceId && user?.employeeNo && user.isCurrentlyReturned !== false)
  const selected = available.find((user) => `${user.deviceId}::${user.employeeNo}` === identityKey) || null
  const ownerFor = (user) => allMappings.find((mapping) => mapping.is_active !== false && String(mapping.device_employee_no) === String(user.employeeNo) && (!mapping.device_id || String(mapping.device_id) === String(user.deviceId))) || null
  const ownerName = (mapping) => workers.find((candidate) => String(candidate.id) === String(mapping?.worker_id))?.full_name || t('common.unknown')
  const link = async (replaceExisting = false) => {
    if (!selected) return
    const owner = ownerFor(selected)
    if (owner && String(owner.worker_id) !== String(worker.id) && !replaceExisting) { setPendingMove({ selected, owner }); return }
    await onChange({ deviceUser: selected, replaceExisting })
    setIdentityKey(''); setPendingMove(null)
  }
  const unlink = async (mapping) => {
    if (!window.confirm(t('workers.unlinkConfirm'))) return
    await onChange({ mapping })
  }
  return <section className="mt-5 border-t border-(--border) pt-4">
    <h3 className="font-extrabold">{t('workers.biometricMappingTitle')}</h3>
    <p className="mt-1 text-sm text-(--muted)">{t('workers.biometricMappingHint')}</p>
    <div className="mt-3 space-y-2">{active.length ? active.map((mapping) => <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-(--border) px-3 py-2"><span dir="ltr"><b>{mapping.device_id || 'legacy'} · {mapping.device_employee_no}</b></span><span className="text-xs">{mapping.mapping_review_state === 'confirmed' ? t('biometric.confirmed') : t('biometric.unconfirmed')} · {mapping.is_active === false ? t('common.inactive') : t('common.active')}</span><button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={isSaving} onClick={() => unlink(mapping)}>{t('workers.unlinkBiometric')}</button></div>) : <p className="text-sm text-(--muted)">{t('workers.unlinked')}</p>}</div>
    <div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-64 flex-1 text-sm font-semibold">{t('workers.linkAnotherBiometric')}<select className="input-base mt-1" value={identityKey} onChange={(event) => { setIdentityKey(event.target.value); setPendingMove(null) }}><option value="">{t('biometricMapping.selectIdentity')}</option>{available.map((user) => <option key={`${user.deviceId}::${user.employeeNo}`} value={`${user.deviceId}::${user.employeeNo}`}>{user.deviceId} · {user.employeeNo} · {user.name}</option>)}</select></label><button type="button" className="btn-primary" disabled={!selected || isSaving} onClick={() => link(false)}>{t('workers.linkBiometric')}</button></div>
    {pendingMove ? <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"><b>{t('workers.biometricConflict', { worker: ownerName(pendingMove.owner) })}</b><div className="mt-2 flex gap-2"><button type="button" className="btn-primary" disabled={isSaving} onClick={() => link(true)}>{t('workers.confirmMoveBiometric')}</button><button type="button" className="btn-secondary" onClick={() => setPendingMove(null)}>{t('common.cancel')}</button></div></div> : null}
  </section>
}

export default Workers
