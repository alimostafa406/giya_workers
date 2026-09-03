import { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal/Modal'
import { useTranslation } from '../../i18n/LanguageContext'
import { localIsoDate } from '../../api/payrollSettingsApi'
import { currentBusinessDate, monthlyDailyValue } from '../../utils/payrollCalculations'
import { formatPayrollMoney } from '../../utils/payrollCurrency'

const adjustmentTypes = ['bonus', 'deduction', 'advance', 'other']

const latestTermForType = (line, paymentType) => (line?.worker?.payroll_compensation_terms || [])
  .filter((term) => term.payment_type === paymentType)
  .sort((left, right) => String(right.effective_from).localeCompare(String(left.effective_from)))[0] || null

export default function WeeklyPayrollWorkerEditPanel({ line, dates, hasDraft, saving, onClose, onSave, onMarkSundayPaid, onCorrectPaidSunday }) {
  const { t, language } = useTranslation()
  const initialStatuses = useMemo(() => Object.fromEntries((line?.details || []).map((detail) => [detail.date, detail.status])), [line])
  const [statuses, setStatuses] = useState(initialStatuses)
  const [checkIns, setCheckIns] = useState({})
  const [overtimeHours, setOvertimeHours] = useState('0')
  const [transportAmount, setTransportAmount] = useState('0')
  const [adjustmentType, setAdjustmentType] = useState('bonus')
  const [adjustmentAmount, setAdjustmentAmount] = useState('')
  const [reason, setReason] = useState('')
  const [paymentType, setPaymentType] = useState('weekly')
  const [currencyCode, setCurrencyCode] = useState('')
  const [dailyRate, setDailyRate] = useState('')
  const [monthlySalary, setMonthlySalary] = useState('')
  const [monthlyCycleStart, setMonthlyCycleStart] = useState('')
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
    setPaymentType(line?.worker?.payment_type || line?.paymentType || 'weekly')
    setCurrencyCode(line?.term?.currency_code || line?.currency || '')
    setDailyRate(line?.term?.daily_rate ?? '')
    setMonthlySalary(line?.term?.monthly_salary ?? line?.worker?.monthly_salary ?? '')
    setMonthlyCycleStart(line?.term?.monthly_payroll_cycle_start_date || '')
    setDailyTransportAllowance(line?.term?.daily_transport_allowance ?? 0)
    setOvertimeRate(line?.term?.overtime_rate_per_hour ?? '')
    setOvertimeStartTime(line?.term?.overtime_start_time || '')
    setEffectiveFrom(localIsoDate())
    setSundayWorked(Boolean(line?.sundayPayment && line.sundayPayment.payment_status !== 'cancelled'))
  }, [initialStatuses, line])

  const locale = language === 'ar' ? 'ar' : language === 'fr' ? 'fr-FR' : 'en-US'
  const monthlyDivisor = Number(line?.rules?.monthly_working_day_divisor || 26)
  const derivedDailyValue = paymentType === 'monthly' ? monthlyDailyValue(monthlySalary, monthlyDivisor) : null
  const statusOptions = [['not_recorded', t('dashboard.notRecorded'), true], ['present', t('attendance.present'), false], ['late', t('attendance.late'), false], ['half_day', t('attendance.halfDay'), false], ['absent', t('attendance.absent'), false]]
  const selectPaymentType = (nextType) => {
    const savedTerm = latestTermForType(line, nextType)
    setPaymentType(nextType)
    setDailyRate(nextType === 'weekly' ? savedTerm?.daily_rate ?? '' : '')
    setMonthlySalary(nextType === 'monthly' ? savedTerm?.monthly_salary ?? line?.worker?.monthly_salary ?? '' : '')
    setMonthlyCycleStart(nextType === 'monthly' ? savedTerm?.monthly_payroll_cycle_start_date || '' : '')
    setDailyTransportAllowance(savedTerm?.daily_transport_allowance ?? line?.term?.daily_transport_allowance ?? 0)
    setOvertimeRate(savedTerm?.overtime_rate_per_hour ?? line?.term?.overtime_rate_per_hour ?? '')
    setOvertimeStartTime(savedTerm?.overtime_start_time || line?.term?.overtime_start_time || '')
  }
  const save = (event) => {
    event.preventDefault()
    onSave(line, {
      statuses, checkIns, overtimeHours, transportAmount, adjustmentType, adjustmentAmount, reason,
      sundayWorked, compensation: { paymentType, currencyCode, dailyRate, monthlySalary, monthlyCycleStart, dailyTransportAllowance, overtimeRate, overtimeStartTime, effectiveFrom },
    })
  }

  return <Modal isOpen={Boolean(line)} title={t('common.edit')} onClose={onClose}>
    {line ? <form className="space-y-4" onSubmit={save}>
      <div><p className="text-lg font-extrabold">{line.worker.full_name}</p><p className="text-sm text-(--muted)">{line.worker.employee_code || '—'}</p></div>
      <fieldset className="rounded-xl border-2 border-(--primary) bg-blue-50/40 p-4">
        <legend className="px-2 text-base font-extrabold">{t('payroll.paymentType')}</legend>
        <div className="grid grid-cols-2 gap-3">
          {['weekly', 'monthly'].map((type) => <button key={type} type="button" className={paymentType === type ? 'btn-primary' : 'btn-secondary'} onClick={() => selectPaymentType(type)}>{t(`payroll.${type}`)}</button>)}
        </div>
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(() => {
          const payment = line.sundayPayment
          const isFuture = line.sundayDate > currentBusinessDate()
          const financiallyProcessed = payment?.payment_status === 'paid' || Boolean(payment?.settled_payroll_run_id)
          return <label className="rounded-lg border border-(--border) p-3 text-sm font-bold"><span>{new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${line.sundayDate}T12:00:00`))} · {line.sundayDate}</span>{isFuture ? <span className="input-base mt-1 block text-(--muted)">—</span> : <select className="input-base mt-1" value={sundayWorked ? 'present' : 'absent'} disabled={financiallyProcessed} onChange={(event) => setSundayWorked(event.target.value === 'present')}><option value="present">{t('attendance.present')}</option><option value="absent">{t('attendance.absent')}</option></select>}{payment && payment.payment_status !== 'cancelled' ? <div className="mt-2 space-y-1 font-normal"><p>{t('payroll.sundayValue')}: {payment.amount} {payment.currency_code}</p><p>{t('payroll.sundayPaymentStatus')}: {payment.payment_status === 'paid' ? t('payroll.sundayPaid') : payment.settled_payroll_run_id ? t('payroll.sundayIncludedInPayroll') : t('payroll.sundayUnpaid')}</p>{payment.paid_at ? <p>{t('payroll.paidDate')}: {new Date(payment.paid_at).toLocaleString(locale)}</p> : null}{payment.payment_status === 'unpaid' && !payment.settled_payroll_run_id ? <button type="button" className="btn-secondary mt-2 px-3 py-1" disabled={saving} onClick={() => onMarkSundayPaid(payment)}>{t('payroll.sundayMarkPaid')}</button> : null}{payment.payment_status === 'paid' ? <button type="button" className="btn-secondary mt-2 px-3 py-1" disabled={saving} onClick={() => onCorrectPaidSunday(payment)}>{t('payroll.sundayCorrectRegistration')}</button> : null}{financiallyProcessed && payment.payment_status !== 'paid' ? <p className="text-amber-700">{t('payroll.sundayProcessedCannotReverse')}</p> : null}</div> : null}</label>
        })()}
        {dates.map((date) => {
          const isFuture = line.details.find((detail) => detail.date === date)?.isFuture
          return <label key={date} className="text-sm font-bold"><span>{new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${date}T12:00:00`))}</span>{isFuture ? <span className="input-base mt-1 block text-(--muted)">—</span> : <><select className="input-base mt-1" value={statuses[date] || 'absent'} onChange={(event) => setStatuses((current) => ({ ...current, [date]: event.target.value }))}>{statusOptions.map(([value, label, disabled]) => <option key={value} value={value} disabled={disabled}>{label}</option>)}</select>{statuses[date] === 'half_day' || statuses[date] === 'late' ? <input className="input-base mt-1" type="time" required value={checkIns[date] || ''} onChange={(event) => setCheckIns((current) => ({ ...current, [date]: event.target.value }))} /> : null}</>}</label>
        })}
      </div>
      <section className="border-t border-(--border) pt-4">
        <h3 className="font-extrabold">{t('payroll.settingsTitle')}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">{t('payroll.currency')}<select className="input-base mt-1" value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)} required><option value="">—</option><option value="CDF">CDF</option><option value="USD">USD</option></select></label>
          {paymentType === 'weekly' ? <label className="text-sm font-bold">{t('payroll.dailyRate')}<input className="input-base mt-1" type="number" min="0" step="0.01" value={dailyRate} onChange={(event) => setDailyRate(event.target.value)} required /></label> : <>
            <label className="text-sm font-bold">{t('payroll.monthlySalary')}<input className="input-base mt-1" type="number" min="0" step="0.01" value={monthlySalary} onChange={(event) => setMonthlySalary(event.target.value)} required /></label>
            <label className="text-sm font-bold">{t('payroll.cycleStart')}<input className="input-base mt-1" type="date" value={monthlyCycleStart} onChange={(event) => setMonthlyCycleStart(event.target.value)} required /></label>
          </>}
          <label className="text-sm font-bold">{t('payroll.transport')}<input className="input-base mt-1" type="number" min="0" step="0.01" value={dailyTransportAllowance} onChange={(event) => setDailyTransportAllowance(event.target.value)} required /></label>
          <label className="text-sm font-bold">{t('payroll.overtimeRate')}<input className="input-base mt-1" type="number" min="0" step="0.01" value={overtimeRate} onChange={(event) => setOvertimeRate(event.target.value)} /></label>
          <label className="text-sm font-bold">{t('payroll.overtimeStart')}<input className="input-base mt-1" type="time" value={overtimeStartTime} onChange={(event) => setOvertimeStartTime(event.target.value)} /></label>
          <label className="text-sm font-bold">{t('payroll.effectiveFrom')}<input className="input-base mt-1" type="date" min={localIsoDate()} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required /></label>
        </div>
        {paymentType === 'monthly' && derivedDailyValue != null ? <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm"><p className="font-bold">{t('payroll.derivedDailyValue')}: {formatPayrollMoney(derivedDailyValue, { currency: currencyCode, paymentType: 'monthly' })}</p><p className="mt-1 text-xs text-(--muted)">{t('payroll.derivedDailyValueHelp', { divisor: monthlyDivisor })}</p></div> : null}
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
