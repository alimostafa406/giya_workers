import { useEffect, useState } from 'react'
import { getBiometricLatenessReviews, decideBiometricLateness } from '../api/biometricLatenessApi'
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
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setSources([]); setDrafts({})
    getBiometricLatenessReviews(date).then(rows => { if (active) setSources(rows) })
      .catch(e => { if (active) setError(getErrorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [date, reload])
  const teams = [...new Map(sources.map(row => [row.worker.team_id, row.worker.team_name])).entries()]
  const visible = sources.filter(row => (!team || row.worker.team_id === team) && (!status || latenessStatus(row) === status))
  const edit = (row, field, value) => setDrafts(old => ({ ...old, [row.worker.id]: {
    minutes: row.review?.approved_minutes ?? row.evidence?.raw_minutes ?? 0,
    note: '', ...old[row.worker.id], [field]: value,
  } }))
  const decide = async (row, decision) => {
    const draft = drafts[row.worker.id] || { minutes: row.review?.approved_minutes ?? row.evidence.raw_minutes, note: '' }
    const minutes = Number(draft.minutes)
    if (String(draft.minutes).trim() === '' || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { setError('أدخل دقائق تأخير صحيحة'); return }
    if (decision === 'approved' && automaticLateDeduction(row.calculation, minutes) == null) { setError(row.calculation?.unavailable_reason || 'الأجر أو الدوام المدفوع غير محدد'); return }
    setSaving(true); setError(''); setMessage('')
    try {
      await decideBiometricLateness(date, row, decision, minutes, draft.note || '')
      setMessage('تم حفظ القرار'); setReload(n => n + 1)
    } catch (e) { setError(getErrorMessage(e)); setReload(n => n + 1) }
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
    {loading ? <p role="status">جاري التحميل...</p> : <fieldset disabled={saving} className="surface-card overflow-x-auto p-3"><table className="w-full border-collapse text-sm"><thead><tr>{['العامل', 'الكود', 'الفريق', 'التاريخ', 'بداية الدوام', 'الدخول الحقيقي', 'التأخير من البصمة', 'التأخير المعتمد', 'خصم التأخير CDF', 'الحالة', 'القرار'].map(label => <th className="border p-2 text-start" key={label}>{label}</th>)}</tr></thead><tbody>
      {visible.map(row => <tr key={row.worker.id}>
        <td className="border p-2">{row.worker.full_name}</td><td className="border p-2">{row.worker.employee_code}</td><td className="border p-2">{row.worker.team_name}</td><td className="border p-2"><bdi dir="ltr">{date}</bdi></td>
        <td className="border p-2"><bdi dir="ltr">{clock(row.evidence?.scheduled_start)}</bdi></td><td className="border p-2"><bdi dir="ltr">{clock(row.evidence?.raw_check_in) !== '—' ? clock(row.evidence.raw_check_in) : row.attendance.check_in || '—'}</bdi></td>
        <td className="border p-2"><bdi dir="ltr">{row.evidence ? duration(row.evidence.raw_minutes) : '—'}</bdi>{latenessStatus(row) === 'stale' && <small className="block">الدليل السابق: <bdi dir="ltr">{duration(row.review.raw_minutes)}</bdi></small>}</td>
        <td className="border p-2"><input className="input-base w-24" type="number" min="0" max="1440" step="1" aria-label={`دقائق التأخير المعتمدة ${row.worker.full_name}`} disabled={row.locked || !row.evidence?.raw_minutes} value={drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence?.raw_minutes ?? 0} onChange={e => edit(row, 'minutes', e.target.value)} /><small><bdi dir="ltr">{duration(drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence?.raw_minutes)}</bdi></small></td>
        <td className="border p-2"><output aria-label={`خصم التأخير المحسوب ${row.worker.full_name}`}><bdi dir="ltr">{automaticLateDeduction(row.calculation, drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence?.raw_minutes) == null ? '—' : formatPayrollMoney(automaticLateDeduction(row.calculation, drafts[row.worker.id]?.minutes ?? row.review?.approved_minutes ?? row.evidence?.raw_minutes), { currency: 'CDF' })}</bdi></output>
          <small className="block">{row.calculation?.unavailable_reason || <><bdi dir="ltr">{row.calculation?.daily_wage}</bdi> ÷ {row.calculation?.scheduled_paid_minutes} min</>}</small>
          <small className="block">الخصم المطبق: <bdi dir="ltr">{formatPayrollMoney(latenessStatus(row) === 'approved' ? row.review.deduction_amount : 0, { currency: 'CDF' })}</bdi></small>
          <input className="input-base mt-1" aria-label={`سبب الخصم ${row.worker.full_name}`} placeholder="سبب / ملاحظات" maxLength={1000} disabled={row.locked} value={drafts[row.worker.id]?.note || ''} onChange={e => edit(row, 'note', e.target.value)} /></td>
        <td className="border p-2">{labels[latenessStatus(row)]}{row.locked && <small className="block">فترة الرواتب مقفلة</small>}</td>
        <td className="border p-2"><div className="flex gap-2"><button type="button" className="btn-primary" disabled={row.locked || !row.evidence?.raw_minutes || Boolean(row.calculation?.unavailable_reason)} onClick={() => decide(row, 'approved')}>موافقة</button><button type="button" className="btn-secondary" disabled={row.locked || !row.evidence?.raw_minutes} onClick={() => decide(row, 'rejected')}>رفض</button></div></td>
      </tr>)}{!visible.length && <tr><td colSpan={11} className="p-4 text-center">لا يوجد تأخير مطابق للبحث</td></tr>}
    </tbody></table></fieldset>}
  </section>
}
