import { useEffect, useMemo, useState } from 'react'
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
  const [workers, setWorkers] = useState([])
  const [teams, setTeams] = useState([])
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
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

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

  const columns = [
    {
      key: 'full_name',
      header: 'اسم العامل',
      render: (row) => row.full_name,
    },
    {
      key: 'employee_code',
      header: 'الكود الوظيفي',
      render: (row) => row.employee_code || '-',
    },
    {
      key: 'phone',
      header: 'الهاتف',
      render: (row) => row.phone || '-',
    },
    {
      key: 'team',
      header: 'الفريق',
      render: (row) => row.team?.name || row.team_name || '-',
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => (getWorkerIsActive(row) ? 'نشط' : 'غير نشط'),
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (row) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => openEdit(row)}
            className="btn-secondary px-3 py-1"
          >
            تعديل
          </button>
          <button
            type="button"
            onClick={() => handleToggleActive(row)}
            className="btn-secondary px-3 py-1"
          >
            {getWorkerIsActive(row) ? 'تعطيل' : 'تفعيل'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">العمال</h2>
        <button type="button" className="btn-primary" onClick={openCreate}>
          إضافة عامل
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
          placeholder="ابحث باسم العامل أو الكود الوظيفي أو الهاتف أو اسم الفريق"
        />
      </div>

      <Table
        columns={columns}
        data={filteredWorkers}
        loading={loading}
        emptyMessage={searchQuery.trim() ? 'لا توجد نتائج' : 'لا يوجد عمال'}
      />

      <Modal
        isOpen={isModalOpen}
        title={selectedWorker ? 'تعديل عامل' : 'إضافة عامل'}
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
