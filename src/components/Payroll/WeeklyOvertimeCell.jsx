import { useState } from 'react'
import { parseWeeklyDuration } from '../../utils/weeklyManualOvertime'
import { formatEveningOvertimeMinutes } from '../../utils/weeklyPayrollOvertime'
import { getErrorMessage } from '../../api/axios'

import { weeklyOvertimeLabels } from '../../utils/weeklyOvertimeInlineLabels'
export default function WeeklyOvertimeCell({ line, minutes, editable, onSave, language }) {
  const l = weeklyOvertimeLabels[language] || weeklyOvertimeLabels.en
  const [editing,setEditing] = useState(false), [value,setValue] = useState(''), [saving,setSaving] = useState(false), [error,setError] = useState('')
  const display = formatEveningOvertimeMinutes(minutes)
  const save = async (clear = false) => {
    const parsed = clear ? null : parseWeeklyDuration(value)
    if (!clear && parsed == null) { setError(l.invalid); return }
    setSaving(true); setError('')
    try { await onSave(line,parsed); setEditing(false) } catch(e) { setError(getErrorMessage(e)) } finally { setSaving(false) }
  }
  if (!editable || !onSave) return <><span>{display}</span>{!editable && <small className="block text-xs text-(--muted)">{l.locked}</small>}</>
  return <><span className="hidden print:inline">{display}</span><div className="print:hidden">
    {editing ? <div className="space-y-2"><input type="text" dir="ltr" className="input-base min-w-24" aria-label={`${l.title} — ${line.worker.full_name}`} value={value} disabled={saving} onChange={e=>setValue(e.target.value)} placeholder="25:30" />
      <div className="flex flex-wrap gap-1"><button type="button" className="btn-primary px-2 py-1" disabled={saving} onClick={()=>save()}>{l.save}</button><button type="button" className="btn-secondary px-2 py-1" disabled={saving} onClick={()=>{setEditing(false);setError('')}}>{l.cancel}</button>
      {line.weeklyManualOverrideMinutes != null && <button type="button" className="btn-secondary px-2 py-1" disabled={saving} onClick={()=>save(true)}>{l.clear}</button>}</div>{error && <p role="alert" className="text-xs text-red-700">{error}</p>}</div>
      : <button type="button" className="font-bold text-(--primary) hover:underline" aria-label={`${l.title} — ${line.worker.full_name}: ${display}`} onClick={()=>{setValue(`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`);setEditing(true)}}>{display}</button>}
  </div></>
}
