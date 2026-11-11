import { useEffect, useState } from 'react'
import { getBiometricLatenessReviews, decideBiometricLateness, saveBiometricLatenessBatch } from '../api/biometricLatenessApi'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { formatBiometricOvertimeDuration as duration } from '../utils/biometricOvertimeReview'
import { automaticLateDeduction, latenessStatus } from '../utils/biometricLateness'
import { formatPayrollMoney } from '../utils/payrollCurrency'
import { getErrorMessage } from '../api/axios'

const labels = { pending: 'قيد المراجعة', approved: 'موافق عليه', rejected: 'مرفوض', stale: 'يحتاج مراجعة من جديد' }
const clock = (value) => value?.slice(11, 19) || '—'
export default function BiometricLatenessReview() {
  const today = kinshasaClock().date
  const [date, setDate] = useState(today), [sources, setSources] = useState([]), [drafts, setDrafts] = useState({})
  const [team, setTeam] = useState(''), [status, setStatus] = useState('pending')
  const [selected, setSelected] = useState([]), [common, setCommon] = useState('')
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setSources([]); setDrafts({}); setSelected([])
    getBiometricLatenessReviews(date).then(rows => { if (active) setSources(rows) })
      .catch(e => { if (active) setError(getErrorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [date, reload])
  const teams = [...new Map(sources.map(row => [row.worker.team_id, row.worker.team_name])).entries()]
  const visible = sources.filter(row => (!team || row.worker.team_id === team) && (!status || latenessStatus(row) === status))
  const overrideFor = (row) => drafts[row.worker.id]?.override ?? row.review?.adjusted_deduction ?? ''
  const parsedOverride = (value) => String(value).trim() === '' ? null : /^\d{1,12}(\.\d{1,2})?$/.test(String(value)) ? Number(value) : NaN
  const savedRows = (saved) => {
    setSources(old => old.map(row => { const review = saved?.find(r => r.worker_id === row.worker.id); return review ? { ...row, review, payroll_source: null } : row }))
    setDrafts(old => Object.fromEntries(Object.entries(old).filter(([id]) => !saved?.some(r => r.worker_id === id))))
  }
  const edit = (row, field, value) => setDrafts(old => ({ ...old, [row.worker.id]: {
    minutes: row.review?.approved_minutes ?? row.evidence?.raw_minutes ?? 0,
    note: '', ...old[row.worker.id], [field]: value,
  } }))
  const decide = async (row, decision) => {
    const draft = drafts[row.worker.id] || { minutes: row.review?.approved_minutes ?? row.evidence.raw_minutes, note: '' }
    const minutes = Number(draft.minutes)
    const adjusted = parsedOverride(overrideFor(row))
    if (Number.isNaN(adjusted)) { setError('أدخل خصماً غير سالب بدقة منزلتين'); return }
    if (String(draft.minutes).trim() === '' || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { setError('أدخل دقائق تأخير صحيحة'); return }
    if (decision === 'approved' && automaticLateDeduction(row.calculation, minutes) == null) { setError(row.calculation?.unavailable_reason || 'الأجر أو الدوام المدفوع غير محدد'); return }
    setSaving(true); setError(''); setMessage('')
    try {
      const saved = await decideBiometricLateness(date, row, decision, minutes, draft.note || '', { adjusted_deduction: adjusted, adjustment_source: draft.override !== undefined ? 'single' : row.review?.adjustment_source || 'single' })
      savedRows(saved); setMessage('تم حفظ القرار')
    } catch (e) { setError(getErrorMessage(e)) }
    finally { setSaving(false) }
  }
  const applyBulk = async (all = false) => {
    const rows = visible.filter(row => !row.locked && row.evidence?.raw_minutes && (all || selected.includes(row.worker.id)))
    const amount = parsedOverride(common)
    if (!rows.length || rows.length > 200 || amount == null || Number.isNaN(amount)) { setError('اختر حتى 200 عامل وأدخل مبلغ خصم صحيح'); return }
    const entries = rows.map(row => ({ worker_id: row.worker.id, decision: 'pending',
      approved_minutes: Number(drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence.raw_minutes),
      adjusted_deduction: amount, adjustment_source: 'bulk', note: drafts[row.worker.id]?.note || '',
      source_fingerprint: row.evidence.source_fingerprint, calculation_fingerprint: row.calculation?.fingerprint, expected_version: row.review?.version || 0 }))
    setSaving(true); setError(''); setMessage('')
    try { savedRows(await saveBiometricLatenessBatch(date, entries)); setSelected([]); setMessage('تم تطبيق الخصم — بانتظار الموافقة') }
    catch (e) { setError(getErrorMessage(e)) }
    finally { setSaving(false) }
  }
  return <section dir="rtl" className="space-y-4">
    <h1 className="text-2xl font-bold">مراجعة التأخير من البصمة</h1>
    <p className="text-sm text-(--muted)">الخصم = أجر اليوم المدفوع ÷ دقائق الدوام المدفوع × دقائق التأخير المعتمدة. يُطبق بعد الموافقة فقط. لا يتغير دليل البصمة ولا الراتب الشهري. لا يُحتسب خصم دون أجر ودوام معتمدين.</p>
    <fieldset disabled={saving} className="surface-card flex flex-wrap items-end gap-3 p-4">
      <label>التاريخ<input type="date" className="input-base" max={today} value={date} onChange={e => { if (e.target.value && e.target.value <= today) { setDate(e.target.value); setError(''); setMessage('') } }} /></label>
      <label>الفريق<select className="input-base" value={team} onChange={e => setTeam(e.target.value)}><option value="">كل الفرق</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>الحالة<select className="input-base" value={status} onChange={e => setStatus(e.target.value)}><option value="">كل الحالات</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button type="button" className="btn-secondary" onClick={() => { setError(''); setReload(n => n + 1) }}>إعادة التحميل</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">جاري التحميل...</p> : <fieldset disabled={saving} className="surface-card overflow-x-auto p-3">
      <div className="mb-3 flex flex-wrap items-end gap-2"><button type="button" className="btn-secondary" onClick={() => setSelected(old => [...new Set([...old, ...visible.filter(row => !row.locked && row.evidence?.raw_minutes).map(row => row.worker.id)])])}>اختيار الكل الظاهر</button>
        <button type="button" className="btn-secondary" onClick={() => setSelected([])}>إلغاء الاختيار</button>
        <label>الخصم المشترك CDF<input className="input-base w-32" type="number" min="0" step="0.01" value={common} onChange={e => setCommon(e.target.value)} /></label>
        <button type="button" className="btn-primary" disabled={!selected.some(id => visible.some(row => row.worker.id === id && !row.locked))} onClick={() => applyBulk()}>تطبيق الخصم على المختارين</button>
        <button type="button" className="btn-secondary" disabled={!visible.some(row => !row.locked && row.evidence?.raw_minutes)} onClick={() => applyBulk(true)}>تطبيق على الجميع الظاهر</button>
        <small>التطبيق يحفظ الخصم دون موافقة تلقائية.</small></div>
      <table className="w-full border-collapse text-sm"><thead><tr>{['اختيار', 'العامل', 'الكود', 'الفريق', 'التاريخ', 'بداية الدوام', 'الدخول الحقيقي', 'التأخير من البصمة', 'التأخير المعتمد', 'خصم التأخير CDF', 'الحالة', 'القرار'].map(label => <th className="border p-2 text-start" key={label}>{label}</th>)}</tr></thead><tbody>
      {visible.map(row => <tr key={row.worker.id}>
        <td className="border p-2"><input type="checkbox" aria-label={`اختيار ${row.worker.full_name}`} disabled={row.locked || !row.evidence?.raw_minutes} checked={selected.includes(row.worker.id)} onChange={e => setSelected(old => e.target.checked ? [...new Set([...old,row.worker.id])] : old.filter(id => id !== row.worker.id))} /></td>
        <td className="border p-2">{row.worker.full_name}</td><td className="border p-2">{row.worker.employee_code}</td><td className="border p-2">{row.worker.team_name}</td><td className="border p-2"><bdi dir="ltr">{date}</bdi></td>
        <td className="border p-2"><bdi dir="ltr">{clock(row.evidence?.scheduled_start)}</bdi></td><td className="border p-2"><bdi dir="ltr">{clock(row.evidence?.raw_check_in) !== '—' ? clock(row.evidence.raw_check_in) : row.attendance.check_in || '—'}</bdi></td>
        <td className="border p-2"><bdi dir="ltr">{row.evidence ? duration(row.evidence.raw_minutes) : '—'}</bdi>{latenessStatus(row) === 'stale' && <small className="block">الدليل السابق: <bdi dir="ltr">{duration(row.review.raw_minutes)}</bdi></small>}</td>
        <td className="border p-2"><input className="input-base w-24" type="number" min="0" max="1440" step="1" aria-label={`دقائق التأخير المعتمدة ${row.worker.full_name}`} disabled={row.locked || !row.evidence?.raw_minutes} value={drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence?.raw_minutes ?? 0} onChange={e => edit(row, 'minutes', e.target.value)} /><small><bdi dir="ltr">{duration(drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence?.raw_minutes)}</bdi></small></td>
        <td className="border p-2">تلقائي: <output aria-label={`خصم التأخير المحسوب ${row.worker.full_name}`}><bdi dir="ltr">{automaticLateDeduction(row.calculation, drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence?.raw_minutes) == null ? '—' : formatPayrollMoney(automaticLateDeduction(row.calculation, drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence?.raw_minutes), { currency: 'CDF' })}</bdi></output>
          <label className="mt-1 block">الخصم المعتمد<input className="input-base w-32" aria-label={`الخصم المعتمد ${row.worker.full_name}`} type="number" min="0" step="0.01" placeholder="تلقائي" disabled={row.locked || !row.evidence?.raw_minutes} value={overrideFor(row)} onChange={e => edit(row, 'override', e.target.value)} /></label>
          <button type="button" className="btn-secondary mt-1" disabled={row.locked || !row.evidence?.raw_minutes} onClick={() => edit(row,'override','')}>تلقائي</button>
          <small className="block">{row.calculation?.unavailable_reason || <><bdi dir="ltr">{row.calculation?.daily_wage}</bdi> ÷ {row.calculation?.scheduled_paid_minutes} min</>}</small>
          <small className="block">الخصم المطبق: <bdi dir="ltr">{formatPayrollMoney(latenessStatus(row) === 'approved' ? row.review.deduction_amount : 0, { currency: 'CDF' })}</bdi></small>
          <input className="input-base mt-1" aria-label={`سبب الخصم ${row.worker.full_name}`} placeholder="سبب / ملاحظات" maxLength={1000} disabled={row.locked} value={drafts[row.worker.id]?.note || ''} onChange={e => edit(row, 'note', e.target.value)} /></td>
        <td className="border p-2">{labels[latenessStatus(row)]}{row.locked && <small className="block">فترة الرواتب مقفلة</small>}</td>
        <td className="border p-2"><div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={row.locked || !row.evidence?.raw_minutes} onClick={() => decide(row,'pending')}>حفظ الخصم</button><button type="button" className="btn-primary" disabled={row.locked || !row.evidence?.raw_minutes || Boolean(row.calculation?.unavailable_reason)} onClick={() => decide(row, 'approved')}>موافقة</button><button type="button" className="btn-secondary" disabled={row.locked || !row.evidence?.raw_minutes} onClick={() => decide(row, 'rejected')}>رفض</button></div></td>
      </tr>)}{!visible.length && <tr><td colSpan={12} className="p-4 text-center">لا يوجد تأخير مطابق للبحث</td></tr>}
    </tbody></table></fieldset>}
  </section>
}
