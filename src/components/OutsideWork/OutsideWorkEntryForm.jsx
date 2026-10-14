import { useMemo } from 'react'
import { outsideWorkOtherWorkers, outsideWorkTeamWorkers, searchOutsideWorkPeople } from '../../utils/outsideWorkRoster'
import { addOutsideWorkWorkers, changeOutsideWorkDate, editOutsideWorkWorkerTime } from '../../utils/outsideWork'

export default function OutsideWorkEntryForm({ value, onChange, workers, teams, biometricIds, labels: l, busy, onSave, onCancel }) {
  const entry = value.entry_state || {}
  const teamWorkers = useMemo(() => outsideWorkTeamWorkers(workers, value.work_date, value.team_id), [workers, value.work_date, value.team_id])
  const teamResults = entry.teamSearch?.trim() ? searchOutsideWorkPeople(teamWorkers, entry.teamSearch, biometricIds) : teamWorkers
  const otherResults = outsideWorkOtherWorkers(workers, value.work_date, value.team_id, entry.otherSearch || '', biometricIds).slice(0, 20)
  const workersById = useMemo(() => new Map(workers.map((worker) => [String(worker.id), worker])), [workers])
  const teamIds = new Set(teamWorkers.map((worker) => String(worker.id)))
  const selectedTeamCount = value.workers.filter((worker) => teamIds.has(String(worker.worker_id))).length
  const selectedTeamName = teams.find((team) => String(team.id) === String(value.team_id))?.name || value.team?.name || '—'
  const setEntry = (key, next) => onChange((current) => ({ ...current, entry_state: { ...current.entry_state, [key]: next } }))
  const addWorker = (worker) => onChange((current) => addOutsideWorkWorkers(current, [worker]))
  const removeWorker = (id) => onChange((current) => ({ ...current, workers: current.workers.filter((row) => row.worker_id !== id) }))
  const workerName = (row) => workersById.get(String(row.worker_id))?.full_name || row.worker_name || '—'

  return <form noValidate onSubmit={(event) => { event.preventDefault(); onSave('final') }}
    className="surface-card overflow-hidden rounded-2xl border border-(--border) shadow-sm" aria-label={l.formTitle}>
    <div className="border-b border-(--border) bg-(--surface-subtle) px-5 py-4"><h2 className="text-lg font-extrabold">{value.id ? l.editTitle : l.formTitle}</h2></div>
    <fieldset disabled={busy} className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-bold">{l.date}<input aria-label={l.date} type="date" value={value.work_date} onChange={(event) => onChange((current) => changeOutsideWorkDate(current, event.target.value))} className="input-base mt-1 w-full" /></label>
        <label className="block text-sm font-bold">{l.team}<select aria-label={l.team} value={value.team_id} onChange={(event) => onChange((current) => ({ ...current, team_id: event.target.value, entry_state: { ...current.entry_state, teamSearch: '', otherSearch: '' } }))} className="input-base mt-1 w-full">
          <option value="">{l.chooseTeam}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          {value.team_id && !teams.some((team) => String(team.id) === String(value.team_id)) && <option value={value.team_id}>{selectedTeamName}</option>}
        </select></label>
      </div>
      {value.team_id && <section className="space-y-3 rounded-xl border border-(--border) p-3" aria-label={l.teamWorkers}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">{l.teamWorkers} — {selectedTeamName}</h3><span className="text-sm font-bold">{l.selected}: {selectedTeamCount} {l.of} {teamWorkers.length}</span></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => onChange((current) => addOutsideWorkWorkers(current, teamWorkers))}>{l.selectAll}</button>
          <button type="button" className="btn-secondary" onClick={() => onChange((current) => ({ ...current, workers: current.workers.filter((row) => !teamIds.has(String(row.worker_id))) }))}>{l.deselectAll}</button></div>
        <input aria-label={l.teamSearch} placeholder={l.teamSearch} value={entry.teamSearch || ''} onChange={(event) => setEntry('teamSearch', event.target.value)} className="input-base w-full" />
        <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{teamResults.map((worker) => <label key={worker.id} className="flex items-center gap-2 rounded-lg bg-(--surface-subtle) px-3 py-2 text-sm">
          <input type="checkbox" checked={value.workers.some((row) => String(row.worker_id) === String(worker.id))} onChange={(event) => event.target.checked ? addWorker(worker) : removeWorker(worker.id)} />
          <span>{worker.full_name}<small className="ms-2 text-(--muted)">{worker.employee_code || ''}</small></span>
        </label>)}{!teamResults.length && <p className="text-sm text-(--muted)">{l.noMatches}</p>}</div>
      </section>}
      {value.team_id && <section className="max-w-lg space-y-2">
        <label className="block text-sm font-bold">{l.otherSearch}<input aria-label={l.otherSearch} placeholder={l.otherPlaceholder} value={entry.otherSearch || ''} onChange={(event) => setEntry('otherSearch', event.target.value)} className="input-base mt-1 w-full" /></label>
        {entry.otherSearch?.trim() && <div className="max-h-44 overflow-y-auto rounded-xl border border-(--border) p-2" role="listbox" aria-label={l.otherTeams}>
          {otherResults.map((worker) => <button type="button" role="option" aria-selected={value.workers.some((row) => String(row.worker_id) === String(worker.id))} key={worker.id} onClick={() => addWorker(worker)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm hover:bg-(--primary-soft)">
            <span>{worker.full_name} · {worker.employee_code || '—'}<small className="ms-2 text-(--muted)">{worker.team_name}</small></span><span aria-hidden="true">+</span>
          </button>)}{!otherResults.length && <p className="px-3 py-2 text-sm text-(--muted)">{l.noMatches}</p>}
        </div>}
      </section>}
      <section aria-label={l.selectedWorkers}><h3 className="mb-2 text-sm font-extrabold">{l.selectedWorkers} ({value.workers.length})</h3>
        {value.workers.length > 0 && <div className="overflow-x-auto rounded-xl border border-(--border)"><table className="w-full text-sm">
          <thead className="bg-(--surface-subtle)"><tr>{[l.workers, l.team, l.start, l.end, l.removeWorker].map((label) => <th key={label} className="px-3 py-2 text-start font-bold">{label}</th>)}</tr></thead>
          <tbody>{value.workers.map((row) => {
            const worker = workersById.get(String(row.worker_id))
            const external = String(worker?.team_id || '') !== String(value.team_id || '')
            return <tr key={row.worker_id} className="border-t border-(--border)">
              <td className="px-3 py-2 font-semibold">{workerName(row)}</td>
              <td className="px-3 py-2">{worker?.team_name || '—'}{external && <small className="ms-2 rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">{l.otherTeams}</small>}</td>
              <td className="px-3 py-2"><input aria-label={workerName(row) + ' ' + l.start} type="time" value={row.start_time} onChange={(event) => onChange((current) => editOutsideWorkWorkerTime(current, row.worker_id, 'start_time', event.target.value))} className="input-base w-32" /></td>
              <td className="px-3 py-2"><input aria-label={workerName(row) + ' ' + l.end} type="time" value={row.end_time} onChange={(event) => onChange((current) => editOutsideWorkWorkerTime(current, row.worker_id, 'end_time', event.target.value))} className="input-base w-32" /></td>
              <td className="px-3 py-2"><button type="button" aria-label={l.removeWorker + ': ' + workerName(row)} onClick={() => removeWorker(row.worker_id)} className="text-xl leading-none text-(--muted) hover:text-red-600">×</button></td>
            </tr>
          })}</tbody>
        </table></div>}
      </section>
      <div className="flex flex-wrap gap-2 border-t border-(--border) pt-4"><button type="submit" className="btn-primary">{l.saveFinal}</button><button type="button" onClick={() => onSave('draft')} className="btn-secondary">{l.saveDraft}</button><button type="button" onClick={onCancel} className="btn-secondary">{l.cancel}</button></div>
    </fieldset>
  </form>
}
