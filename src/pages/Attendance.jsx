import { useEffect, useState } from 'react'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import AttendanceFilters from '../components/Forms/AttendanceFilters'
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

const normalizeFilters = (filters) => {
  return Object.entries(filters).reduce((acc, [key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      acc[key] = value
    }
    return acc
  }, {})
}

function Attendance() {
  const [teams, setTeams] = useState([])
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({
    date: '',
    team_id: '',
    worker_id: '',
    search: '',
  })

  const loadMeta = async () => {
    try {
      const [teamsRes, workersRes] = await Promise.all([
        getTeamsRequest(),
        getWorkersRequest(),
      ])
      setTeams(asArray(teamsRes.data))
      setWorkers(asArray(workersRes.data))
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const loadAttendance = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await getAttendanceRequest(normalizeFilters(filters))
      setAttendance(asArray(data))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMeta()
    loadAttendance()
  }, [])

  const columns = [
    {
      key: 'worker',
      header: 'العامل',
      render: (row) => row.worker?.full_name || row.worker_name || '-',
    },
    {
      key: 'team',
      header: 'الفريق',
      render: (row) => row.team?.name || row.team_name || '-',
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => row.status || '-',
    },
    {
      key: 'check_in',
      header: 'تسجيل الدخول',
      render: (row) => row.check_in || '-',
    },
    {
      key: 'check_out',
      header: 'تسجيل الخروج',
      render: (row) => row.check_out || '-',
    },
    {
      key: 'note',
      header: 'ملاحظة',
      render: (row) => row.note || '-',
    },
  ]

  const visibleAttendance = attendance.filter((row) => {
    const workerName = String(row.worker?.full_name || row.worker_name || '').toLowerCase()
    const searchValue = String(filters.search || '').trim().toLowerCase()

    if (!searchValue) {
      return true
    }

    return workerName.includes(searchValue)
  })

  return (
    <section>
      <h2 className="mb-4 text-xl font-extrabold">تقرير الحضور</h2>

      <AttendanceFilters
        filters={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        teams={teams}
        workers={workers}
        onApply={loadAttendance}
      />

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Table
        columns={columns}
        data={visibleAttendance}
        loading={loading}
        emptyMessage="لا توجد سجلات حضور"
      />
    </section>
  )
}

export default Attendance
