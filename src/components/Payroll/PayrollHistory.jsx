import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../../api/axios'
import { getPayrollOperationsDataRequest } from '../../api/payrollOperationsApi'
import { exportPayrollExcel, printPayrollReport } from '../../utils/payrollExports'
import { formatPayrollMoney } from '../../utils/payrollCurrency'
import { useTranslation } from '../../i18n/LanguageContext'
import Table from '../Table/Table'

const statusLabel = (status, t) => ({
  draft: t('payroll.statusDraft'), reviewed: t('payroll.statusReviewed'), finalized: t('payroll.statusFinalized'), paid: t('payroll.statusPaid'),
}[status] || status)

const dateValue = (value) => value ? new Date(value).toLocaleDateString() : '—'

export default function PayrollHistory() {
  const { t, direction, language } = useTranslation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [year, setYear] = useState('all')
  const [status, setStatus] = useState('all')
  const [paymentType, setPaymentType] = useState('weekly')
  const [selectedRunId, setSelectedRunId] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const load = async () => { setLoading(true); try { const result = await getPayrollOperationsDataRequest(); setData(result); setError('') } catch (e) { setError(getErrorMessage(e)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])

  const runs = useMemo(() => (data?.runs || []).filter((run) => {
    const matchesYear = year === 'all' || String(run.scheduled_payment_date || '').startsWith(year)
    return (status === 'all' || run.status === status) && (paymentType === 'all' || run.payment_type === paymentType) && matchesYear
  }), [data, paymentType, status, year])
  const years = useMemo(() => [...new Set((data?.runs || []).map((run) => String(run.scheduled_payment_date || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [data])
  const linesForRun = useMemo(() => (data?.payrollLines || []).filter((line) => line.payroll_run_id === selectedRunId), [data, selectedRunId])
  const selectedRun = useMemo(() => (data?.runs || []).find((run) => run.id === selectedRunId) || null, [data, selectedRunId])
  const workerById = useMemo(() => new Map((data?.workers || []).map((worker) => [String(worker.id), worker])), [data])
  const teamGroups = useMemo(() => {
    const groups = new Map()
    linesForRun.forEach((line) => {
      const worker = workerById.get(String(line.worker_id))
      const id = String(worker?.team_id || 'unassigned')
      const group = groups.get(id) || { id, name: worker?.team_name || t('common.unknown'), lines: [] }
      group.lines.push({ ...line, worker })
      groups.set(id, group)
    })
    return [...groups.values()].map((group) => ({ ...group, total: group.lines.reduce((sum, line) => sum + Number(line.final_amount || 0), 0) }))
  }, [linesForRun, t, workerById])
  const selectedTeam = teamGroups.find((team) => team.id === selectedTeamId) || null
  const money = (amount) => formatPayrollMoney(amount, { currency: selectedRun?.currency_code, paymentType: selectedRun?.payment_type })
  const total = linesForRun.reduce((sum, line) => sum + Number(line.final_amount || 0), 0)

  const runColumns = [
    { key: 'period', header: t('payroll.payrollPeriod'), render: (run) => run.payment_type === 'weekly' ? `${run.weekly_period_start} → ${run.weekly_period_end}` : '—' },
    { key: 'date', header: t('payroll.paymentDueDate'), render: (run) => run.scheduled_payment_date },
    { key: 'status', header: t('common.status'), render: (run) => statusLabel(run.status, t) },
    { key: 'currency', header: t('payroll.currency'), render: (run) => run.currency_code },
    { key: 'workers', header: t('payroll.workerCount'), render: (run) => (data?.payrollLines || []).filter((line) => line.payroll_run_id === run.id).length },
    { key: 'total', header: t('payroll.finalPay'), render: (run) => formatPayrollMoney((data?.payrollLines || []).filter((line) => line.payroll_run_id === run.id).reduce((sum, line) => sum + Number(line.final_amount || 0), 0), { currency: run.currency_code, paymentType: run.payment_type }) },
    { key: 'created', header: t('payroll.createdDate'), render: (run) => dateValue(run.created_at) },
    { key: 'reviewed', header: t('payroll.reviewedDate'), render: (run) => dateValue(run.reviewed_at) },
    { key: 'finalized', header: t('payroll.finalizedDate'), render: (run) => dateValue(run.finalized_at) },
    { key: 'paid', header: t('payroll.paidDate'), render: (run) => dateValue(run.paid_at) },
    { key: 'open', header: t('common.actions'), render: (run) => <button className="btn-secondary px-3 py-1" onClick={() => { setSelectedRunId(run.id); setSelectedTeamId('') }}>{t('payroll.openHistoryRun')}</button> },
  ]
  const teamColumns = [{ key: 'team', header: t('common.team'), render: (team) => team.name }, { key: 'workers', header: t('payroll.workerCount'), render: (team) => team.lines.length }, { key: 'total', header: t('payroll.finalPay'), render: (team) => money(team.total) }, { key: 'open', header: t('common.actions'), render: (team) => <button className="btn-secondary px-3 py-1" onClick={() => setSelectedTeamId(team.id)}>{t('payroll.open')}</button> }]
  const lineColumns = [{ key: 'worker', header: t('payroll.worker'), render: (line) => line.worker_name_snapshot }, { key: 'present', header: t('payroll.presentDays'), render: (line) => line.present_days }, { key: 'half', header: t('payroll.halfDays'), render: (line) => line.half_days }, { key: 'absent', header: t('payroll.absentDays'), render: (line) => line.absent_days }, { key: 'base', header: t('payroll.attendanceWage'), render: (line) => money(line.base_amount) }, { key: 'transport', header: t('payroll.transport'), render: (line) => money(line.transport_amount) }, { key: 'overtime', header: t('payroll.candidateOvertimeHours'), render: (line) => line.overtime_hours }, { key: 'final', header: t('payroll.finalPay'), render: (line) => money(line.final_amount) }]
  const exportRun = (kind, lines, title) => {
    if (!selectedRun) return
    const headers = [t('payroll.worker'), t('payroll.presentDays'), t('payroll.halfDays'), t('payroll.absentDays'), t('payroll.attendanceWage'), t('payroll.transport'), t('payroll.candidateOvertimeHours'), t('payroll.finalPay')]
    const rows = lines.map((line) => [line.worker_name_snapshot, line.present_days, line.half_days, line.absent_days, line.base_amount, line.transport_amount, line.overtime_hours, line.final_amount])
    const totals = [[t('payroll.finalTeamPayrollTotal'), '', '', '', '', '', '', lines.reduce((sum, line) => sum + Number(line.final_amount || 0), 0)]]
    const config = { title, metadata: [`${t('common.status')}: ${statusLabel(selectedRun.status, t)}`, `${t('payroll.payrollPeriod')}: ${selectedRun.weekly_period_start} → ${selectedRun.weekly_period_end}`, `${t('payroll.paymentDueDate')}: ${selectedRun.scheduled_payment_date}`, `${t('payroll.currency')}: ${selectedRun.currency_code}`], headers, rows, totals, direction, sheetName: t('payroll.payrollHistory'), filename: `payroll-history-${selectedRun.id}` }
    if (kind === 'print') printPayrollReport(config)
    else exportPayrollExcel({ ...config, filename: `${config.filename}.xlsx` })
  }

  if (selectedRun) return <section>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><button className="btn-secondary" onClick={() => { setSelectedRunId(''); setSelectedTeamId('') }}>{t('payroll.back')}</button><span className="status-badge status-badge--neutral">{statusLabel(selectedRun.status, t)}</span></div>
    <div className="surface-card mb-3 grid gap-2 p-4 text-sm sm:grid-cols-3"><p><strong>{t('payroll.payrollPeriod')}:</strong> {selectedRun.weekly_period_start} → {selectedRun.weekly_period_end}</p><p><strong>{t('payroll.paymentDueDate')}:</strong> {selectedRun.scheduled_payment_date}</p><p className="font-extrabold"><strong>{t('payroll.finalPay')}:</strong> {money(total)}</p></div>
    {selectedTeam ? <><div className="mb-3 flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => setSelectedTeamId('')}>{t('payroll.back')}</button><button className="btn-secondary" onClick={() => exportRun('print', selectedTeam.lines, selectedTeam.name)}>{t('reports.print')}</button><button className="btn-secondary" onClick={() => exportRun('excel', selectedTeam.lines, selectedTeam.name)}>{t('reports.excel')}</button></div><Table columns={lineColumns} data={selectedTeam.lines} loading={false} emptyMessage={t('common.noRecords')} /><p className="mt-3 font-extrabold">{t('payroll.teamTotal')}: {money(selectedTeam.total)}</p></> : <><div className="mb-3 flex gap-2"><button className="btn-secondary" onClick={() => exportRun('print', linesForRun, t('payroll.allTeamsSummary'))}>{t('reports.print')}</button><button className="btn-secondary" onClick={() => exportRun('excel', linesForRun, t('payroll.allTeamsSummary'))}>{t('reports.excel')}</button></div><Table columns={teamColumns} data={teamGroups} loading={false} emptyMessage={t('common.noRecords')} /></>}
  </section>

  return <section>
    <h2 className="mb-4 text-xl font-extrabold">{t('payroll.payrollHistory')}</h2>
    {error ? <p className="mb-3 rounded bg-red-50 p-3 text-red-700">{error}</p> : null}
    <div className="surface-card mb-4 grid gap-3 p-4 md:grid-cols-3"><select className="input-base" value={year} onChange={(event) => setYear(event.target.value)}><option value="all">{t('payroll.year')}</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select><select className="input-base" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t('common.status')}</option>{['draft', 'reviewed', 'finalized', 'paid'].map((item) => <option key={item} value={item}>{statusLabel(item, t)}</option>)}</select><select className="input-base" value={paymentType} onChange={(event) => setPaymentType(event.target.value)}><option value="all">{t('payroll.paymentType')}</option><option value="weekly">{t('payroll.weekly')}</option><option value="monthly">{t('payroll.monthly')}</option></select></div>
    <Table columns={runColumns} data={runs} loading={loading} emptyMessage={t('payroll.noHistory')} />
  </section>
}
