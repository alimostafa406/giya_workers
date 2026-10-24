import { useEffect, useState } from 'react'
import { getPayrollOperationsDataRequest } from '../api/payrollOperationsApi'
import { saveWeeklyOvertime } from '../api/weeklyOvertimeApi'
import { getErrorMessage } from '../api/axios'
import { mondayFor, weeklyDates } from '../utils/payrollCalculations'
import { isWeeklyPayrollEligibleWorker } from '../utils/weeklyPayrollEligibility'
import { applyManualWeeklyOvertime, manualReportMinutes, parseWeeklyDuration } from '../utils/weeklyManualOvertime'
import { overtimeDuration } from '../utils/overtimeEntry'

export default function WeeklyOvertimeEntry() {
  const [week, setWeek] = useState(mondayFor()), [team, setTeam] = useState(''), [data, setData] = useState(null)
  const [selected, setSelected] = useState([]), [values, setValues] = useState({}), [common, setCommon] = useState('25:00')
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [preview, setPreview] = useState(null), [reload, setReload] = useState(0)
  const end = weeklyDates(week).at(-1)
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setData(null)
    getPayrollOperationsDataRequest({ date_from: week, date_to: end, paginate: true }).then((next) => { if (active) setData(next) })
      .catch((e) => { if (active) setError(getErrorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [week, end, reload])
  const workers = (data?.workers || []).filter((w) => isWeeklyPayrollEligibleWorker(w, end) && w.team_id && (w.team_name || w.team?.name) !== 'Chauffeur')
  const teams = [...new Map(workers.map((w) => [String(w.team_id), w.team_name || w.team?.name || '—'])).entries()]
  const visible = workers.filter((w) => String(w.team_id) === team)
  const locked = (data?.runs || []).some((r) => r.payment_type === 'weekly' && r.weekly_period_start === week && ['reviewed', 'finalized', 'paid'].includes(r.status))
  const override = (id) => (data?.weeklyOvertimeOverrides || []).find((o) => String(o.worker_id) === String(id))
  const daily = (id) => (data?.attendance || []).filter((r) => String(r.worker_id) === String(id) && r.attendance_date >= week && r.attendance_date <= end).reduce((sum, r) => sum + manualReportMinutes(r), 0)
  const effective = (worker) => applyManualWeeklyOvertime({ worker, term: worker.payroll_compensation, finalAmount: 0, overtimeAmount: 0,
    details: weeklyDates(week).filter((date) => !worker.operational_start_date || date >= worker.operational_start_date).map((date) => ({ date,
      row: (data?.attendance || []).find((r) => String(r.worker_id) === String(worker.id) && r.attendance_date === date) })) },
  override(worker.id), data?.outsideWorkMovements || []).eveningOvertimeMinutes
  const reset = () => { setSelected([]); setValues({}); setPreview(null); setMessage('') }
  const prepare = (clear = false) => {
    if (loading || locked || !selected.length) return
    const entries = selected.map((id) => ({ worker_id: id, minutes: clear ? null : parseWeeklyDuration(values[id]), expected_version: override(id)?.version || 0 }))
    if (!clear && entries.some((e) => e.minutes === null)) { setError('أدخل مدة صحيحة من 0:00 إلى 144:00'); return }
    setError(''); setPreview(entries)
  }
  const save = async () => {
    setSaving(true); setError('')
    try { await saveWeeklyOvertime({ week, entries: preview }); reset(); setMessage('تم حفظ الإجمالي الأسبوعي'); setReload((n) => n + 1) }
    catch (e) { setError(getErrorMessage(e)) } finally { setSaving(false) }
  }
  return <section className="overtime-entry" dir="rtl"><h1 className="text-2xl font-bold">إجمالي الإضافي الأسبوعي</h1>
    <p>الإجمالي الأسبوعي يستبدل مجموع الإدخال اليومي ولا يغيّر أي سجل حضور. الحد الأقصى 144 ساعة، بدقة دقيقة واحدة.</p>
    <fieldset disabled={saving} className="overtime-entry-controls surface-card"><label>الأسبوع<input className="input-base" type="date" value={week} onChange={(e) => { if (e.target.value) { reset(); setWeek(mondayFor(`${e.target.value}T12:00:00`)) } }} /></label>
      <label>الفريق<select className="input-base" value={team} disabled={loading} onChange={(e) => { reset(); setTeam(e.target.value) }}><option value="">اختر الفريق</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><bdi dir="ltr">{week} → {end}</bdi></fieldset>
    <a className="btn-secondary" href={`/payroll/team-weekly-report?date=${week}`}>عرض وطباعة أجور الأسبوع</a>
    {loading && <p role="status">جاري التحميل...</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{locked && <p role="alert">أسبوع الرواتب مقفل — للقراءة فقط</p>}
    <fieldset disabled={saving || loading || !data || locked || !team} className="surface-card overtime-entry-roster">
      <div className="overtime-entry-toolbar"><button type="button" className="btn-secondary" onClick={() => { setSelected(visible.map((w) => String(w.id))); setPreview(null) }}>اختيار الكل</button><button type="button" className="btn-secondary" onClick={reset}>إلغاء الاختيار</button><strong>العمال المحددون: {selected.length}</strong></div>
      <div className="overtime-entry-common"><label>إجمالي الإضافي الأسبوعي<input className="input-base" dir="ltr" placeholder="25:00" value={common} onChange={(e) => setCommon(e.target.value)} /></label><button type="button" className="btn-primary" disabled={!selected.length} onClick={() => {
        const minutes = parseWeeklyDuration(common)
        if (minutes === null) { setError('أدخل مدة صحيحة من 0:00 إلى 144:00'); return }
        const updates = Object.fromEntries(selected.map((id) => [id, overtimeDuration(minutes)]))
        setValues((old) => ({ ...old, ...updates })); setPreview(null); setError(''); setMessage(`تم تطبيق المدة على المختارين: ${selected.length}`)
      }}>تطبيق على المختارين</button></div>
      <div className="overflow-x-auto"><table className="overtime-entry-table"><thead><tr><th>اختيار</th><th>العامل</th><th>الإضافي اليومي المجمع</th><th>الإجمالي الأسبوعي اليدوي</th><th>الإضافي المعتمد</th><th>القيمة الجديدة</th></tr></thead><tbody>{visible.map((w) => {
        const id = String(w.id), saved = override(id), sum = daily(id)
        return <tr key={id}><td><input type="checkbox" aria-label={w.full_name} checked={selected.includes(id)} onChange={() => { setSelected((old) => old.includes(id) ? old.filter((v) => v !== id) : [...old, id]); setPreview(null) }} /></td><td>{w.full_name}<small className="block">{w.employee_code}</small></td><td><bdi dir="ltr">{overtimeDuration(sum)}</bdi></td><td><bdi dir="ltr">{saved?.minutes == null ? '—' : overtimeDuration(saved.minutes)}</bdi></td><td><bdi dir="ltr">{overtimeDuration(effective(w))}</bdi></td><td><input className="input-base overtime-entry-duration" aria-label={`القيمة الجديدة: ${w.full_name}`} dir="ltr" value={values[id] ?? ''} disabled={!selected.includes(id)} onChange={(e) => { const value = e.target.value; setValues((old) => ({ ...old, [id]: value })); setPreview(null) }} /></td></tr>
      })}{!visible.length && <tr><td colSpan={6}>اختر فريقاً لعرض العمال</td></tr>}</tbody></table></div>
      <div className="overtime-entry-toolbar"><button type="button" className="btn-primary" disabled={!selected.length} onClick={() => prepare()}>معاينة الإجمالي الأسبوعي</button><button type="button" className="btn-secondary" disabled={!selected.length} onClick={() => prepare(true)}>مسح التجاوز الأسبوعي للمختارين</button></div>
    </fieldset>
    {preview && <section className="surface-card overtime-entry-preview" aria-label="معاينة أسبوعية"><h2>معاينة أسبوعية</h2><ul>{preview.map((e) => <li key={e.worker_id}>{workers.find((w) => String(w.id) === e.worker_id)?.full_name}: <bdi dir="ltr">{e.minutes == null ? 'استعادة المجموع اليومي' : overtimeDuration(e.minutes)}</bdi></li>)}</ul><button type="button" className="btn-primary" disabled={saving || locked || loading || !data} onClick={save}>حفظ الإجمالي الأسبوعي</button><button type="button" disabled={saving} onClick={() => setPreview(null)}>إلغاء</button></section>}
  </section>
}
