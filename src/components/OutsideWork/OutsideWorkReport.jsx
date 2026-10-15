import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { getOutsideWorkMovements } from '../../api/outsideWorkApi'
import { getErrorMessage } from '../../api/axios'
import { useTranslation } from '../../i18n/LanguageContext'
import { kinshasaClock } from '../../utils/attendanceOperationalGate'
import { foremanKey, formatClock, formatDuration, hasOutsideWorkForeman, weekDays } from '../../utils/outsideWork'
import { outsideWorkDateLabel } from '../../utils/outsideWorkDateLabels'
import { outsideWorkReport } from '../../utils/outsideWorkReports'
import { searchOutsideWorkPeople } from '../../utils/outsideWorkRoster'
import { outsideWorkReportLabels } from './outsideWorkReportLabels'
import './OutsideWorkReport.css'

function Period({ from, to, language }) {
  return <bdi dir="ltr" className="outside-report-period"><bdi dir={language === 'ar' ? 'rtl' : 'ltr'}>{outsideWorkDateLabel(from, language, true)}</bdi>{' → '}<bdi dir={language === 'ar' ? 'rtl' : 'ltr'}>{outsideWorkDateLabel(to, language, true)}</bdi></bdi>
}

function Summary({ report, type, l }) {
  const metrics = [[l.days, report.dayCount], [l.movements, report.movementCount],
    ...(type === 'comprehensive' ? [[l.participations, report.participationCount]] : type === 'team' ? [[l.workerCount, report.workerCount]] : []),
    ...(type === 'worker' ? [] : [[l.overtime, formatDuration(report.totalOvertimeMinutes)]])]
  return <div className="foreman-report-summary outside-report-summary">{metrics.map(([label, value]) => <div key={label}><p>{label}</p><strong><bdi dir="ltr">{value}</bdi></strong></div>)}</div>
}

function ReportDetails({ report, workersById, language, l, print = false }) {
  const [expanded, setExpanded] = useState([])
  const clock = value => formatClock(value, { hour12: false })
  return report.groups.map(group => <section className="outside-report-day" key={group.date}>
    <h3>{outsideWorkDateLabel(group.date, language)}</h3>
    {group.movements.map(row => {
      const open = print || expanded.includes(row.id)
      return <article className="outside-report-movement" key={row.id}>
        <header><h4><bdi>{row.team_id ? row.team?.name || '—' : row.foreman_name || '—'}</bdi></h4>
          {!row.team_id && <span className="outside-work-status">{l.independent}</span>}
          <span className="outside-work-status">{row.status === 'draft' ? l.draftBadge : l.finalBadge}</span></header>
        <dl className="outside-report-facts">
          {row.team_id && <div><dt>{l.foremanName}</dt><dd><bdi>{row.foreman_name || '—'}</bdi></dd></div>}
          <div><dt>{l.foremanStart}</dt><dd><bdi dir="ltr">{clock(row.start_time)}</bdi></dd></div>
          <div><dt>{l.foremanEnd}</dt><dd><bdi dir="ltr">{clock(row.end_time)}</bdi></dd></div>
          <div><dt>{l.foremanOvertime}</dt><dd><bdi dir="ltr">{formatDuration(row.foremanOvertimeMinutes)}</bdi></dd></div>
          <div><dt>{l.workerTimes}</dt><dd><bdi dir="ltr">{clock(row.common_worker_start)} → {clock(row.common_worker_end)}</bdi></dd></div>
          <div><dt>{l.participations}</dt><dd>{row.participants.length}</dd></div>
        </dl>
        {!print && <button type="button" className="outside-work-text-action" aria-expanded={open} onClick={() => setExpanded(current => current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])}>{`${open ? l.hide : l.show} (${row.participants.length})`}</button>}
        {open && <div className="outside-work-table-scroll"><table className="outside-work-compact-table"><thead><tr>{[l.workerName, l.originalTeam, l.workerStart, l.workerEnd].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{row.participants.map(worker => <tr key={worker.worker_id}><td><bdi>{worker.worker_name}</bdi></td><td><bdi>{workersById.get(String(worker.worker_id))?.team_name || '—'}</bdi></td><td><bdi dir="ltr">{clock(worker.start_time)}</bdi></td><td><bdi dir="ltr">{clock(worker.end_time)}</bdi></td></tr>)}</tbody></table></div>}
      </article>
    })}
  </section>)
}

export default function OutsideWorkReport({ workers, teams, biometricIds }) {
  const { language } = useTranslation()
  const l = outsideWorkReportLabels[language] || outsideWorkReportLabels.en
  const today = kinshasaClock().date
  const [from, setFrom] = useState(today.slice(0, 8) + '01')
  const [to, setTo] = useState(today)
  const [type, setType] = useState('comprehensive')
  const [status, setStatus] = useState('final')
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [generated, setGenerated] = useState(() => new Date())
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
  useEffect(() => {
    let current = true
    setRows([]); setError('')
    if (!valid) { setLoading(false); return }
    setLoading(true)
    getOutsideWorkMovements(from, to, { reportStatus: status }).then(data => {
      if (current) { setRows(data); setLoading(false) }
    }).catch(cause => { if (current) { setError(getErrorMessage(cause)); setLoading(false) } })
    return () => { current = false }
  }, [from, to, status, valid, retry])
  const workersById = useMemo(() => new Map(workers.map(worker => [String(worker.id), worker])), [workers])
  const foremen = useMemo(() => [...new Map(rows.filter(hasOutsideWorkForeman).map(row => [foremanKey(row), row.foreman_name])).entries()], [rows])
  const people = useMemo(() => [...new Map(rows.flatMap(row => row.outside_work_movement_workers || []).map(worker => [String(worker.worker_id), {
    ...workersById.get(String(worker.worker_id)), id: String(worker.worker_id), full_name: worker.worker_name,
  }])).values()], [rows, workersById])
  const workerOptions = search ? searchOutsideWorkPeople(people, search, biometricIds).filter(worker => worker.id !== selected) : people.filter(worker => worker.id !== selected)
  const teamOptions = useMemo(() => [...new Map([...teams.map(team => [String(team.id), team.name]), ...workers.filter(worker => worker.team_id).map(worker => [String(worker.team_id), worker.team_name]), ...rows.filter(row => row.team_id).map(row => [String(row.team_id), row.team?.name || '—'])]).entries()].sort((a, b) => a[1].localeCompare(b[1])), [teams, workers, rows])
  const report = useMemo(() => outsideWorkReport(rows, { from, to, status, type, selected }, workersById), [rows, from, to, status, type, selected, workersById])
  const ready = valid && !loading && !error && (type === 'comprehensive' || Boolean(selected))
  const selectedName = type === 'foreman' ? foremen.find(([key]) => key === selected)?.[1] : type === 'worker' ? people.find(worker => worker.id === selected)?.full_name : type === 'team' ? teamOptions.find(([id]) => id === selected)?.[1] : ''
  const preset = name => {
    if (name === 'today') { setFrom(today); setTo(today) }
    else if (name === 'week') { const days = weekDays(today); setFrom(days[0]); setTo(days[6]) }
    else { setFrom(today.slice(0, 8) + '01'); setTo(today) }
  }
  return <section id="outside-work-report-view" role="tabpanel" aria-labelledby="outside-work-report-tab" className="outside-work-report">
    <div className="outside-work-panel-heading"><h2>{l.title}</h2></div>
    <div className="outside-report-toolbar">
      <label>{l.type}<select aria-label={l.type} value={type} onChange={event => { setType(event.target.value); setSelected(''); setSearch('') }}>{['comprehensive', 'foreman', 'worker', 'team'].map(key => <option key={key} value={key}>{l[key]}</option>)}</select></label>
      <label>{l.from}<input type="date" aria-label={l.from} value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>{l.to}<input type="date" aria-label={l.to} value={to} onChange={event => setTo(event.target.value)} /></label>
      <label>{l.status}<select aria-label={l.status} value={status} onChange={event => setStatus(event.target.value)}>{['final', 'draft', 'all'].map(key => <option key={key} value={key}>{l[key]}</option>)}</select></label>
      <button type="button" className="btn-primary" disabled={!ready || !report.rows.length} onClick={() => { flushSync(() => setGenerated(new Date())); window.print() }}>{l.print}</button>
    </div>
    <div className="outside-report-presets">{['today', 'week', 'month'].map(key => <button type="button" className="outside-work-text-action" key={key} onClick={() => preset(key)}>{l[key]}</button>)}</div>
    <p className="outside-report-period-caption"><Period from={from} to={to} language={language} /></p>
    {type === 'foreman' && <label className="outside-report-selector">{l.foremanName}<select aria-label={l.chooseForeman} value={selected} onChange={event => setSelected(event.target.value)}><option value="">{l.chooseForeman}</option>{foremen.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    {type === 'team' && <label className="outside-report-selector">{l.primaryTeam}<select aria-label={l.chooseTeam} value={selected} onChange={event => setSelected(event.target.value)}><option value="">{l.chooseTeam}</option>{teamOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    {type === 'worker' && <div className="outside-report-worker-filter"><label className="outside-report-selector">{l.search}<input aria-label={l.search} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="outside-report-selector">{l.chooseWorker}<select aria-label={l.chooseWorker} value={selected} onChange={event => setSelected(event.target.value)}><option value="">{l.chooseWorker}</option>{selected && <option value={selected}>{selectedName || selected}</option>}{workerOptions.slice(0, 50).map(worker => <option key={worker.id} value={worker.id}>{worker.full_name} · {worker.employee_code || '—'} · {biometricIds.get(worker.id) || '—'}</option>)}</select></label></div>}
    {!valid ? <p role="alert">{l.invalid}</p> : loading ? <p role="status">{l.loading}</p> : error ? <div role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>{l.retry}</button></div> : !ready ? <p className="outside-work-empty">{l.selection}</p> : <>
      <Summary report={report} type={type} l={l} />
      {report.rows.length ? <ReportDetails report={report} workersById={workersById} language={language} l={l} /> : <p className="outside-work-empty">{l.empty}</p>}
    </>}
    <section className="outside-work-print" aria-hidden="true">
      {ready && <><h1>{l.title}</h1><h2>{l[type]}{selectedName ? ` — ${selectedName}` : ''}</h2><p><Period from={from} to={to} language={language} /></p>
        <p>{l.status}: {l[status]}</p><p>{l.generated}: {new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Kinshasa' }).format(generated)}</p>
        <Summary report={report} type={type} l={l} /><ReportDetails report={report} workersById={workersById} language={language} l={l} print /></>}
    </section>
  </section>
}
