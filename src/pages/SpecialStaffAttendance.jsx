import { useEffect, useMemo, useState } from 'react'
import { getCheckoutOnlyInfo, getSpecialStaffAttendanceRequest, updateAttendanceManuallyRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import Table from '../components/Table/Table'
import AttendanceEditModal from '../components/Forms/AttendanceEditModal'
import { useTranslation } from '../i18n/LanguageContext'

const today = () => new Date().toISOString().slice(0, 10)

const renderAttendanceStatus = (row, t) => {
  const checkoutOnly = getCheckoutOnlyInfo(row)
  const labels = { present: t('attendance.present'), half_day: t('attendance.halfDay'), absent: t('attendance.absent'), pending: t('attendance.pending'), in_progress: t('attendance.inProgress') }
  if (!checkoutOnly) return labels[row.status] || row.status || '-'
  return <div><span className="status-badge status-badge--warning">{t('attendance.checkoutOnly')}</span>{checkoutOnly.eveningPunchTime ? <p className="mt-1 text-xs text-(--muted)">{t('attendance.eveningPunch')}: {checkoutOnly.eveningPunchTime}</p> : null}</div>
}

function SpecialStaffAttendance() {
  const { t } = useTranslation()
  const [date, setDate] = useState(today)
  const [search, setSearch] = useState('')
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingRow, setEditingRow] = useState(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const loadAttendance = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await getSpecialStaffAttendanceRequest({ date })
      setAttendance(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAttendance() }, [])

  const saveManualEdit = async (values) => {
    if (!editingRow) return
    setIsSavingEdit(true)
    setError('')
    try {
      await updateAttendanceManuallyRequest(editingRow, values)
      setEditingRow(null)
      await loadAttendance()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsSavingEdit(false)
    }
  }

  const visibleAttendance = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    if (!term) return attendance
    return attendance.filter((row) => (
      String(row.worker?.full_name || row.worker_name || '').toLocaleLowerCase().includes(term)
      || String(row.biometric_employee_no || '').toLocaleLowerCase().includes(term)
    ))
  }, [attendance, search])

  const columns = [
    { key: 'worker', header: t('workers.name'), render: (row) => row.worker?.full_name || row.worker_name || '-' },
    { key: 'employeeNo', header: t('specialStaff.biometricNo'), render: (row) => row.biometric_employee_no || '-' },
    { key: 'check_in', header: t('attendance.checkIn'), render: (row) => row.check_in || '-' },
    { key: 'check_out', header: t('attendance.checkOut'), render: (row) => row.check_out || '-' },
    { key: 'status', header: t('attendance.status'), render: (row) => row.status || '-' },
    { key: 'note', header: t('attendance.notes'), render: (row) => row.note || '-' },
    { key: 'actions', header: t('attendance.action'), render: (row) => <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => setEditingRow(row)}>{t('specialStaff.manualCorrection')}</button> },
  ].map((column) => (column.key === 'status' ? { ...column, render: (row) => renderAttendanceStatus(row, t) } : column))

  return <section>
    <div className="mb-6"><p className="text-sm font-bold text-(--primary)">{t('navigation.attendance')}</p><h2 className="mt-1 text-2xl font-extrabold">{t('specialStaff.title')}</h2></div>
    <div className="surface-card mb-5 flex flex-wrap items-end gap-3 p-4"><label className="block text-sm font-bold">{t('reports.from')}<input type="date" className="input-base mt-2" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="min-w-60 flex-1 text-sm font-bold">{t('common.search')}<input className="input-base mt-2" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('workers.name')} /></label><button type="button" className="btn-primary" disabled={loading} onClick={loadAttendance}>{loading ? '...' : t('navigation.attendance')}</button></div>
    {error ? <p className="alert alert--error mb-4">{error}</p> : null}
    <Table columns={columns} data={visibleAttendance} loading={loading} emptyMessage={t('attendance.empty')} />
    <AttendanceEditModal row={editingRow} isOpen={Boolean(editingRow)} isSaving={isSavingEdit} onClose={() => setEditingRow(null)} onSave={saveManualEdit} />
  </section>
}

export default SpecialStaffAttendance
