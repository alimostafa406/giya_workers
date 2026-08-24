import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../api/axios'
import { getPayrollSettingsWorkersRequest, localIsoDate, saveWorkerPayrollSettingsRequest } from '../api/payrollSettingsApi'
import Modal from '../components/Modal/Modal'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import PayrollOperations from '../components/Payroll/PayrollOperations'
import PayrollHistory from '../components/Payroll/PayrollHistory'
import MonthlyPayrollOperations from '../components/Payroll/MonthlyPayrollOperations'
import SundayPaymentsPanel from '../components/Payroll/SundayPaymentsPanel'

const toDateInput = (value) => value || localIsoDate()
const displayValue = (value) => value == null || value === '' ? '-' : value

const lastDayOfMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate()

const anniversary = (year, monthIndex, anchorDay) => new Date(year, monthIndex, Math.min(anchorDay, lastDayOfMonth(year, monthIndex)))
const formatDate = (date) => date.toLocaleDateString()

const monthlyCycleSummary = (anchorValue) => {
  if (!anchorValue) return null
  const [year, month, day] = anchorValue.split('-').map(Number)
  if (!year || !month || !day) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let start = anniversary(today.getFullYear(), today.getMonth(), day)
  if (today < start) start = anniversary(today.getFullYear(), today.getMonth() - 1, day)
  const due = anniversary(start.getFullYear(), start.getMonth() + 1, day)
  const end = new Date(due)
  end.setDate(end.getDate() - 1)
  return { day, start, end, due }
}

function PayrollSettingsForm({ worker, onSave, saving }) {
  const { t } = useTranslation()
  const term = worker.payroll_compensation || {}
  const [values, setValues] = useState({
    payment_type: worker.payment_type || 'weekly',
    currency_code: term.currency_code || (worker.payment_type === 'monthly' ? 'USD' : 'CDF'),
    daily_rate: term.daily_rate ?? '',
    monthly_salary: worker.monthly_salary ?? term.monthly_salary ?? '',
    daily_transport_allowance: term.daily_transport_allowance ?? 0,
    overtime_rate_per_hour: term.overtime_rate_per_hour ?? '',
    overtime_start_time: term.overtime_start_time || '',
    monthly_payroll_cycle_start_date: term.monthly_payroll_cycle_start_date || '',
    effective_from: localIsoDate(),
  })

  const isMonthly = values.payment_type === 'monthly'
  const cycle = monthlyCycleSummary(values.monthly_payroll_cycle_start_date)
  const update = (name) => (event) => setValues((current) => ({ ...current, [name]: event.target.value }))

  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(values) }}>
    <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-(--muted)">{worker.full_name} · {worker.team_name || '-'}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">{t('payroll.paymentType')}<select className="input-base mt-1" value={values.payment_type} onChange={(event) => setValues((current) => ({ ...current, payment_type: event.target.value, currency_code: event.target.value === 'monthly' ? 'USD' : 'CDF' }))}><option value="weekly">{t('payroll.weekly')}</option><option value="monthly">{t('payroll.monthly')}</option></select></label>
      <label className="text-sm font-semibold">{t('payroll.currency')}<input className="input-base mt-1" maxLength="3" value={values.currency_code} onChange={update('currency_code')} required /></label>
      <label className="text-sm font-semibold">{t('payroll.effectiveFrom')}<input type="date" min={localIsoDate()} className="input-base mt-1" value={values.effective_from} onChange={update('effective_from')} required /></label>
      <label className="text-sm font-semibold">{t('payroll.transport')}<input type="number" min="0" step="0.01" className="input-base mt-1" value={values.daily_transport_allowance} onChange={update('daily_transport_allowance')} required /></label>
      {isMonthly ? <label className="text-sm font-semibold">{t('payroll.monthlySalary')}<input type="number" min="0" step="0.01" className="input-base mt-1" value={values.monthly_salary} onChange={update('monthly_salary')} required /></label> : <label className="text-sm font-semibold">{t('payroll.dailyRate')}<input type="number" min="0" step="0.01" className="input-base mt-1" value={values.daily_rate} onChange={update('daily_rate')} required /></label>}
      <label className="text-sm font-semibold">{t('payroll.overtimeRate')}<input type="number" min="0" step="0.01" className="input-base mt-1" value={values.overtime_rate_per_hour} onChange={update('overtime_rate_per_hour')} /></label>
      <label className="text-sm font-semibold">{t('payroll.overtimeStart')}<input type="time" className="input-base mt-1" value={values.overtime_start_time} onChange={update('overtime_start_time')} /></label>
      {isMonthly ? <label className="text-sm font-semibold">{t('payroll.cycleStart')}<input type="date" className="input-base mt-1" value={values.monthly_payroll_cycle_start_date} onChange={update('monthly_payroll_cycle_start_date')} required /></label> : null}
    </div>
    {isMonthly && cycle ? <div className="rounded-xl border border-(--border) bg-slate-50 p-3 text-sm"><p>{t('payroll.cycleDay')}: {cycle.day}</p><p>{t('payroll.currentPeriod')}: {formatDate(cycle.start)} — {formatDate(cycle.end)}</p><p>{t('payroll.nextDueDate')}: {formatDate(cycle.due)}</p></div> : null}
    <p className="text-xs text-(--muted)">{t('payroll.effectiveHelp')}</p>
    <button className="btn-primary" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
  </form>
}

function PayrollSettings() {
  const { t } = useTranslation()
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [missingOnly, setMissingOnly] = useState(false)
  const [selectedWorker, setSelectedWorker] = useState(null)

  const load = async () => { setLoading(true); setError(''); try { const result = await getPayrollSettingsWorkersRequest(); setWorkers(result.data) } catch (err) { setError(getErrorMessage(err)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])

  const teams = useMemo(() => [...new Map(workers.filter((worker) => worker.team?.id).map((worker) => [worker.team.id, worker.team])).values()], [workers])
  const needsConfiguration = (worker) => {
    const term = worker.payroll_compensation
    if (!term) return true
    if (worker.payment_type === 'weekly') return term.daily_rate == null
    return worker.monthly_salary == null || !term.monthly_payroll_cycle_start_date
  }
  const filtered = useMemo(() => workers.filter((worker) => {
    const haystack = `${worker.full_name || ''} ${worker.employee_code || ''} ${worker.team_name || ''}`.toLowerCase()
    return (!search || haystack.includes(search.toLowerCase()))
      && (paymentFilter === 'all' || worker.payment_type === paymentFilter)
      && (teamFilter === 'all' || worker.team_id === teamFilter)
      && (!missingOnly || needsConfiguration(worker))
  }), [workers, search, paymentFilter, teamFilter, missingOnly])

  const columns = [
    { key: 'name', header: t('common.worker'), render: (row) => <div><p className="font-bold">{row.full_name}</p><p className="text-xs text-(--muted)">{row.employee_code || '-'}</p></div> },
    { key: 'team', header: t('common.team'), render: (row) => row.team_name || '-' },
    { key: 'type', header: t('payroll.paymentType'), render: (row) => row.payment_type === 'monthly' ? t('payroll.monthly') : t('payroll.weekly') },
    { key: 'currency', header: t('payroll.currency'), render: (row) => row.payroll_compensation?.currency_code || '-' },
    { key: 'configuration', header: t('payroll.configuration'), render: (row) => needsConfiguration(row) ? <span className="status-badge status-badge--warning">{t('payroll.needsConfiguration')}</span> : <span className="status-badge status-badge--success">{t('payroll.configured')}</span> },
    { key: 'action', header: t('common.actions'), render: (row) => <button className="btn-secondary px-3 py-1" onClick={() => setSelectedWorker(row)}>{t('common.edit')}</button> },
  ]

  const save = async (values) => { if (!selectedWorker) return; setSaving(true); setError(''); try { await saveWorkerPayrollSettingsRequest(selectedWorker, values); setSelectedWorker(null); await load() } catch (err) { setError(getErrorMessage(err)) } finally { setSaving(false) } }

  return <section>
    <div className="mb-5"><h2 className="text-xl font-extrabold">{t('payroll.settingsTitle')}</h2><p className="mt-1 text-sm text-(--muted)">{t('payroll.settingsDescription')}</p></div>
    {error ? <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    <div className="surface-card mb-4 grid gap-3 p-4 md:grid-cols-4"><input type="search" className="input-base" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('payroll.searchPlaceholder')} /><select className="input-base" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option value="all">{t('payroll.allPaymentTypes')}</option><option value="weekly">{t('payroll.weekly')}</option><option value="monthly">{t('payroll.monthly')}</option></select><select className="input-base" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="all">{t('common.allTeams')}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)} />{t('payroll.showMissing')}</label></div>
    <Table columns={columns} data={filtered} loading={loading} emptyMessage={t('common.noResults')} />
    <Modal isOpen={Boolean(selectedWorker)} title={t('payroll.editSettings')} onClose={() => !saving && setSelectedWorker(null)}>{selectedWorker ? <PayrollSettingsForm worker={selectedWorker} onSave={save} saving={saving} /> : null}</Modal>
  </section>
}

export default function Payroll() {
  const { t } = useTranslation()
  const [section, setSection] = useState('operations')
  return <section><div className="mb-4 flex flex-wrap gap-2"><button className={section === 'operations' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('operations')}>{t('payroll.operations')}</button><button className={section === 'monthly' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('monthly')}>{t('payroll.monthlyOperations')}</button><button className={section === 'sundays' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('sundays')}>{t('payroll.sundayWork')}</button><button className={section === 'settings' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('settings')}>{t('payroll.settingsTitle')}</button><button className={section === 'history' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('history')}>{t('payroll.payrollHistory')}</button></div>{section === 'operations' ? <PayrollOperations /> : section === 'monthly' ? <MonthlyPayrollOperations /> : section === 'sundays' ? <SundayPaymentsPanel /> : section === 'settings' ? <PayrollSettings /> : <PayrollHistory />}</section>
}
