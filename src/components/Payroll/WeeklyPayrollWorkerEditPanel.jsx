import { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal/Modal'
import { useTranslation } from '../../i18n/LanguageContext'
import { localIsoDate } from '../../api/payrollSettingsApi'
import { currentBusinessDate } from '../../utils/payrollCalculations'

const adjustmentTypes = ['bonus', 'deduction', 'advance', 'other']

export default function WeeklyPayrollWorkerEditPanel({ line, dates, hasDraft, saving, onClose, onSave }) {
  const { t, language } = useTranslation()
  const initialStatuses = useMemo(() => Object.fromEntries((line?.details || []).map((detail) => [detail.date, detail.status])), [line])
  const [statuses, setStatuses] = useState(initialStatuses)
  const [checkIns, setCheckIns] = useState({})
  const [overtimeHours, setOvertimeHours] = useState('0')
  const [transportAmount, setTransportAmount] = useState('0')
  const [adjustmentType, setAdjustmentType] = useState('bonus')
  const [adjustmentAmount, setAdjustmentAmount] = useState('')
  const [reason, setReason] = useState('')
  const [dailyRate, setDailyRate] = useState('')
  const [dailyTransportAllowance, setDailyTransportAllowance] = useState('')
  const [overtimeRate, setOvertimeRate] = useState('')
  const [overtimeStartTime, setOvertimeStartTime] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(localIsoDate())
  const [sundayWorked, setSundayWorked] = useState(false)

  useEffect(() => {
    setStatuses(initialStatuses)
    setCheckIns(Object.fromEntries((line?.details || []).map((detail) => [detail.date, String(detail.row?.check_in || '').slice(0, 5)])))
    setOvertimeHours(String(line?.overtimeHours || 0))
    setTransportAmount(String(line?.transportAmount || 0))
    setAdjustmentType('bonus')
    setAdjustmentAmount('')
    setReason('')
    setDailyRate(line?.term?.daily_rate ?? '')
    setDailyTransportAllowance(line?.term?.daily_transport_allowance ?? 0)
    setOvertimeRate(line?.term?.overtime_rate_per_hour ?? '')
    setOvertimeStartTime(line?.term?.overtime_start_time || '')
    setEffectiveFrom(localIsoDate())
    setSundayWorked(Boolean(line?.sundayPayment && line.sundayPayment.payment_status !== 'cancelled'))
  }, [initialStatuses, line])

  const locale = language === 'ar' ? 'ar' : language === 'fr' ? 'fr-FR' : 'en-US'
  const statusOptions = [['present', t('attendance.present')], ['half_day', t('attendance.halfDay')], ['absent', t('attendance.absent')]]
  const save = (event) => {
    event.preventDefault()
    onSave(line, {
      statuses, checkIns, overtimeHours, transportAmount, adjustmentType, adjustmentAmount, reason,
      sundayWorked, compensation: { dailyRate, dailyTransportAllowance, overtimeRate, overtimeStartTime, effectiveFrom },
    })
  }

  return <Modal isOpen={Boolean(line)} title={t('common.edit')} onClose={onClose}>
    {line ? <form className="space-y-4" onSubmit={save}>
      <div><p className="text-lg font-extrabold">{line.worker.full_name}</p><p className="text-sm text-(--muted)">{line.worker.employee_code || '—'}</p></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(() => {
          const payment = line.sundayPayment
          const isFuture = line.sundayDate > currentBusinessDate()
          const financiallyProcessed = payment?.payment_status === 'paid' || Boolean(payment?.settled_payroll_run_id)
          return <label className="rounded-lg border border-(--border) p-3 text-sm font-bold"><span>{new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${line.sundayDate}T12:00:00`))} · {line.sundayDate}</span>{isFuture ? <span className="input-base mt-1 block text-(--muted)">—</span> : <select className="input-base mt-1" value={sundayWorked ? 'present' : 'absent'} disabled={financiallyProcessed} onChange={(event) => setSundayWorked(event.target.value === 'present')}><option value="present">{t('attendance.present')}</option><option value="absent">{t('attendance.absent')}</option></select>}{payment && payment.payment_status !== 'cancelled' ? <div className="mt-2 space-y-1 font-normal"><p>{t('payroll.sundayValue')}: {payment.amount} {payment.currency_code}</p><p>{t('payroll.sundayPaymentStatus')}: {payment.payment_status === 'paid' ? t('payroll.sundayPaid') : payment.settled_payroll_run_id ? t('payroll.sundayIncludedInPayroll') : t('payroll.sundayUnpaid')}</p>{payment.paid_at ? <p>{t('payroll.paidDate')}: {new Date(payment.paid_at).toLocaleDateString()}</p> : null}{financiallyProcessed ? <p className="text-amber-700">{t('payroll.sundayProcessedCannotReverse')}</p> : null}</div> : null}</label>
        })()}
        {dates.map((date) => {
          const isFuture = line.details.find((detail) => detail.date === date)?.isFuture
          return <label key={date} className="text-sm font-bold"><span>{new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${date}T12:00:00`))}</span>{isFuture ? <span className="input-base mt-1 block text-(--muted)">—</span> : <><select className="input-base mt-1" value={statuses[date] || 'absent'} onChange={(event) => setStatuses((current) => ({ ...current, [date]: event.target.value }))}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{statuses[date] === 'half_day' ? <input className="input-base mt-1" type="time" required value={checkIns[date] || ''} onChange={(event) => setCheckIns((current) => ({ ...current, [date]: event.target.value }))} /> : null}</>}</label>
        })}
      </div>
      <section className="border-t border-(--border) pt-4">
        <h3 className="font-extrabold">{t('payroll.settingsTitle')}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">{t('payroll.dailyRate')}<input className="input-base mt-1" type="number" min="0" step="0.01" value={dailyRate} onChange={(event) => setDailyRate(event.target.value)} required /></label>
          <label className="text-sm font-bold">{t('payroll.transport')}<input className="input-base mt-1" type="number" min="0" step="0.01" value={dailyTransportAllowance} onChange={(event) => setDailyTransportAllowance(event.target.value)} required /></label>
          <label className="text-sm font-bold">{t('payroll.overtimeRate')}<input className="input-base mt-1" type="number" min="0" step="0.01" value={overtimeRate} onChange={(event) => setOvertimeRate(event.target.value)} /></label>
          <label className="text-sm font-bold">{t('payroll.overtimeStart')}<input className="input-base mt-1" type="time" value={overtimeStartTime} onChange={(event) => setOvertimeStartTime(event.target.value)} /></label>
          <label className="text-sm font-bold">{t('payroll.effectiveFrom')}<input className="input-base mt-1" type="date" min={localIsoDate()} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required /></label>
        </div>
        <p className="mt-2 text-xs text-(--muted)">{t('payroll.effectiveHelp')}</p>
      </section>
      <section className="border-t border-(--border) pt-4">
        <h3 className="font-extrabold">{t('payroll.adjustments')}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold">{t('payroll.candidateOvertimeHours')}<input className="input-base mt-1" type="number" min="0" step="0.01" value={overtimeHours} disabled={!hasDraft} onChange={(event) => setOvertimeHours(event.target.value)} /></label>
        <label className="text-sm font-bold">{t('payroll.transport')}<input className="input-base mt-1" type="number" step="0.01" value={transportAmount} disabled={!hasDraft} onChange={(event) => setTransportAmount(event.target.value)} /></label>
      </div>
      {!hasDraft ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t('payroll.adjustmentDraftRequired')}</p> : <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-bold">{t('payroll.adjustments')}<select className="input-base mt-1" value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value)}>{adjustmentTypes.map((type) => <option key={type} value={type}>{t(`payroll.adjustmentType_${type}`)}</option>)}</select></label><label className="text-sm font-bold">{t('payroll.amount')}<input className="input-base mt-1" type="number" step="0.01" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} /></label><label className="text-sm font-bold">{t('payroll.reason')}<input className="input-base mt-1" value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>}
      </section>
      <div className="flex flex-wrap gap-2"><button type="submit" className="btn-primary" disabled={saving}>{saving ? t('payroll.saving') : t('common.save')}</button><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>{t('common.cancel')}</button></div>
    </form> : null}
  </Modal>
}
