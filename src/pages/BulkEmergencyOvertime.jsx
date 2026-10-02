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

const yesterday = () => yesterdayFromBusinessDate(kinshasaClock().date)
const clock = (value) => value ? String(value).slice(0, 5) : '—'
const sourceKey = (row) => row?.emergency_overtime_mode ? 'manualEmergency'
  : row?.attendance_source === 'biometric' ? 'biometric' : 'manual'
const parseDuration = (value) => {
  const input = String(value || '').trim().toLowerCase()
  const clockMatch = input.match(/^(\d{1,2}):([0-5]\d)$/)
  const hoursMatch = input.match(/^(\d{1,2})h(?:(\d{1,2})m?)?$/)
  if (!clockMatch && !hoursMatch) return null
  const hours = Number((clockMatch || hoursMatch)[1])
  const remainder = Number((clockMatch || hoursMatch)[2] || 0)
  if (remainder > 59) return null
  const minutes = hours * 60 + remainder
  return minutes >= 1 && minutes <= 1440 ? minutes : null
}

export default function BulkEmergencyOvertime() {
  const { t } = useTranslation()
  const e = (key) => t(`emergencyOvertime.${key}`)
  const [date, setDate] = useState(yesterday)
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [mappings, setMappings] = useState([])
  const [teams, setTeams] = useState([])
  const [teamIds, setTeamIds] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [nameFilter, setNameFilter] = useState('')
  const [biometricFilter, setBiometricFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [missingCheckoutOnly, setMissingCheckoutOnly] = useState(true)
  const [halfDayOnly, setHalfDayOnly] = useState(false)
  const [mode, setMode] = useState('manual_checkout')
  const [checkout, setCheckout] = useState('21:00')
  const [duration, setDuration] = useState('02:00')
  const [overrides, setOverrides] = useState({})
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
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
    } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setLoading(false) }
  }, [date])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelectedIds([]); setPreview(null); setResult(null) }, [date, teamIds, mode])

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
  const visible = useMemo(() => workers.filter((worker) => {
    if (!isOperationalAttendanceWorkerOnDate(worker, date) || worker.team_name === 'Chauffeur') return false
    if (!teamIds.includes(String(worker.team_id))) return false
    const row = rowsByWorker.get(String(worker.id))
    if (!row?.check_in) return false
    if (nameFilter && !String(worker.full_name).toLowerCase().includes(nameFilter.toLowerCase())) return false
    if (biometricFilter && !String(idsByWorker.get(String(worker.id)) || '').includes(biometricFilter)) return false
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (missingCheckoutOnly && row.check_out) return false
    if (halfDayOnly && row.status !== 'half_day') return false
    return true
  }), [workers, date, teamIds, rowsByWorker, nameFilter, biometricFilter, idsByWorker, statusFilter, missingCheckoutOnly, halfDayOnly])
  const eligibleTeamWorkers = useMemo(() => workers.filter((worker) =>
    isOperationalAttendanceWorkerOnDate(worker, date)
    && worker.team_name !== 'Chauffeur'
    && rowsByWorker.get(String(worker.id))?.check_in,
  ), [workers, date, rowsByWorker])
  const selected = useMemo(() => workers.filter((worker) => selectedIds.includes(String(worker.id))), [workers, selectedIds])
  const toggleSelected = (ids) => setSelectedIds((current) => {
    const next = new Set(current)
    const allSelected = ids.every((id) => next.has(id))
    ids.forEach((id) => allSelected ? next.delete(id) : next.add(id))
    return [...next]
  })
  const changeInput = (setter) => (value) => { setter(value); setPreview(null); setResult(null) }

  const prepare = () => {
    setError('')
    if (!selected.length) { setError(e('selectWorkers')); return }
    if (!reason.trim()) { setError(e('reasonRequired')); return }
    const minutes = parseDuration(duration)
    if (mode === 'manual_overtime_duration' && minutes == null) { setError(e('durationInvalid')); return }
    const proposed = selected.map((worker) => {
      const row = rowsByWorker.get(String(worker.id))
      const proposedCheckout = overrides[worker.id] || checkout
      const proposedRow = mode === 'manual_checkout'
        ? { ...row, status: row.status === 'late' ? 'late' : 'present', check_out: proposedCheckout, manual_override: true, emergency_overtime_mode: 'manual_checkout', emergency_overtime_minutes: null }
        : { ...row, manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: minutes }
      return {
        worker, row, checkout: proposedCheckout, minutes,
        overtime: weeklyPayrollOvertimeForDetail({ date, row: proposedRow, worker, team: worker.team }).eveningOvertimeMinutes,
      }
    })
    if (mode === 'manual_checkout' && proposed.some(({ row, checkout: value }) =>
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      || value <= String(row.check_in).slice(0, 5))) {
      setError(e('checkoutInvalid')); return
    }
    setPreview({ requestId: crypto.randomUUID(), proposed })
  }

  const save = async () => {
    if (!preview || saving) return
    setSaving(true); setError('')
    try {
      const entries = preview.proposed.map(({ worker, row, checkout: value, minutes }) => ({
        worker_id: worker.id,
        expected_updated_at: row.updated_at,
        ...(mode === 'manual_checkout' ? { checkout: value } : { minutes }),
      }))
      const { data, error: requestError } = await getSupabaseClient().rpc('admin_apply_bulk_emergency_overtime', {
        p_request_id: preview.requestId, p_date: date, p_mode: mode,
        p_reason: reason.trim(), p_note: note.trim() || null, p_entries: entries,
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
      <label>{e('mode')}<select className="input-base mt-1" value={mode} onChange={(event) => setMode(event.target.value)}><option value="manual_checkout">{e('checkoutMode')}</option><option value="manual_overtime_duration">{e('durationMode')}</option></select></label>
      <label>{mode === 'manual_checkout' ? e('commonCheckout') : e('duration')}<input className="input-base mt-1" type={mode === 'manual_checkout' ? 'time' : 'text'} value={mode === 'manual_checkout' ? checkout : duration} onChange={(event) => mode === 'manual_checkout' ? changeInput(setCheckout)(event.target.value) : changeInput(setDuration)(event.target.value)} placeholder="02:30" /></label>
    </div>
    <div className="surface-card space-y-3 p-4"><h2 className="font-extrabold">{e('teams')}</h2><div className="flex flex-wrap gap-3">{teams.map((team) => <label key={team.id} className="flex items-center gap-2"><input type="checkbox" checked={teamIds.includes(String(team.id))} onChange={() => setTeamIds((current) => current.includes(String(team.id)) ? current.filter((id) => id !== String(team.id)) : [...current, String(team.id)])} />{team.name}</label>)}</div></div>
    <div className="surface-card space-y-3 p-4">
      <div className="grid gap-3 md:grid-cols-4"><label>{e('workerSearch')}<input className="input-base mt-1" value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} /></label><label>{e('biometricId')}<input className="input-base mt-1" value={biometricFilter} onChange={(event) => setBiometricFilter(event.target.value)} /></label><label>{t('attendance.status')}<select className="input-base mt-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">{t('common.allWorkers')}</option>{['present','late','half_day','in_progress'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label><div className="space-y-2 self-end"><label className="block"><input type="checkbox" checked={missingCheckoutOnly} onChange={(event) => setMissingCheckoutOnly(event.target.checked)} /> {e('missingCheckout')}</label><label className="block"><input type="checkbox" checked={halfDayOnly} onChange={(event) => setHalfDayOnly(event.target.checked)} /> {e('halfDayOnly')}</label></div></div>
      <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-secondary" onClick={() => toggleSelected(visible.map((worker) => String(worker.id)))} disabled={!visible.length}>{e('selectVisible')}</button>{teams.filter((team) => teamIds.includes(String(team.id))).map((team) => <button type="button" className="btn-secondary" key={team.id} onClick={() => toggleSelected(eligibleTeamWorkers.filter((worker) => String(worker.team_id) === String(team.id)).map((worker) => String(worker.id)))}>{e('selectTeam')}: {team.name}</button>)}<span className="font-bold">{e('selected')}: {selected.length}</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead><tr className="border-b text-start"><th></th><th>{t('common.worker')}</th><th>{e('biometricId')}</th><th>{t('common.team')}</th><th>{t('attendance.checkIn')}</th><th>{t('attendance.checkOut')}</th><th>{t('attendance.status')}</th><th>{e('source')}</th><th>{e('currentOvertime')}</th>{mode === 'manual_checkout' && <th>{e('overrideCheckout')}</th>}</tr></thead><tbody>{visible.map((worker) => { const row = rowsByWorker.get(String(worker.id)); return <tr key={worker.id} className="border-b"><td><input aria-label={worker.full_name} type="checkbox" checked={selectedIds.includes(String(worker.id))} onChange={() => toggleSelected([String(worker.id)])} /></td><td>{worker.full_name}</td><td dir="ltr">{idsByWorker.get(String(worker.id)) || '—'}</td><td>{worker.team_name}</td><td dir="ltr">{clock(row.check_in)}</td><td dir="ltr">{clock(row.check_out)}</td><td>{row.status}</td><td>{e(sourceKey(row))}</td><td dir="ltr">{formatEveningOvertimeMinutes(weeklyPayrollOvertimeForDetail({ date, row, worker, team: worker.team }).eveningOvertimeMinutes)}</td>{mode === 'manual_checkout' && <td><input className="input-base max-w-36" type="time" value={overrides[worker.id] || ''} onChange={(event) => { setOverrides((current) => ({ ...current, [worker.id]: event.target.value })); setPreview(null) }} /></td>}</tr> })}</tbody></table>{!loading && !visible.length && <p className="py-4 text-center">{e('noWorkers')}</p>}</div>
    </div>
    <div className="surface-card grid gap-3 p-4 md:grid-cols-2"><label>{e('reason')}<select className="input-base mt-1" value={reason} onChange={(event) => changeInput(setReason)(event.target.value)}><option value="">{e('chooseReason')}</option>{['power','device','network','supervisor','other'].map((key) => <option key={key} value={e(key)}>{e(key)}</option>)}</select></label><label>{e('note')}<textarea className="input-base mt-1" value={note} onChange={(event) => changeInput(setNote)(event.target.value)} /></label></div>
    <p className="alert alert--warning">{e('finalizedWarning')}</p>
    <button type="button" className="btn-primary" onClick={prepare} disabled={loading || saving}>{e('preview')}</button>
    {preview && <div className="surface-card space-y-3 p-4"><h2 className="font-extrabold">{e('confirmTitle')}</h2><div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr><th>{t('common.worker')}</th><th>{t('common.team')}</th><th>{t('attendance.checkIn')}</th><th>{t('attendance.checkOut')}</th><th>{e('proposed')}</th><th>{e('calculatedOvertime')}</th><th>{e('reason')}</th></tr></thead><tbody>{preview.proposed.map(({ worker, row, checkout: value, minutes, overtime }) => <tr key={worker.id} className="border-t"><td>{worker.full_name}</td><td>{worker.team_name}</td><td>{clock(row.check_in)}</td><td>{clock(row.check_out)}</td><td dir="ltr">{mode === 'manual_checkout' ? value : formatEveningOvertimeMinutes(minutes)}</td><td dir="ltr">{formatEveningOvertimeMinutes(overtime)}</td><td>{reason}</td></tr>)}</tbody></table></div><div className="flex gap-2"><button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? t('common.saving') : e('confirmSave')}</button><button type="button" className="btn-secondary" disabled={saving} onClick={() => setPreview(null)}>{t('common.cancel')}</button></div></div>}
    {result && <div className="surface-card p-4" role="status"><h2 className="font-extrabold">{e('result')}</h2><p>{e('updated')}: {result.updated} · {e('skipped')}: {result.skipped} · {e('failed')}: {result.failed}</p><ul className="mt-2 text-sm">{(result.results || []).filter((item) => item.outcome !== 'updated').map((item, index) => <li key={`${item.worker_id}-${index}`}>{workers.find((worker) => worker.id === item.worker_id)?.full_name || item.worker_id}: {item.reason}</li>)}</ul></div>}
  </section>
}
