import Modal from '../Modal/Modal'
import Table from '../Table/Table'
import { useTranslation } from '../../i18n/LanguageContext'
import { formatPayrollMoney } from '../../utils/payrollCurrency'
import PayrollAdjustmentsSection from './PayrollAdjustmentsSection'

const statusLabel = (status, t) => ({
  present: t('attendance.present'),
  late: t('attendance.late'),
  half_day: t('attendance.halfDay'),
  absent: t('attendance.absent'),
  pending: t('attendance.pending'),
  in_progress: t('attendance.inProgress'),
}[status] || status || '—')

const sunday = (date) => new Date(`${date}T12:00:00`).getDay() === 0

function roundingLabel(rules, t) {
  if (!rules?.overtime_rounding_minutes || !rules?.overtime_rounding_mode) return null
  const mode = {
    up: t('payroll.roundUp'),
    down: t('payroll.roundDown'),
    nearest: t('payroll.roundNearest'),
  }[rules.overtime_rounding_mode] || rules.overtime_rounding_mode
  return t('payroll.roundingApplied', { minutes: rules.overtime_rounding_minutes, mode })
}

export default function PayrollWorkerAttendanceDetail({ line, payrollLine, adjustments, onClose, onEditAttendance, onCreateAdjustment, onVoidAdjustment, savingAdjustment }) {
  const { language, t } = useTranslation()
  const locale = language === 'ar' ? 'ar' : language === 'fr' ? 'fr-FR' : 'en-US'
  const rounding = roundingLabel(line?.rules, t)
  const money = (amount, currency) => formatPayrollMoney(amount, {
    currency,
    currencyCodeSnapshot: payrollLine?.currency_code_snapshot,
    compensationCurrency: line?.term?.currency_code,
    paymentType: line?.paymentType,
  })

  const columns = [
    { key: 'date', header: t('attendance.date'), render: (detail) => detail.date },
    { key: 'day', header: t('payroll.day'), render: (detail) => new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${detail.date}T12:00:00`)) },
    { key: 'status', header: t('attendance.status'), render: (detail) => statusLabel(detail.row?.status || detail.status, t) },
    { key: 'checkIn', header: t('attendance.checkIn'), render: (detail) => detail.row?.check_in || '—' },
    { key: 'checkOut', header: t('attendance.checkOut'), render: (detail) => detail.row?.check_out || '—' },
    { key: 'dailyRate', header: t('payroll.dailyRate'), render: () => money(line?.term?.daily_rate, line?.currency) },
    { key: 'wage', header: t('payroll.dailyWageEffect'), render: (detail) => money(detail.baseEffect, line?.currency) },
    { key: 'transportEligibility', header: t('payroll.transportEligibility'), render: (detail) => detail.transportEffect > 0 ? t('payroll.eligible') : '—' },
    { key: 'transport', header: t('payroll.transport'), render: (detail) => money(detail.transportEffect, line?.currency) },
    { key: 'overtimeStart', header: t('payroll.overtimeStart'), render: () => line?.term?.overtime_start_time || '—' },
    { key: 'overtimeHours', header: t('payroll.candidateOvertimeHours'), render: (detail) => detail.candidateOvertimeHours ? <div><span>{detail.candidateOvertimeHours} {t('payroll.hoursShort')}</span>{rounding ? <p className="text-xs text-(--muted)">{rounding}</p> : null}</div> : '—' },
    { key: 'overtimeRate', header: t('payroll.overtimeRate'), render: () => line?.term?.overtime_rate_per_hour ? money(line.term.overtime_rate_per_hour, line.currency) : '—' },
    { key: 'overtimeAmount', header: t('payroll.overtimeAmount'), render: (detail) => detail.candidateOvertimeHours && line?.term?.overtime_rate_per_hour ? money(detail.candidateOvertimeHours * Number(line.term.overtime_rate_per_hour), line.currency) : '—' },
    { key: 'dayType', header: t('payroll.holidaySunday'), render: (detail) => detail.isHoliday ? t('payroll.companyHoliday') : sunday(detail.date) ? t('payroll.sunday') : t('payroll.normalWorkday') },
    { key: 'manualOverride', header: t('payroll.manualOverride'), render: (detail) => detail.row?.manual_override ? t('payroll.manual') : t('payroll.automatic') },
    { key: 'note', header: t('attendance.notes'), render: (detail) => detail.row?.note || '—' },
    { key: 'edit', header: t('attendance.action'), render: (detail) => <button type="button" className="btn-secondary px-3 py-1" disabled={!detail.row} title={!detail.row ? t('payroll.noAttendanceRecord') : undefined} onClick={() => detail.row && onEditAttendance({ ...detail.row, worker: line.worker, worker_name: line.worker.full_name })}>{t('attendance.manualCorrection')}</button> },
  ]

  const summaries = [
    [t('payroll.presentDays'), line?.presentDays],
    [t('payroll.halfDays'), line?.halfDays],
    [t('payroll.absentDays'), line?.absentDays],
    [t('payroll.attendanceWage'), money(line?.attendanceWage, line?.currency)],
    [t('payroll.transport'), money(line?.transportAmount, line?.currency)],
    [t('payroll.overtime'), money(line?.overtimeAmount, line?.currency)],
    [t('payroll.holidaySunday'), money(line?.holidayAmount, line?.currency)],
    [t('payroll.bonuses'), money(line?.bonusAmount, line?.currency)],
    [t('payroll.deductions'), money(line?.deductionAmount, line?.currency)],
    [t('payroll.advances'), money(line?.advanceAmount, line?.currency)],
    [t('payroll.otherAdjustments'), money(line?.manualAdjustmentAmount, line?.currency)],
    [t('payroll.currentDraftFinalPay'), money(line?.finalAmount, line?.currency)],
  ]

  return <Modal isOpen={Boolean(line)} title={t('payroll.workerAttendanceDetail')} onClose={onClose}>
    {line ? <div className="space-y-4">
      <div><p className="text-lg font-extrabold">{line.worker.full_name}</p><p className="text-sm text-(--muted)">{line.worker.team_name || '—'} · {line.worker.employee_code || '—'}</p></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{summaries.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-(--muted)">{label}</p><p className="mt-1 font-extrabold">{value ?? 0}</p></div>)}</div>
      <Table columns={columns} data={line.details} loading={false} emptyMessage={t('common.noRecords')} />
      <PayrollAdjustmentsSection payrollLine={payrollLine} adjustments={adjustments || []} onCreate={onCreateAdjustment} onVoid={onVoidAdjustment} saving={savingAdjustment} />
    </div> : null}
  </Modal>
}
