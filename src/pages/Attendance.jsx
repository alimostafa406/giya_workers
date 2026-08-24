import { useEffect, useMemo, useState } from 'react'
import { getAttendanceRequest, getCheckoutOnlyInfo, saveAttendanceManuallyRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import AttendanceFilters from '../components/Forms/AttendanceFilters'
import AttendanceEditModal from '../components/Forms/AttendanceEditModal'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import { attendanceRosterCategory, mergeAttendanceRoster, summarizeAttendanceRoster } from '../utils/attendanceRoster'

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

const currentBusinessDate = () => new Date().toLocaleDateString('en-CA', {
  timeZone: 'Africa/Kinshasa',
})

const renderAttendanceStatus = (row, t) => {
  if (row.roster_state === 'not_recorded') return <span className="status-badge status-badge--neutral">{t('attendance.notRecorded')}</span>
  if (row.roster_state === 'not_applicable') return '—'
  const checkoutOnly = getCheckoutOnlyInfo(row)
  const labels = { present: t('attendance.present'), half_day: t('attendance.halfDay'), absent: t('attendance.absent'), pending: t('attendance.pending'), in_progress: t('attendance.inProgress') }
  if (!checkoutOnly) return labels[row.status] || row.status || '-'
  return <div><span className="status-badge status-badge--warning">{t('attendance.checkoutOnly')}</span>{checkoutOnly.eveningPunchTime ? <p className="mt-1 text-xs text-(--muted)">{t('attendance.eveningPunch')}: {checkoutOnly.eveningPunchTime}</p> : null}</div>
}

function Attendance() {
  const { t } = useTranslation()
  const [teams, setTeams] = useState([])
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingRow, setEditingRow] = useState(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [filters, setFilters] = useState({
    date: currentBusinessDate(),
    team_id: '',
    worker_id: '',
    search: '',
    roster_status: 'all',
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

  const loadAttendance = async (nextFilters = filters) => {
    setLoading(true)
    setError('')
    try {
      const selectedDate = nextFilters.date || currentBusinessDate()
      const { data } = await getAttendanceRequest({
        ...normalizeFilters({ ...nextFilters, date: selectedDate }),
        staff_classification: 'normal',
      })
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

  const saveManualEdit = async (values) => {
    if (!editingRow) return
    setIsSavingEdit(true)
    setError('')
    try {
      await saveAttendanceManuallyRequest({
        row: editingRow.is_virtual ? null : editingRow,
        workerId: editingRow.worker_id,
        attendanceDate: editingRow.attendance_date || editingRow.date,
        values,
      })
      setEditingRow(null)
      await loadAttendance()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleFilterChange = (key, value) => {
    const nextFilters = {
      ...filters,
      [key]: key === 'date' ? (value || currentBusinessDate()) : value,
    }
    setFilters(nextFilters)

    if (key === 'date' || key === 'team_id' || key === 'worker_id') {
      loadAttendance(nextFilters)
    }
  }

  const columns = [
    {
      key: 'worker',
      header: t('attendance.worker'),
      render: (row) => row.worker?.full_name || row.worker_name || '-',
    },
    {
      key: 'team',
      header: t('attendance.team'),
      render: (row) => row.team?.name || row.team_name || '-',
    },
    {
      key: 'status',
      header: t('attendance.status'),
      render: (row) => renderAttendanceStatus(row, t),
    },
    {
      key: 'check_in',
      header: t('attendance.checkIn'),
      render: (row) => row.check_in || '-',
    },
    {
      key: 'check_out',
      header: t('attendance.checkOut'),
      render: (row) => row.check_out || '-',
    },
    {
      key: 'note',
      header: t('attendance.notes'),
      render: (row) => row.note || '-',
    },
    {
      key: 'actions',
      header: t('attendance.action'),
      render: (row) => <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => setEditingRow(row)}>{t('attendance.manualCorrection')}</button>,
    },
  ]

  const rosterRows = useMemo(() => mergeAttendanceRoster({
    workers,
    attendance,
    date: filters.date,
    teamId: filters.team_id,
    workerId: filters.worker_id,
    businessDate: currentBusinessDate(),
  }), [attendance, filters.date, filters.team_id, filters.worker_id, workers])

  const summary = useMemo(() => summarizeAttendanceRoster(rosterRows), [rosterRows])

  const visibleAttendance = rosterRows.filter((row) => {
    const workerName = String(row.worker?.full_name || row.worker_name || '').toLowerCase()
    const searchValue = String(filters.search || '').trim().toLowerCase()
    const matchesSearch = !searchValue || workerName.includes(searchValue)
    const matchesRosterStatus = filters.roster_status === 'all' || attendanceRosterCategory(row) === filters.roster_status
    return matchesSearch && matchesRosterStatus
  })

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-extrabold">{t('attendance.title')}</h2>
        <p className="text-sm font-semibold text-(--muted)">
          {t('attendance.date')}: <span dir="ltr">{filters.date}</span>
        </p>
      </div>

      <AttendanceFilters
        filters={filters}
        onChange={handleFilterChange}
        teams={teams}
        workers={workers}
        onApply={loadAttendance}
      />
      <AttendanceEditModal row={editingRow} isOpen={Boolean(editingRow)} isSaving={isSavingEdit} onClose={() => setEditingRow(null)} onSave={saveManualEdit} />

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {filters.team_id ? <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['teamTotal', summary.total],
          ['presentCount', summary.present],
          ['notRecordedCount', summary.not_recorded],
          ['absentCount', summary.absent],
          ['needsReviewCount', summary.review],
        ].map(([label, count]) => <div key={label} className="surface-card p-3"><p className="text-xs font-bold text-(--muted)">{t(`attendance.${label}`)}</p><p className="mt-1 text-xl font-extrabold">{count}</p></div>)}
      </div> : null}

      <Table
        columns={columns}
        data={visibleAttendance}
        loading={loading}
        emptyMessage={t('attendance.empty')}
      />
    </section>
  )
}

export default Attendance
