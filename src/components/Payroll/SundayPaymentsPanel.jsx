import { useEffect, useMemo, useState } from 'react'
import { confirmSundayWorkRequest, getPayrollOperationsDataRequest, markSundayPaymentPaidRequest } from '../../api/payrollOperationsApi'
import { getErrorMessage } from '../../api/axios'
import { currentBusinessDate } from '../../utils/payrollCalculations'
import { formatPayrollMoney } from '../../utils/payrollCurrency'
import { useTranslation } from '../../i18n/LanguageContext'
import Table from '../Table/Table'

const isSunday = (value) => value && new Date(`${value}T12:00:00`).getDay() === 0

export default function SundayPaymentsPanel() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [workerId, setWorkerId] = useState('')
  const [workDate, setWorkDate] = useState('')
  const [note, setNote] = useState('')

  const load = async () => {
    setLoading(true)
    try { setData(await getPayrollOperationsDataRequest()); setError('') }
    catch (requestError) { setError(getErrorMessage(requestError)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const workers = useMemo(() => (data?.workers || []).filter((worker) => worker.is_active !== false && ['weekly', 'monthly'].includes(worker.payment_type)), [data])
  const workerById = useMemo(() => new Map(workers.map((worker) => [String(worker.id), worker])), [workers])
  const payments = useMemo(() => (data?.sundayPayments || []).map((payment) => ({ ...payment, worker: workerById.get(String(payment.worker_id)) || null })), [data, workerById])
  const summaries = useMemo(() => {
    const groups = new Map()
    payments.forEach((payment) => {
      const group = groups.get(payment.currency_code) || { currency: payment.currency_code, count: 0, total: 0, paid: 0, unpaid: 0 }
      const amount = Number(payment.amount || 0)
      group.count += 1; group.total += amount
      if (payment.payment_status === 'paid') group.paid += amount
      else group.unpaid += amount
      groups.set(payment.currency_code, group)
    })
    return [...groups.values()]
  }, [payments])

  const confirmWork = async (event) => {
    event.preventDefault(); setError(''); setMessage('')
    if (!workerId || !isSunday(workDate) || workDate > currentBusinessDate()) { setError(t('payroll.sundayInvalid')); return }
    setSaving(true)
    try {
      await confirmSundayWorkRequest({ workerId, workDate, note })
      setWorkerId(''); setWorkDate(''); setNote(''); setMessage(t('payroll.sundayConfirmed')); await load()
    } catch (requestError) { setError(getErrorMessage(requestError)) }
    finally { setSaving(false) }
  }

  const markPaid = async (payment) => {
    if (!window.confirm(t('payroll.sundayPaidConfirmation'))) return
    setSaving(true); setError(''); setMessage('')
    try { await markSundayPaymentPaidRequest(payment.id); setMessage(t('payroll.sundayMarkedPaid')); await load() }
    catch (requestError) { setError(getErrorMessage(requestError)) }
    finally { setSaving(false) }
  }

  const money = (amount, currency, paymentType = null) => formatPayrollMoney(amount, { currency, paymentType })
  const columns = [
    { key: 'worker', header: t('payroll.worker'), render: (row) => row.worker?.full_name || row.worker_id },
    { key: 'date', header: t('payroll.sundayDate'), render: (row) => row.work_date },
    { key: 'type', header: t('payroll.paymentType'), render: (row) => t(`payroll.${row.payment_type_snapshot}`) },
    { key: 'daily', header: t('payroll.dailyValue'), render: (row) => money(row.daily_value, row.currency_code, row.payment_type_snapshot) },
    { key: 'multiplier', header: t('payroll.sundayMultiplier'), render: (row) => `×${row.multiplier}` },
    { key: 'amount', header: t('payroll.amount'), render: (row) => money(row.amount, row.currency_code, row.payment_type_snapshot) },
    { key: 'status', header: t('common.status'), render: (row) => row.payment_status === 'paid' ? t('payroll.sundayPaid') : row.settled_payroll_run_id ? t('payroll.sundayIncludedInPayroll') : t('payroll.sundayUnpaid') },
    { key: 'paidAt', header: t('payroll.paidDate'), render: (row) => row.paid_at ? new Date(row.paid_at).toLocaleDateString() : '—' },
    { key: 'note', header: t('attendance.notes'), render: (row) => row.note || '—' },
    { key: 'action', header: t('common.actions'), render: (row) => row.payment_status === 'unpaid' && !row.settled_payroll_run_id ? <button className="btn-primary px-3 py-1" disabled={saving} onClick={() => markPaid(row)}>{t('payroll.sundayMarkPaid')}</button> : null },
  ]

  if (data && !data.sundayPaymentsAvailable) return <p className="rounded bg-amber-50 p-4 text-amber-900">{t('payroll.sundayMigrationRequired')}</p>
  return <section>
    {error ? <p className="mb-3 rounded bg-red-50 p-3 text-red-700">{error}</p> : null}
    {message ? <p className="mb-3 rounded bg-emerald-50 p-3 text-emerald-700">{message}</p> : null}
    <form className="surface-card mb-4 grid gap-3 p-4 md:grid-cols-4" onSubmit={confirmWork}>
      <select className="input-base" required value={workerId} onChange={(event) => setWorkerId(event.target.value)}><option value="">{t('payroll.chooseWorker')}</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.full_name} · {t(`payroll.${worker.payment_type}`)}</option>)}</select>
      <input className="input-base" type="date" required max={currentBusinessDate()} value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
      <input className="input-base" placeholder={t('attendance.notes')} value={note} onChange={(event) => setNote(event.target.value)} />
      <button className="btn-primary" disabled={saving}>{t('payroll.sundayConfirmWork')}</button>
    </form>
    <div className="mb-4 grid gap-3 md:grid-cols-2">{summaries.map((summary) => <div className="surface-card grid gap-2 p-4 sm:grid-cols-2" key={summary.currency}><p>{t('payroll.sundayDays')}: <strong>{summary.count}</strong></p><p>{t('payroll.sundayTotal')}: <strong>{money(summary.total, summary.currency)}</strong></p><p>{t('payroll.sundayPaidTotal')}: <strong>{money(summary.paid, summary.currency)}</strong></p><p>{t('payroll.sundayUnpaidTotal')}: <strong>{money(summary.unpaid, summary.currency)}</strong></p></div>)}</div>
    <Table columns={columns} data={payments} loading={loading} emptyMessage={t('payroll.sundayEmpty')} />
  </section>
}
