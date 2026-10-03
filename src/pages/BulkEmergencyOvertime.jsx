import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getWorkersRequest } from '../api/workersApi'
import { getSupabaseClient } from '../lib/supabase'
import { getErrorMessage } from '../api/axios'
import { clearWorkerControlDataCache } from '../api/workerControlData'
import { useTranslation } from '../i18n/LanguageContext'
import { isOperationalAttendanceWorkerOnDate } from '../utils/activeWorkers'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { yesterdayFromBusinessDate } from '../utils/dailyOperationalReports'
import { formatEveningOvertimeMinutes, weeklyPayrollOvertimeForDetail } from '../utils/weeklyPayrollOvertime'

const DEFAULT_REASON = 'Emergency manual overtime'
const yesterday = () => yesterdayFromBusinessDate(kinshasaClock().date)
const clock = (value) => value ? String(value).slice(0, 5) : '—'
const parseDuration = (value) => {
  const input = String(value || '').trim().toLowerCase()
  const match = input.match(/^(\d{1,2}):([0-5]\d)$/) || input.match(/^(\d{1,2})h(?:(\d{1,2})m?)?$/)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2] || 0)
  return minutes >= 1 && minutes <= 1440 && Number(match[2] || 0) < 60 ? minutes : null
}

export default function BulkEmergencyOvertime() {
  const { t } = useTranslation()
  const e = (key) => t(`emergencyOvertime.${key}`)
  const [date, setDate] = useState(yesterday)
  const [teamId, setTeamId] = useState('')
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [mappings, setMappings] = useState([])
  const [teams, setTeams] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [mode, setMode] = useState('manual_checkout')
  const [checkout, setCheckout] = useState('21:00')
  const [duration, setDuration] = useState('02:00')
  const [overrides, setOverrides] = useState({})
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = getSupabaseClient()
      const [roster, rows, mappingResult] = await Promise.all([
        getWorkersRequest({ includePayrollProfiles: false }),
        getAttendanceRequest({ date, paginate: true }),
        client.from('biometric_worker_mapping')
          .select('worker_id,device_employee_no,is_active,mapping_review_state')
          .eq('is_active', true).eq('mapping_review_state', 'confirmed'),
      ])
      if (mappingResult.error) throw mappingResult.error
      setWorkers(roster.data || [])
      setAttendance(rows.data || [])
      setMappings(mappingResult.data || [])
      setTeams([...new Map((roster.data || [])
        .filter((worker) => isOperationalAttendanceWorkerOnDate(worker, date)
          && worker.team_name !== 'Chauffeur')
        .map((worker) => [String(worker.team_id), worker.team])).values()]
        .filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)))
    } catch (cause) {
      setWorkers([])
      setAttendance([])
      setMappings([])
      setTeams([])
      setError(getErrorMessage(cause))
    } finally { setLoading(false) }
  }, [date])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setSelectedIds([])
    setOverrides({})
    setPreview(null)
    setResult(null)
  }, [date, teamId])

  const rowsByWorker = useMemo(() => new Map(attendance.map((row) => [String(row.worker_id), row])), [attendance])
  const idsByWorker = useMemo(() => {
    const map = new Map()
    mappings.forEach((mapping) => {
      const ids = map.get(String(mapping.worker_id)) || new Set()
      ids.add(String(mapping.device_employee_no))
      map.set(String(mapping.worker_id), ids)
    })
    return new Map([...map].map(([id, values]) => [id, [...values].join(' · ')]))
  }, [mappings])
  const visible = useMemo(() => workers.filter((worker) =>
    teamId && String(worker.team_id) === teamId
    && isOperationalAttendanceWorkerOnDate(worker, date)
    && worker.team_name !== 'Chauffeur',
  ), [workers, date, teamId])
  const selected = useMemo(() => visible.filter((worker) => selectedIds.includes(String(worker.id))), [visible, selectedIds])
  const allSelected = visible.length > 0 && visible.every((worker) => selectedIds.includes(String(worker.id)))
  const toggleWorker = (workerId) => {
    setSelectedIds((current) => current.includes(workerId)
      ? current.filter((id) => id !== workerId) : [...current, workerId])
    setPreview(null)
  }

  const prepare = () => {
    setError('')
    if (!selected.length) { setError(e('selectWorkers')); return }
    const minutes = parseDuration(duration)
    if (mode === 'manual_overtime_duration' && minutes == null) { setError(e('durationInvalid')); return }
    const proposed = selected.map((worker) => {
      const row = rowsByWorker.get(String(worker.id)) || null
      const proposedCheckout = overrides[worker.id] || checkout
      const proposedRow = mode === 'manual_checkout'
        ? { ...row, status: row?.status === 'late' ? 'late' : 'present', check_out: proposedCheckout,
          manual_override: true, emergency_overtime_mode: 'manual_checkout', emergency_overtime_minutes: null }
        : { ...row, manual_override: true, emergency_overtime_mode: 'manual_overtime_duration',
          emergency_overtime_minutes: minutes }
      return {
        worker, row, checkout: proposedCheckout, minutes,
        overtime: row?.check_in
          ? weeklyPayrollOvertimeForDetail({ date, row: proposedRow, worker, team: worker.team }).eveningOvertimeMinutes
          : 0,
      }
    })
    if (mode === 'manual_checkout' && proposed.some(({ row, checkout: value }) =>
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      || (row?.check_in && value <= String(row.check_in).slice(0, 5)))) {
      setError(e('checkoutInvalid')); return
    }
    setPreview({ requestId: crypto.randomUUID(), proposed })
  }

  const save = async () => {
    if (!preview || saving) return
    setSaving(true)
    setError('')
    try {
      const entries = preview.proposed.map(({ worker, row, checkout: value, minutes }) => ({
        worker_id: worker.id,
        expected_updated_at: row?.updated_at || null,
        ...(mode === 'manual_checkout' ? { checkout: value } : { minutes }),
      }))
      const { data, error: requestError } = await getSupabaseClient().rpc('admin_apply_bulk_emergency_overtime', {
        p_request_id: preview.requestId, p_date: date, p_mode: mode,
        p_reason: DEFAULT_REASON, p_note: note.trim() || null, p_entries: entries,
      })
      if (requestError) throw requestError
      setResult(data)
      setPreview(null)
      setSelectedIds([])
      clearWorkerControlDataCache()
      window.dispatchEvent(new Event('attendance:changed'))
      await load()
    } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setSaving(false) }
  }

  return <section className="space-y-5">
    <header><h1 className="text-2xl font-extrabold">{e('title')}</h1><p className="text-sm text-(--muted)">{e('description')}</p></header>
    {error && <p role="alert" className="alert alert--error">{error}</p>}

    <div className="surface-card grid gap-4 p-4 md:grid-cols-3">
      <label>{t('attendance.date')}<input className="input-base mt-1" type="date" max={kinshasaClock().date} value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label>{e('team')}<select className="input-base mt-1" value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">{e('chooseTeam')}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>{mode === 'manual_checkout' ? e('commonCheckout') : e('duration')}<input className="input-base mt-1" type={mode === 'manual_checkout' ? 'time' : 'text'} value={mode === 'manual_checkout' ? checkout : duration} onChange={(event) => { (mode === 'manual_checkout' ? setCheckout : setDuration)(event.target.value); setPreview(null) }} placeholder={mode === 'manual_checkout' ? undefined : '3h30'} /></label>
    </div>

    {teamId && <div className="surface-card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-extrabold">{teams.find((team) => String(team.id) === teamId)?.name}</h2><span className="text-sm text-(--muted)">{e('selected')}: {selected.length}</span></div>
      <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={allSelected} disabled={!visible.length || loading} onChange={() => { setSelectedIds(allSelected ? [] : visible.map((worker) => String(worker.id))); setPreview(null) }} />{e('selectAll')}</label>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-start"><th></th><th>{t('common.worker')}</th><th>{e('biometricId')}</th><th>{t('attendance.checkIn')}</th><th>{t('attendance.checkOut')}</th><th>{e('currentOvertime')}</th>{mode === 'manual_checkout' && <th>{e('overrideCheckout')}</th>}</tr></thead><tbody>{visible.map((worker) => {
        const row = rowsByWorker.get(String(worker.id))
        return <tr key={worker.id} className="border-b"><td><input aria-label={worker.full_name} type="checkbox" checked={selectedIds.includes(String(worker.id))} onChange={() => toggleWorker(String(worker.id))} /></td><td>{worker.full_name}</td><td dir="ltr">{idsByWorker.get(String(worker.id)) || '—'}</td><td dir="ltr">{clock(row?.check_in)}</td><td dir="ltr">{clock(row?.check_out)}</td><td dir="ltr">{formatEveningOvertimeMinutes(weeklyPayrollOvertimeForDetail({ date, row, worker, team: worker.team }).eveningOvertimeMinutes)}</td>{mode === 'manual_checkout' && <td><input className="input-base max-w-36" type="time" aria-label={`${e('overrideCheckout')}: ${worker.full_name}`} value={overrides[worker.id] || ''} onChange={(event) => { setOverrides((current) => ({ ...current, [worker.id]: event.target.value })); setPreview(null) }} /></td>}</tr>
      })}</tbody></table>{!loading && !visible.length && <p className="py-4 text-center">{e('noWorkers')}</p>}</div>
    </div>}

    <details className="text-sm"><summary className="cursor-pointer font-semibold">{e('advanced')}</summary><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={mode === 'manual_overtime_duration'} onChange={(event) => { setMode(event.target.checked ? 'manual_overtime_duration' : 'manual_checkout'); setPreview(null) }} />{e('manualDurationOption')}</label></details>
    <label className="block text-sm">{e('note')}<textarea className="input-base mt-1" value={note} onChange={(event) => { setNote(event.target.value); setPreview(null) }} /></label>
    <button type="button" className="btn-primary" onClick={prepare} disabled={loading || saving || !teamId}>{e('saveOvertime')}</button>

    {preview && <div className="surface-card space-y-3 p-4"><h2 className="font-extrabold">{e('confirmTitle')} · {preview.proposed.length}</h2><div className="max-h-64 overflow-auto"><table className="w-full text-sm"><thead><tr><th>{t('common.worker')}</th><th>{t('attendance.checkIn')}</th><th>{e('proposed')}</th><th>{e('calculatedOvertime')}</th></tr></thead><tbody>{preview.proposed.map(({ worker, row, checkout: value, minutes, overtime }) => <tr key={worker.id} className="border-t"><td>{worker.full_name}</td><td>{clock(row?.check_in)}</td><td dir="ltr">{mode === 'manual_checkout' ? value : formatEveningOvertimeMinutes(minutes)}</td><td dir="ltr">{formatEveningOvertimeMinutes(overtime)}</td></tr>)}</tbody></table></div><div className="flex gap-2"><button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? t('common.saving') : e('confirmSave')}</button><button type="button" className="btn-secondary" disabled={saving} onClick={() => setPreview(null)}>{t('common.cancel')}</button></div></div>}
    {result && <div className="surface-card p-4" role="status"><p className="font-bold">{e('updated')}: {result.updated} · {e('skipped')}: {result.skipped} · {e('failed')}: {result.failed}</p>{(result.results || []).some((item) => item.outcome !== 'updated') && <details className="mt-2 text-sm"><summary className="cursor-pointer">{e('result')}</summary><ul>{result.results.filter((item) => item.outcome !== 'updated').map((item, index) => <li key={`${item.worker_id}-${index}`}>{workers.find((worker) => worker.id === item.worker_id)?.full_name || item.worker_id}: {item.reason}</li>)}</ul></details>}</div>}
  </section>
}
