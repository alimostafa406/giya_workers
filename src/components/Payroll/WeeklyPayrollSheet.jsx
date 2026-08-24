import { useTranslation } from '../../i18n/LanguageContext'
import { formatPayrollMoney } from '../../utils/payrollCurrency'
import Table from '../Table/Table'

const dayLabel = (date, language) => new Intl.DateTimeFormat(
  language === 'ar' ? 'ar' : language === 'fr' ? 'fr-FR' : 'en-US',
  { weekday: 'short' },
).format(new Date(`${date}T12:00:00`))

const statusLabel = (status, t) => ({
  future: '—',
  present: t('attendance.present'),
  half_day: t('attendance.halfDay'),
  absent: t('attendance.absent'),
  pending: t('attendance.pending'),
  in_progress: t('attendance.inProgress'),
}[status] || '—')

export default function WeeklyPayrollSheet({ lines, dates, onEdit, editable = true }) {
  const { t, language } = useTranslation()
  const money = (amount, line) => formatPayrollMoney(amount, { currency: line.currency, paymentType: 'weekly' })
  const columns = [
    { key: 'worker', header: t('payroll.worker'), render: (line) => <div><p className="font-bold">{line.worker.full_name}</p><p className="text-xs text-(--muted)">{line.worker.employee_code || '—'}</p></div> },
    ...dates.map((date) => ({ key: date, header: dayLabel(date, language), render: (line) => statusLabel(line.details.find((item) => item.date === date)?.status, t) })),
    { key: 'attendance', header: t('payroll.presentDays'), render: (line) => line.presentDays + (line.halfDays * 0.5) },
    { key: 'dailyRate', header: t('payroll.dailyRate'), render: (line) => money(line.term?.daily_rate, line) },
    { key: 'attendanceWage', header: t('payroll.attendanceWage'), render: (line) => money(line.attendanceWage, line) },
    { key: 'overtimeHours', header: t('payroll.candidateOvertimeHours'), render: (line) => `${line.overtimeHours || 0} ${t('payroll.hoursShort')}` },
    { key: 'transport', header: t('payroll.transport'), render: (line) => money(line.transportAmount, line) },
    { key: 'final', header: t('payroll.finalPay'), render: (line) => <span className="font-extrabold">{money(line.finalAmount, line)}</span> },
    ...(editable ? [{ key: 'actions', header: t('common.actions'), render: (line) => <button type="button" className="btn-secondary px-3 py-1" onClick={() => onEdit(line.worker.id)}>{t('common.edit')}</button> }] : []),
  ]

  return <Table columns={columns} data={lines} loading={false} emptyMessage={t('payroll.noWorkers')} payrollSheet />
}
