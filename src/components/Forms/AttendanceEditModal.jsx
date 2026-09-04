import { useEffect, useState } from 'react'
import { getAttendanceTimeInputValue } from '../../api/attendanceApi'
import Modal from '../Modal/Modal'
import { useTranslation } from '../../i18n/LanguageContext'

function AttendanceEditModal({ row, isOpen, isSaving, onClose, onSave }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState('present')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')

  useEffect(() => {
    if (!row) return
    setStatus(row.status === 'late' ? (row.check_out ? 'present' : 'half_day') : row.status || 'present')
    setCheckIn(getAttendanceTimeInputValue(row.check_in))
    setCheckOut(getAttendanceTimeInputValue(row.check_out))
  }, [row])

  const hasCheckIn = status === 'present' || status === 'half_day' || status === 'in_progress'
  const hasCheckOut = status === 'present'
  const submit = (event) => {
    event.preventDefault()
    onSave({ status, check_in: checkIn, check_out: checkOut })
  }

  const statusOptions = [['present', t('attendance.present')], ['half_day', t('attendance.halfDay')], ['in_progress', t('attendance.inProgress')], ['pending', t('attendance.pending')], ['absent', t('attendance.absent')]]

  return <Modal isOpen={isOpen} title={t('attendance.manualCorrection')} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-(--muted)">{row?.worker?.full_name || row?.worker_name || t('attendance.worker')} · {row?.attendance_date || row?.date}</p>
      <label className="block text-sm font-bold">{t('attendance.status')}<select className="input-base mt-2" value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {hasCheckIn ? <label className="block text-sm font-bold">{t('attendance.checkIn')}<input type="time" required={status === 'half_day'} className="input-base mt-2" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></label> : null}
      {hasCheckOut ? <label className="block text-sm font-bold">{t('attendance.checkOut')}<input type="time" className="input-base mt-2" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></label> : null}
      {status === 'absent' ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t('attendance.absentTimesNotice')}</p> : null}
      <div className="flex flex-wrap gap-2"><button type="submit" className="btn-primary" disabled={isSaving}>{isSaving ? t('common.saving') : t('attendance.correctionSaved')}</button><button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button></div>
    </form>
  </Modal>
}

export default AttendanceEditModal
