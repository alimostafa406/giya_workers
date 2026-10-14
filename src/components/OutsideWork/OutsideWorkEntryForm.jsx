import { useMemo } from 'react'
import { outsideWorkForemen, outsideWorkOtherWorkers, outsideWorkTeamWorkers, searchOutsideWorkPeople } from '../../utils/outsideWorkRoster'
import { addOutsideWorkWorkers, changeOutsideWorkDate, editOutsideWorkTime } from '../../utils/outsideWork'
import './OutsideWorkEntryForm.css'

export default function OutsideWorkEntryForm({ value, onChange, workers, teams, biometricIds, labels: l, busy, onSave, onCancel }) {
  const entry = value.entry_state || {}
  const teamWorkers = useMemo(() => outsideWorkTeamWorkers(workers, value.work_date, value.team_id), [workers, value.work_date, value.team_id])
  const teamResults = entry.teamSearch?.trim() ? searchOutsideWorkPeople(teamWorkers, entry.teamSearch, biometricIds) : teamWorkers
  const otherResults = outsideWorkOtherWorkers(workers, value.work_date, value.team_id, entry.otherSearch || '', biometricIds).slice(0, 20)
  const workersById = useMemo(() => new Map(workers.map((worker) => [String(worker.id), worker])), [workers])
  const foremen = useMemo(() => outsideWorkForemen(workers), [workers])
  const foremanResults = searchOutsideWorkPeople(foremen, entry.foremanSearch || '').slice(0, 12)
  const differingSavedTimes = Boolean(value.id && value.workers.some((row) => row.start_time !== value.common_worker_start || row.end_time !== value.common_worker_end))
  const teamIds = new Set(teamWorkers.map((worker) => String(worker.id)))
  const selectedTeamCount = value.workers.filter((worker) => teamIds.has(String(worker.worker_id))).length
  const selectedTeamName = teams.find((team) => String(team.id) === String(value.team_id))?.name || value.team?.name || '—'
  const setEntry = (key, next) => onChange((current) => ({ ...current, entry_state: { ...current.entry_state, [key]: next } }))
  const addWorker = (worker) => onChange((current) => addOutsideWorkWorkers(current, [worker]))
  const removeWorker = (id) => onChange((current) => ({ ...current, workers: current.workers.filter((row) => row.worker_id !== id) }))
  const workerName = (row) => workersById.get(String(row.worker_id))?.full_name || row.worker_name || '—'

  return <form noValidate onSubmit={(event) => { event.preventDefault(); onSave('final') }}
    className="outside-work-entry surface-card overflow-hidden rounded-2xl border border-(--border) shadow-sm" aria-label={l.formTitle}>
    <div className="border-b border-(--border) bg-(--surface-subtle) px-5 py-4"><h2 className="text-lg font-extrabold">{value.id ? l.editTitle : l.formTitle}</h2></div>
    <fieldset disabled={busy} className="outside-work-entry-body">
      <div className="outside-work-entry-fields">
        <label className="outside-work-field"><span>{l.date}</span><input aria-label={l.date} type="date" value={value.work_date} onChange={(event) => onChange((current) => changeOutsideWorkDate(current, event.target.value))} className="input-base" /></label>
        <label className="outside-work-field"><span>{l.team}</span><select aria-label={l.team} value={value.team_id} onChange={(event) => onChange((current) => ({ ...current, team_id: event.target.value, entry_state: { ...current.entry_state, teamSearch: '', otherSearch: '' } }))} className="input-base">
          <option value="">{l.chooseTeam}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          {value.team_id && !teams.some((team) => String(team.id) === String(value.team_id)) && <option value={value.team_id}>{selectedTeamName}</option>}
        </select></label>
      </div>
      {value.team_id && <section className="space-y-3 rounded-xl border border-(--border) p-3" aria-label={l.teamWorkers}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">{l.teamWorkers} — {selectedTeamName}</h3><span className="text-sm font-bold">{l.selected}: {selectedTeamCount} {l.of} {teamWorkers.length}</span></div>
        <div className="outside-work-small-actions"><button type="button" className="btn-secondary" onClick={() => onChange((current) => addOutsideWorkWorkers(current, teamWorkers))}>{l.selectAll}</button>
          <button type="button" className="btn-secondary" onClick={() => onChange((current) => ({ ...current, workers: current.workers.filter((row) => !teamIds.has(String(row.worker_id))) }))}>{l.deselectAll}</button></div>
        <input aria-label={l.teamSearch} placeholder={l.teamSearch} value={entry.teamSearch || ''} onChange={(event) => setEntry('teamSearch', event.target.value)} className="input-base w-full" />
        <ul className="outside-work-worker-list">{teamResults.map((worker) => <li key={worker.id}><label className="outside-work-worker-row">
          <input type="checkbox" checked={value.workers.some((row) => String(row.worker_id) === String(worker.id))} onChange={(event) => event.target.checked ? addWorker(worker) : removeWorker(worker.id)} />
          <span className="outside-work-worker-name">{worker.full_name}</span>{' '}{worker.employee_code && <small className="outside-work-worker-code" dir="ltr">#{worker.employee_code}</small>}
        </label></li>)}{!teamResults.length && <li className="text-sm text-(--muted)">{l.noMatches}</li>}</ul>
      </section>}
      {value.team_id && <section className="max-w-lg space-y-2">
        <label className="outside-work-field"><span>{l.otherSearch}</span><input aria-label={l.otherSearch} placeholder={l.otherPlaceholder} value={entry.otherSearch || ''} onChange={(event) => setEntry('otherSearch', event.target.value)} className="input-base" /></label>
        {entry.otherSearch?.trim() && <div className="max-h-44 overflow-y-auto rounded-xl border border-(--border) p-2" role="listbox" aria-label={l.otherTeams}>
          {otherResults.map((worker) => <button type="button" role="option" aria-selected={value.workers.some((row) => String(row.worker_id) === String(worker.id))} key={worker.id} onClick={() => addWorker(worker)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm hover:bg-(--primary-soft)">
            <span>{worker.full_name} · {worker.employee_code || '—'}<small className="ms-2 text-(--muted)">{worker.team_name}</small></span><span aria-hidden="true">+</span>
          </button>)}{!otherResults.length && <p className="px-3 py-2 text-sm text-(--muted)">{l.noMatches}</p>}
        </div>}
      </section>}
      <section aria-label={l.selectedWorkers}><h3 className="mb-2 text-sm font-extrabold">{l.selectedWorkers} ({value.workers.length})</h3>
        {value.workers.length > 0 && <div className="overflow-x-auto rounded-xl border border-(--border)"><table className="w-full text-sm">
          <thead className="bg-(--surface-subtle)"><tr>{[l.workers, l.team, l.removeWorker].map((label) => <th key={label} className="px-3 py-2 text-start font-bold">{label}</th>)}</tr></thead>
          <tbody>{value.workers.map((row) => {
            const worker = workersById.get(String(row.worker_id))
            const external = String(worker?.team_id || '') !== String(value.team_id || '')
            return <tr key={row.worker_id} className="border-t border-(--border)">
              <td className="px-3 py-2 font-semibold">{workerName(row)}</td>
              <td className="px-3 py-2">{worker?.team_name || '—'}{external && <small className="ms-2 rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">{l.otherTeams}</small>}</td>
              <td className="px-3 py-2"><button type="button" aria-label={l.removeWorker + ': ' + workerName(row)} onClick={() => removeWorker(row.worker_id)} className="text-xl leading-none text-(--muted) hover:text-red-600">×</button></td>
            </tr>
          })}</tbody>
        </table></div>}
      </section>
      <div className="outside-work-ranges">
      <section className="outside-work-range">
        <h3 className="text-sm font-bold">{l.foreman}</h3>
        {value.foreman_worker_id || value.foreman_name ? <div className="flex items-center justify-between gap-2 rounded-lg bg-(--surface-subtle) px-3 py-2 text-sm"><strong>{value.foreman_name}</strong><button type="button" onClick={() => onChange((current) => ({ ...current, foreman_worker_id: '', foreman_name: '' }))} className="text-xs font-semibold text-(--muted)">{l.changeForeman}</button></div>
          : <><input aria-label={l.searchForeman} placeholder={l.searchForeman} value={entry.foremanSearch || ''} onChange={(event) => setEntry('foremanSearch', event.target.value)} className="input-base w-full" />
            {entry.foremanSearch?.trim() && <div role="listbox" aria-label={l.foreman} className="max-h-36 overflow-y-auto rounded-lg border border-(--border) p-1">{foremanResults.map((worker) => <button type="button" role="option" aria-selected="false" key={worker.id} className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-(--primary-soft)" onClick={() => onChange((current) => ({ ...current, foreman_worker_id: worker.id, foreman_name: worker.full_name, entry_state: { ...current.entry_state, foremanSearch: '' } }))}>{worker.full_name} · {worker.employee_code || '—'}</button>)}{!foremanResults.length && <p className="px-3 py-2 text-sm text-(--muted)">{l.noMatches}</p>}</div>}</>}
        <div className="outside-work-time-fields">{[['start_time', l.start], ['end_time', l.end]].map(([field, label]) => <label key={field} className="outside-work-field"><span>{label}</span><input aria-label={`Foreman ${label}`} type="time" value={value[field]} onChange={(event) => onChange((current) => editOutsideWorkTime(current, field, event.target.value))} className="input-base" /></label>)}</div>
      </section>
        <section className="outside-work-range"><h3>{l.workers}</h3><div className="outside-work-time-fields">{[['common_worker_start', l.start], ['common_worker_end', l.end]].map(([field, label]) => <label key={field} className="outside-work-field"><span>{label}</span><input aria-label={`${l.workers} ${label}`} type="time" value={value[field]} onChange={(event) => onChange((current) => editOutsideWorkTime(current, field, event.target.value))} className="input-base" /></label>)}</div></section>
      </div>
      {differingSavedTimes && <p className="text-xs text-(--muted)">{l.historyTimes}</p>}
      <div className="outside-work-actions"><button type="submit" className="btn-primary">{l.saveFinal}</button><button type="button" onClick={() => onSave('draft')} className="btn-secondary">{l.saveDraft}</button><button type="button" onClick={onCancel} className="btn-secondary">{l.cancel}</button></div>
    </fieldset>
  </form>
}
