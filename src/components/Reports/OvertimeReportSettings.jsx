import React, { useEffect, useState } from 'react'
import { saveOvertimeReportSettings } from '../../api/overtimeReportSettingsApi.js'
import { useAuthStore } from '../../store/authStore.js'
import { useTranslation } from '../../i18n/LanguageContext.jsx'
import { getErrorMessage } from '../../api/axios.js'

export default function OvertimeReportSettings({ model }) {
  const admin = useAuthStore(state => state.admin)
  const { t } = useTranslation()
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { setDraft(model.settings.team_ids || []) }, [model.settings])
  if (!admin?.is_active) return null
  const save = async () => {
    setBusy(true); setMessage('')
    try { await saveOvertimeReportSettings(draft); await model.load(); setMessage(t('reports.overtimeSettingsSaved')) }
    catch (cause) { setMessage(getErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <section className="surface-card p-5">
    <h2 className="text-lg font-bold">{t('reports.overtimeSettingsTitle')}</h2>
    <p className="mt-2 text-sm text-(--muted)">{t('reports.overtimeSettingsDescription')}</p>
    <p className="my-2 text-sm text-(--muted)">{t('reports.overtimeMinimum')}</p>
    {model.error && <p role="alert">{model.error}</p>}
    <div className="flex flex-wrap gap-x-5 gap-y-2">{model.settings.teams.map(team => <label key={team.id} className="flex items-center gap-2"><input type="checkbox" checked={draft.includes(team.id)} disabled={busy || model.loading} onChange={e => setDraft(ids => e.target.checked ? [...ids, team.id] : ids.filter(id => id !== team.id))} />{team.name}</label>)}</div>
    <div className="mt-3 flex gap-2"><button type="button" className="btn-primary" disabled={busy || model.loading || Boolean(model.error)} onClick={save}>{t('common.save')}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => { setDraft(model.settings.team_ids || []); setMessage('') }}>{t('common.cancel')}</button></div>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </section>
}
