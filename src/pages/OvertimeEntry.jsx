import { useEffect, useMemo, useState } from 'react'
import { getOvertimeEntryData, saveOvertimeEntry } from '../api/overtimeEntryApi'
import { clearWorkerControlDataCache } from '../api/workerControlData'
import { getErrorMessage } from '../api/axios'
import { useTranslation } from '../i18n/LanguageContext'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { weekDays } from '../utils/outsideWork'
import { outsideWorkDateLabel } from '../utils/outsideWorkDateLabels'
import { currentEntryOvertime, overtimeDuration, overtimeEntryBlock, overtimeEntryLabels, overtimeEntryWorkers, parseOvertimeDuration } from '../utils/overtimeEntry'
import './OvertimeEntry.css'
import WeeklyOvertimeEntry from './WeeklyOvertimeEntry'

export default function OvertimeEntry() {
  const [mode, setMode] = useState('daily')
  return <><nav className="overtime-week-strip" aria-label="طريقة إدخال الإضافي"><button type="button" aria-pressed={mode === 'daily'} onClick={() => setMode('daily')}>إدخال يومي</button><button type="button" aria-pressed={mode === 'weekly'} onClick={() => setMode('weekly')}>إجمالي أسبوعي</button></nav>{mode === 'weekly' ? <WeeklyOvertimeEntry /> : <DailyOvertimeEntry />}</>
}
function DailyOvertimeEntry() {
  const { language } = useTranslation()
  const l = overtimeEntryLabels[language] || overtimeEntryLabels.en
  const today = kinshasaClock().date
  const [date, setDate] = useState(today)
  const [teamId, setTeamId] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState([])
  const [values, setValues] = useState({})
  const [common, setCommon] = useState('2:00')
  const [applied, setApplied] = useState(0)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => {
    let current = true
    setLoading(true); setLoadError('')
    getOvertimeEntryData(date).then((next) => { if (current) setData(next) })
      .catch((cause) => { if (current) setLoadError(getErrorMessage(cause)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [date, reload])
  const ready = !loading && !loadError && data?.date === date
  const workers = useMemo(() => overtimeEntryWorkers(data?.workers || [], date), [data, date])
  const teams = useMemo(() => [...new Map(workers.map((worker) => [String(worker.team_id), {
    id: String(worker.team_id), name: worker.team?.name || worker.team_name,
  }])).values()].sort((a, b) => a.name.localeCompare(b.name)), [workers])
  const rows = useMemo(() => new Map((data?.attendance || []).map((row) => [String(row.worker_id), row])), [data])
  const locked = new Set(data?.lockedIds || [])
  const teamWorkers = workers.filter((worker) => String(worker.team_id) === teamId)
  const visible = teamWorkers.filter((worker) => !search.trim() || `${worker.full_name} ${worker.employee_code || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const blocked = (worker) => overtimeEntryBlock(rows.get(String(worker.id)), date, locked.has(String(worker.id)))
  const resetSelection = () => { setSelected([]); setValues({}); setPreview(null); setError(''); setApplied(0) }
  const changeDate = (next) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next > today || saving) return
    resetSelection(); setResult(null); setDate(next)
  }
  const selectTeam = (next) => { resetSelection(); setTeamId(next); setSearch('') }
  const selectedWorkers = teamWorkers.filter((worker) => selected.includes(String(worker.id)))
  const changeCommon = (value) => { setCommon(value); setApplied(0) }
  const applyCommon = () => {
    const minutes = parseOvertimeDuration(common)
    if (minutes == null) { setApplied(0); setError(l.invalid); return }
    const duration = overtimeDuration(minutes)
    const updates = Object.fromEntries(selectedWorkers.map((worker) => [String(worker.id), duration]))
    setValues((current) => ({ ...current, ...updates }))
    setCommon(duration); setApplied(selectedWorkers.length); setPreview(null); setError('')
  }
  const prepare = () => {
    if (!ready || !selectedWorkers.length || selectedWorkers.some((worker) => blocked(worker) || parseOvertimeDuration(values[worker.id]) == null)) { setError(l.invalid); return }
    const entries = selectedWorkers.map((worker) => ({ worker_id: worker.id,
      expected_updated_at: rows.get(String(worker.id)).updated_at, minutes: parseOvertimeDuration(values[worker.id]), name: worker.full_name }))
    setError(''); setPreview({ requestId: crypto.randomUUID(), date, teamName: teams.find((team) => team.id === teamId)?.name, entries })
  }
  const save = async () => {
    if (!preview || saving || !ready) return
    setSaving(true); setError('')
    try {
      const outcome = await saveOvertimeEntry({ requestId: preview.requestId, date: preview.date, entries: preview.entries })
      setResult({ ...outcome, date: preview.date, teamName: preview.teamName, names: Object.fromEntries(preview.entries.map((entry) => [entry.worker_id, entry.name])) })
      const applied = new Set((outcome.results || []).filter((item) => item.outcome === 'updated' || item.reason === 'already_applied').map((item) => String(item.worker_id)))
      setSelected((current) => current.filter((id) => !applied.has(id)))
      setPreview(null); setReload((count) => count + 1)
      clearWorkerControlDataCache(); window.dispatchEvent(new Event('attendance:changed'))
    } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setSaving(false) }
  }
  return <section className="overtime-entry" dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header><h1 className="text-2xl font-extrabold">{l.title}</h1><p className="text-sm text-(--muted)">{l.subtitle}</p><a className="btn-secondary mt-3" href={`/payroll/team-weekly-report?date=${date}`}>عرض وطباعة أجور الأسبوع</a></header>
    <fieldset disabled={saving} className="overtime-entry-controls surface-card">
      <label>{l.date}<input className="input-base" type="date" max={today} value={date} onChange={(event) => changeDate(event.target.value)} /></label>
      <label>{l.team}<select className="input-base" value={teamId} disabled={!ready} onChange={(event) => selectTeam(event.target.value)}><option value="">{l.chooseTeam}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <p className="font-bold">{outsideWorkDateLabel(date, language === 'en' ? 'en-GB' : language)}</p>
    </fieldset>
    <nav className="overtime-week-strip" aria-label={l.week}>{weekDays(date).slice(0, 6).map((day) => <button type="button" key={day} disabled={saving || day > today} aria-pressed={date === day} onClick={() => changeDate(day)}>
      {new Intl.DateTimeFormat(language, { weekday: 'short', day: '2-digit', timeZone: 'Africa/Kinshasa' }).format(new Date(`${day}T12:00:00+01:00`))}
    </button>)}</nav>
    <p className="text-sm">{l.mode}</p><p className="text-xs text-(--muted)">{l.policy}</p>
    {loading && <p role="status">{l.loading}</p>}
    {loadError && <div role="alert">{loadError}<button type="button" className="btn-secondary" onClick={() => setReload((count) => count + 1)}>{l.retry}</button></div>}
    {error && <p role="alert" className="alert alert--error">{error}</p>}
    {!teamId && <p>{l.choose}</p>}
    {teamId && <fieldset disabled={saving || !ready} className="surface-card overtime-entry-roster">
      <div className="overtime-entry-toolbar"><label>{l.search}<input className="input-base" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button type="button" className="btn-secondary" onClick={() => { setSelected(teamWorkers.filter((worker) => !blocked(worker)).map((worker) => String(worker.id))); setPreview(null) }}>{l.selectAll}</button>
        <button type="button" className="btn-secondary" onClick={resetSelection}>{l.clear}</button><strong>{l.selected}: {selectedWorkers.length}</strong></div>
      <div className="overtime-entry-common"><label>{l.common}<input className="input-base" dir="ltr" inputMode="numeric" placeholder="2:00" value={common} onChange={(event) => changeCommon(event.target.value)} /></label>
        <div className="overtime-entry-quick"><button type="button" className="btn-secondary" onClick={() => changeCommon(overtimeDuration(Math.min(1440, (parseOvertimeDuration(common) || 0) + 30)))}>{l.plus30}</button>
          {[60, 90, 120, 180, 240].map((minutes, index) => <button type="button" className="btn-secondary" key={minutes} onClick={() => changeCommon(overtimeDuration(minutes))}>{l.quick[index]}</button>)}</div>
        <button type="button" className="btn-primary" disabled={!selectedWorkers.length} onClick={applyCommon}>{l.apply}</button></div>
      {applied > 0 && <p role="status">{l.applied}: {applied} · <bdi dir="ltr">{common}</bdi></p>}
      <div className="overflow-x-auto"><table className="overtime-entry-table"><thead><tr><th aria-label={l.selected}></th><th>{l.worker}</th><th>{l.code}</th><th>{l.current}</th><th>{l.next}</th></tr></thead>
        <tbody>{visible.map((worker) => {
          const id = String(worker.id), row = rows.get(id), reason = blocked(worker)
          return <tr key={id}><td><input type="checkbox" aria-label={worker.full_name} disabled={Boolean(reason)} checked={selected.includes(id)} onChange={() => {
            setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); setPreview(null); setApplied(0)
          }} /></td><td><strong>{worker.full_name}</strong>{row?.check_out && <small className="block text-(--muted)">{l.checkout}: <bdi dir="ltr">{String(row.check_out).slice(0, 5)}</bdi></small>}{reason && <small className="block text-amber-800">{l.reasons[reason] || reason}</small>}</td>
            <td><bdi>{worker.employee_code || '—'}</bdi></td><td><bdi dir="ltr">{overtimeDuration(currentEntryOvertime(worker, row, date))}</bdi><small className="block text-(--muted)">{row?.emergency_overtime_mode ? l.manual : l.biometric}</small></td>
            <td><input aria-label={`${l.next}: ${worker.full_name}`} className="input-base overtime-entry-duration" dir="ltr" inputMode="numeric" placeholder="0:00" disabled={Boolean(reason) || !selected.includes(id)} value={values[id] || ''} onChange={(event) => { const value = event.target.value; setValues((current) => ({ ...current, [id]: value })); setPreview(null); setApplied(0) }} /></td></tr>
        })}{!visible.length && <tr><td colSpan={5}>{l.empty}</td></tr>}</tbody></table></div>
      <button className="btn-primary" type="button" disabled={!selectedWorkers.length} onClick={prepare}>{l.preview}</button>
    </fieldset>}
    {preview && <section className="surface-card overtime-entry-preview" aria-label={l.preview}>
      <h2 className="font-bold">{l.preview}</h2><p>{outsideWorkDateLabel(preview.date, language)} · {preview.teamName}</p>
      <p>{l.selected}: {preview.entries.length} · {l.total}: <bdi dir="ltr">{preview.entries.reduce((sum, entry) => sum + entry.minutes, 0) / 60} {l.hours}</bdi></p>
      <ul className="overtime-entry-preview-workers">{preview.entries.map((entry) => <li key={entry.worker_id}>{entry.name}: <bdi dir="ltr">{overtimeDuration(entry.minutes)}</bdi></li>)}</ul>
      <p className="text-sm text-(--muted)">{l.perWorker}</p><div className="flex gap-3"><button type="button" className="btn-primary" disabled={saving || !ready} onClick={save}>{saving ? l.saving : l.save}</button><button type="button" disabled={saving} className="btn-secondary" onClick={() => setPreview(null)}>{l.cancel}</button></div>
    </section>}
    {result && <section role="status" className="surface-card overtime-entry-result"><h2 className="font-bold">{result.date} · {result.teamName}</h2><p>{l.updated}: {result.updated} · {l.skipped}: {result.skipped} · {l.failed}: {result.failed}</p>
      <ul>{(result.results || []).map((item, index) => <li key={`${item.worker_id}-${index}`}>{result.names[item.worker_id] || item.worker_id}: {item.outcome === 'updated' ? l.updated : l.reasons[item.reason] || item.reason || l.failed}</li>)}</ul></section>}
  </section>
}
