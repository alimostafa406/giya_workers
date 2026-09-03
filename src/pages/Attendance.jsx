import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { getAttendanceRequest, getCheckoutOnlyInfo, saveAttendanceManuallyRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import AttendanceFilters from '../components/Forms/AttendanceFilters'
import AttendanceEditModal from '../components/Forms/AttendanceEditModal'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import {
  ATTENDANCE_REFRESH_INTERVAL_MS,
  isAttendancePageLocked,
  kinshasaClock,
  prepareAttendanceOutput,
} from '../utils/attendanceOperationalGate'
import { attendanceRosterCategory, mergeAttendanceRoster, summarizeAttendanceRoster } from '../utils/attendanceRoster'

const asArray = (value) => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  return []
}

const currentBusinessDate = () => kinshasaClock().date

const renderAttendanceStatus = (row, t) => {
  if (row.roster_state === 'not_recorded') return <span className="status-badge status-badge--neutral">{t('attendance.notRecorded')}</span>
  if (row.roster_state === 'not_applicable') return '—'
  const checkoutOnly = getCheckoutOnlyInfo(row)
  const labels = { present: t('attendance.present'), late: t('attendance.late'), half_day: t('attendance.halfDay'), absent: t('attendance.absent'), pending: t('attendance.pending'), in_progress: t('attendance.inProgress') }
  if (!checkoutOnly) return labels[row.status] || row.status || '-'
  return <div><span className="status-badge status-badge--warning">{t('attendance.checkoutOnly')}</span>{checkoutOnly.eveningPunchTime ? <p className="mt-1 text-xs text-(--muted)">{t('attendance.eveningPunch')}: {checkoutOnly.eveningPunchTime}</p> : null}</div>
}

const filteredRosterRows = ({ snapshot, filters, businessDate }) => {
  if (snapshot.date !== filters.date) return []
  const rows = mergeAttendanceRoster({
    workers: snapshot.workers,
    attendance: snapshot.attendance,
    date: filters.date,
    teamId: filters.team_id,
    workerId: filters.worker_id,
    businessDate,
  })
  const searchValue = String(filters.search || '').trim().toLowerCase()
  return rows.filter((row) => {
    const workerName = String(row.worker?.full_name || row.worker_name || '').toLowerCase()
    const matchesSearch = !searchValue || workerName.includes(searchValue)
    const matchesRosterStatus = filters.roster_status === 'all' || attendanceRosterCategory(row) === filters.roster_status
    return matchesSearch && matchesRosterStatus
  })
}

function Attendance() {
  const { t } = useTranslation()
  const [teams, setTeams] = useState([])
  const [snapshot, setSnapshot] = useState({ date: '', workers: [], attendance: [], fetchedAt: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingRow, setEditingRow] = useState(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [filters, setFilters] = useState({ date: currentBusinessDate(), team_id: '', worker_id: '', search: '', roster_status: 'all' })
  const filtersRef = useRef(filters)
  const refreshInFlightRef = useRef(null)
  const mountedRef = useRef(true)

  const businessDate = kinshasaClock(now).date
  const isTodayView = filters.date === businessDate
  const locked = isAttendancePageLocked({ selectedDate: filters.date, now })

  const refreshSnapshot = useCallback(async (requestedFilters = filtersRef.current, { force = false } = {}) => {
    const requestedDate = requestedFilters.date || currentBusinessDate()
    if (isAttendancePageLocked({ selectedDate: requestedFilters.date, now: new Date() })) {
      const lockError = new Error('attendance_locked')
      lockError.code = 'attendance_locked'
      throw lockError
    }
    while (refreshInFlightRef.current) {
      try {
        const activeResult = await refreshInFlightRef.current
        if (!force && activeResult.date === requestedDate) return activeResult
      } catch {
        // Wait for the active request to release the coordinator, then retry safely.
      }
    }

    if (mountedRef.current) { setLoading(true); setError('') }
    const request = Promise.all([
      getWorkersRequest(),
      getAttendanceRequest({ date: requestedDate, staff_classification: 'normal' }),
    ]).then(([workersResult, attendanceResult]) => {
      const nextSnapshot = {
        date: requestedDate,
        workers: asArray(workersResult.data),
        attendance: asArray(attendanceResult.data),
        fetchedAt: new Date(),
      }
      if (mountedRef.current && filtersRef.current.date === requestedDate) setSnapshot(nextSnapshot)
      return nextSnapshot
    }).catch((requestError) => {
      if (mountedRef.current) setError(getErrorMessage(requestError))
      throw requestError
    }).finally(() => {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null
      if (mountedRef.current) setLoading(false)
    })
    refreshInFlightRef.current = request
    return request
  }, [])

  useEffect(() => {
    mountedRef.current = true
    getTeamsRequest()
      .then((result) => { if (mountedRef.current) setTeams(asArray(result.data)) })
      .catch((requestError) => { if (mountedRef.current) setError(getErrorMessage(requestError)) })
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (locked) { setEditingRow(null); return }
    refreshSnapshot(filtersRef.current).catch(() => {})
  }, [filters.date, locked, refreshSnapshot])

  useEffect(() => {
    if (!isTodayView || locked) return undefined
    const timer = window.setInterval(() => refreshSnapshot(filtersRef.current).catch(() => {}), ATTENDANCE_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [isTodayView, locked, refreshSnapshot])

  useEffect(() => {
    const refreshAfterFocus = () => {
      const activeFilters = filtersRef.current
      if (document.visibilityState !== 'hidden' && activeFilters.date === currentBusinessDate() && !isAttendancePageLocked({ selectedDate: activeFilters.date, now: new Date() })) {
        refreshSnapshot(activeFilters).catch(() => {})
      }
    }
    window.addEventListener('focus', refreshAfterFocus)
    document.addEventListener('visibilitychange', refreshAfterFocus)
    return () => {
      window.removeEventListener('focus', refreshAfterFocus)
      document.removeEventListener('visibilitychange', refreshAfterFocus)
    }
  }, [refreshSnapshot])

  const saveManualEdit = async (values) => {
    if (!editingRow || locked) return
    setIsSavingEdit(true)
    setError('')
    try {
      await saveAttendanceManuallyRequest({ row: editingRow.is_virtual ? null : editingRow, workerId: editingRow.worker_id, attendanceDate: editingRow.attendance_date || editingRow.date, values })
      setEditingRow(null)
      await refreshSnapshot(filtersRef.current, { force: true })
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleFilterChange = (key, value) => {
    const nextFilters = { ...filtersRef.current, [key]: key === 'date' ? (value || currentBusinessDate()) : value }
    filtersRef.current = nextFilters
    setFilters(nextFilters)
  }

  const handleApply = () => {
    if (!locked) refreshSnapshot(filtersRef.current, { force: true }).catch(() => {})
  }

  const runOutput = async (kind) => {
    setError('')
    const outputFilters = { ...filtersRef.current }
    const outputBusinessDate = currentBusinessDate()
    const result = await prepareAttendanceOutput({
      locked,
      refresh: () => refreshSnapshot(outputFilters, { force: true }),
      generate: async (freshSnapshot) => {
        const freshRows = filteredRosterRows({ snapshot: freshSnapshot, filters: outputFilters, businessDate: outputBusinessDate })
        if (kind === 'print') {
          await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
          window.print()
          return
        }
        const sheet = XLSX.utils.json_to_sheet(freshRows.map((row) => ({
          [t('attendance.worker')]: row.worker?.full_name || row.worker_name || '-',
          [t('attendance.team')]: row.team?.name || row.team_name || '-',
          [t('attendance.status')]: row.roster_state === 'not_recorded' ? t('attendance.notRecorded') : (row.status || '-'),
          [t('attendance.checkIn')]: row.check_in || '-',
          [t('attendance.checkOut')]: row.check_out || '-',
          [t('attendance.notes')]: row.note || '-',
        })))
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, sheet, 'Attendance')
        XLSX.writeFile(workbook, `attendance-${outputFilters.date}.xlsx`)
      },
    })
    if (!result.ok) setError(result.reason === 'locked' ? t('attendance.operationalLockTitle') : t('attendance.outputRefreshFailed'))
  }

  const columns = [
    { key: 'worker', header: t('attendance.worker'), render: (row) => row.worker?.full_name || row.worker_name || '-' },
    { key: 'team', header: t('attendance.team'), render: (row) => row.team?.name || row.team_name || '-' },
    { key: 'status', header: t('attendance.status'), render: (row) => renderAttendanceStatus(row, t) },
    { key: 'check_in', header: t('attendance.checkIn'), render: (row) => row.check_in || '-' },
    { key: 'check_out', header: t('attendance.checkOut'), render: (row) => row.check_out || '-' },
    { key: 'note', header: t('attendance.notes'), render: (row) => row.note || '-' },
    { key: 'actions', header: t('attendance.action'), render: (row) => <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => setEditingRow(row)}>{t('attendance.manualCorrection')}</button> },
  ]

  const rosterRows = useMemo(() => filteredRosterRows({ snapshot, filters: { ...filters, search: '', roster_status: 'all' }, businessDate }), [businessDate, filters, snapshot])
  const summary = useMemo(() => summarizeAttendanceRoster(rosterRows), [rosterRows])
  const visibleAttendance = useMemo(() => filteredRosterRows({ snapshot, filters, businessDate }), [businessDate, filters, snapshot])

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-extrabold">{t('attendance.title')}</h2><Link className="btn-secondary" to="/attendance/absence-report">{t('absenceReport.title')}</Link></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" disabled={locked || loading} onClick={() => runOutput('print')}>{t('reports.print')}</button>
          <button type="button" className="btn-secondary" disabled={locked || loading} onClick={() => runOutput('excel')}>{t('reports.excel')}</button>
          <p className="text-sm font-semibold text-(--muted)">{t('attendance.date')}: <span dir="ltr">{filters.date}</span></p>
        </div>
      </div>

      <AttendanceFilters filters={filters} onChange={handleFilterChange} teams={teams} workers={snapshot.workers} onApply={handleApply} />
      {error ? <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {locked ? (
        <div className="surface-card border border-amber-200 bg-amber-50 px-6 py-10 text-center" role="status">
          <h3 className="text-xl font-extrabold text-amber-900">{t('attendance.operationalLockTitle')}</h3>
          <p className="mt-2 text-sm font-semibold text-amber-800">{t('attendance.operationalLockDescription')}</p>
        </div>
      ) : (
        <>
          <AttendanceEditModal row={editingRow} isOpen={Boolean(editingRow)} isSaving={isSavingEdit} onClose={() => setEditingRow(null)} onSave={saveManualEdit} />
          <div className="mb-3 flex justify-end text-xs font-semibold text-(--muted)">{snapshot.fetchedAt ? <span>{t('attendance.lastUpdated')}: <span dir="ltr">{kinshasaClock(snapshot.fetchedAt).time}</span></span> : null}</div>
          {filters.team_id ? <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {[['teamTotal', summary.total], ['presentCount', summary.present], ['notRecordedCount', summary.not_recorded], ['absentCount', summary.absent], ['needsReviewCount', summary.review]].map(([label, count]) => <div key={label} className="surface-card p-3"><p className="text-xs font-bold text-(--muted)">{t(`attendance.${label}`)}</p><p className="mt-1 text-xl font-extrabold">{count}</p></div>)}
          </div> : null}
          <Table columns={columns} data={visibleAttendance} loading={loading || snapshot.date !== filters.date} emptyMessage={t('attendance.empty')} />
        </>
      )}
    </section>
  )
}

export default Attendance
