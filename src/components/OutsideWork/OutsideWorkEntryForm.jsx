import { useMemo, useState } from 'react'
import { outsideWorkForemen, outsideWorkOtherWorkers, outsideWorkTeamWorkers, searchOutsideWorkPeople } from '../../utils/outsideWorkRoster'
import { changeOutsideWorkDate, editOutsideWorkTime, outsideWorkFinalError } from '../../utils/outsideWork'

export default function OutsideWorkEntryForm({ value, onChange, workers, teams, biometricIds, labels: l, busy, onSave, onCancel, onOpenWorkers }) {
  const entry = value.entry_state || {}
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [selectedOpen, setSelectedOpen] = useState(false)
  const teamWorkers = useMemo(() => outsideWorkTeamWorkers(workers, value.work_date, value.team_id), [workers, value.work_date, value.team_id])
  const teamResults = entry.teamSearch?.trim() ? searchOutsideWorkPeople(teamWorkers, entry.teamSearch, biometricIds) : teamWorkers
  const otherResults = outsideWorkOtherWorkers(workers, value.work_date, value.team_id, entry.otherSearch || '', biometricIds).slice(0, 20)
  const foreignForemen = useMemo(() => outsideWorkForemen(workers), [workers])
  const foremanResults = searchOutsideWorkPeople(foreignForemen, entry.foremanSearch || '').slice(0, 12)
  const workersById = useMemo(() => new Map(workers.map((worker) => [String(worker.id), worker])), [workers])
  const teamIds = new Set(teamWorkers.map((worker) => String(worker.id)))
  const selectedTeamCount = value.workers.filter((worker) => teamIds.has(String(worker.worker_id))).length
  const primary = value.workers.filter((row) => value.team_id && String(workersById.get(String(row.worker_id))?.team_id) === String(value.team_id))
  const external = value.workers.filter((row) => !primary.includes(row))
  const selectedTeamName = teams.find((team) => String(team.id) === String(value.team_id))?.name || value.team?.name || '—'
  const manual = entry.manualForeman ?? (!value.foreman_worker_id && Boolean(value.foreman_name))
  const setField = (key, next) => onChange((current) => key === 'start_time' || key === 'end_time'
    ? editOutsideWorkTime(current, key, next) : { ...current, [key]: next })
  const setEntry = (key, next) => onChange((current) => ({ ...current, entry_state: { ...current.entry_state, [key]: next } }))
  const newWorker = (worker) => ({ worker_id: worker.id, worker_name: worker.full_name,
    start_time: value.common_worker_start, end_time: value.common_worker_end })
  const addWorker = (worker) => onChange((current) => current.workers.some((row) => String(row.worker_id) === String(worker.id))
    ? current : { ...current, workers: [...current.workers, newWorker(worker)] })
  const removeWorker = (id) => onChange((current) => ({ ...current, workers: current.workers.filter((row) => row.worker_id !== id) }))
  const changeCommon = (field, next) => onChange((current) => editOutsideWorkTime(current, field, next))
  const changeWorkerTime = (id, field, next) => onChange((current) => ({ ...current,
    workers: current.workers.map((row) => row.worker_id === id ? { ...row, [field]: next } : row),
    entry_state: { ...current.entry_state, overrides: { ...current.entry_state?.overrides,
      [id]: { ...current.entry_state?.overrides?.[id], [field]: true } } },
  }))
  const workerName = (row) => workersById.get(String(row.worker_id))?.full_name || row.worker_name || '—'
  const chips = (rows, showTeam) => <div className="mt-2 flex flex-wrap gap-2">{rows.map((row) =>
    <span key={row.worker_id} className="inline-flex items-center gap-2 rounded-full border border-(--border) bg-(--surface-subtle) px-3 py-1.5 text-sm font-semibold">
      {workerName(row)}{showTeam && <small className="text-(--muted)">— {workersById.get(String(row.worker_id))?.team_name || '—'}</small>}
      <button type="button" aria-label={`${l.removeWorker}: ${workerName(row)}`} onClick={() => removeWorker(row.worker_id)} className="text-lg leading-none text-(--muted) hover:text-red-600">×</button>
    </span>)}</div>

  return <form noValidate onSubmit={(event) => {
    event.preventDefault()
    if (['selectForemanError', 'unresolved'].includes(outsideWorkFinalError(value))) setAdvancedOpen(true)
    onSave('final')
  }} className="surface-card overflow-hidden rounded-2xl border border-(--border) shadow-sm" aria-label={l.formTitle}>
    <div className="border-b border-(--border) bg-(--surface-subtle) px-5 py-4"><h2 className="text-lg font-extrabold">{value.id ? l.editTitle : l.formTitle}</h2></div>
    <fieldset disabled={busy} className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-bold">{l.date}<input aria-label={l.date} type="date" value={value.work_date} onChange={(event) => onChange((current) => changeOutsideWorkDate(current, event.target.value))} className="input-base mt-1 w-full" /></label>
        <label className="block text-sm font-bold">{l.team}<select aria-label={l.team} value={value.team_id} onChange={(event) => { setField('team_id', event.target.value); setEntry('teamSearch', ''); setEntry('otherSearch', '') }} className="input-base mt-1 w-full">
          <option value="">{l.chooseTeam}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          {value.team_id && !teams.some((team) => String(team.id) === String(value.team_id)) && <option value={value.team_id}>{selectedTeamName}</option>}
        </select></label>
      </div>
      {value.team_id && <section className="space-y-3 rounded-xl border border-(--border) p-4" aria-label={l.teamWorkers}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">{l.teamWorkers} — {selectedTeamName}</h3><span className="text-sm font-bold">{l.selected}: {selectedTeamCount} {l.of} {teamWorkers.length}</span></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => onChange((current) => ({ ...current,
          workers: [...current.workers, ...teamWorkers.filter((worker) => !current.workers.some((row) => String(row.worker_id) === String(worker.id))).map(newWorker)] }))}>{l.selectAll}</button>
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
      <section><button type="button" aria-expanded={selectedOpen} onClick={() => setSelectedOpen((open) => !open)} className="text-sm font-bold text-(--muted)">{l.selectedWorkers} ({value.workers.length}) <span aria-hidden="true">{selectedOpen ? '−' : '+'}</span></button>
        {selectedOpen && primary.length > 0 && <div className="mt-2"><p className="text-xs font-bold text-(--muted)">{l.team}: {selectedTeamName}</p>{chips(primary, false)}</div>}
        {selectedOpen && external.length > 0 && <div className="mt-2"><p className="text-xs font-bold text-(--muted)">{l.otherTeams}</p>{chips(external, true)}</div>}
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-bold">{l.commonStart}<input aria-label={l.commonStart} type="time" value={value.common_worker_start} onChange={(event) => changeCommon('common_worker_start', event.target.value)} className="input-base mt-1 w-full" /></label>
        <label className="block text-sm font-bold">{l.commonEnd}<input aria-label={l.commonEnd} type="time" value={value.common_worker_end} onChange={(event) => changeCommon('common_worker_end', event.target.value)} className="input-base mt-1 w-full" /></label>
      </div>
      <button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)} className="text-sm font-semibold text-(--muted)">{l.advanced} <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span></button>
      {advancedOpen && <div className="space-y-4 rounded-xl border border-(--border) bg-(--surface-subtle) p-4">
      <section className="relative border-t border-(--border) pt-5"><h3 className="mb-2 text-sm font-extrabold">{l.foreman}</h3>
        {value.foreman_worker_id && !manual ? <div className="flex items-center justify-between gap-3 rounded-xl bg-(--primary-soft) px-3 py-2"><strong>{value.foreman_name}</strong><button type="button" className="text-sm font-bold" onClick={() => onChange((current) => ({ ...current, foreman_worker_id: '', foreman_name: '' }))}>{l.changeForeman}</button></div>
          : manual ? <input aria-label={l.manualName} value={value.foreman_name} onChange={(event) => setField('foreman_name', event.target.value)} className="input-base w-full" />
            : <><input aria-label={l.searchForeman} placeholder={l.searchForeman} value={entry.foremanSearch || ''} onChange={(event) => setEntry('foremanSearch', event.target.value)} className="input-base w-full" />
              {entry.foremanSearch?.trim() && <div className="mt-1 max-h-44 overflow-y-auto rounded-xl border border-(--border) p-1" role="listbox" aria-label={l.foreman}>
                {foremanResults.map((worker) => <button type="button" role="option" aria-selected="false" key={worker.id} onClick={() => onChange((current) => ({ ...current, foreman_worker_id: worker.id, foreman_name: worker.full_name, entry_state: { ...current.entry_state, foremanSearch: '', manualForeman: false } }))} className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-(--primary-soft)">{worker.full_name} · {worker.employee_code || '—'}</button>)}
                {!foremanResults.length && <p className="px-3 py-2 text-sm text-(--muted)">{l.noMatches}</p>}
              </div>}</>}
        {!value.foreman_worker_id && <button type="button" className="mt-2 text-xs text-(--muted) underline" onClick={() => onChange((current) => ({ ...current, foreman_name: '', entry_state: { ...current.entry_state, manualForeman: !manual, foremanSearch: '' } }))}>{manual ? l.searchForeman : l.manualToggle}</button>}
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-bold">{l.foreman} — {l.start}<input aria-label={`Foreman ${l.start}`} type="time" value={value.start_time} onChange={(event) => setField('start_time', event.target.value)} className="input-base mt-1 w-full" /></label>
        <label className="block text-sm font-bold">{l.foreman} — {l.end}<input aria-label={`Foreman ${l.end}`} type="time" value={value.end_time} onChange={(event) => setField('end_time', event.target.value)} className="input-base mt-1 w-full" /></label>
      </div>
      {value.workers.length > 0 && <details className="rounded-xl border border-(--border) p-3"><summary className="cursor-pointer text-sm font-bold">{l.override}</summary><div className="mt-3 space-y-2">{value.workers.map((row) => <div key={row.worker_id} className="grid items-center gap-2 rounded-lg bg-(--surface-subtle) p-2 text-sm sm:grid-cols-3"><strong>{workerName(row)}</strong><label>{l.start}<input aria-label={`${workerName(row)} ${l.start}`} type="time" value={row.start_time} onChange={(event) => changeWorkerTime(row.worker_id, 'start_time', event.target.value)} className="input-base mt-1 w-full" /></label><label>{l.end}<input aria-label={`${workerName(row)} ${l.end}`} type="time" value={row.end_time} onChange={(event) => changeWorkerTime(row.worker_id, 'end_time', event.target.value)} className="input-base mt-1 w-full" /></label></div>)}</div></details>}
      <label className="block text-sm font-bold">{l.note}<input aria-label={l.note} value={value.note} onChange={(event) => setField('note', event.target.value)} className="input-base mt-1 w-full" /></label>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><label className="block text-sm font-bold">{l.missingWorker}<textarea aria-label={l.missingWorker} value={value.missing_worker_note} onChange={(event) => setField('missing_worker_note', event.target.value)} rows="2" className="input-base mt-1 w-full" /></label><button type="button" onClick={onOpenWorkers} className="btn-secondary mt-3">{l.openWorkers}</button><p className="mt-2 text-xs text-(--muted)">{l.savedBeforeWorkers}</p></section>
      </div>}
      <div className="flex flex-wrap gap-2 border-t border-(--border) pt-4"><button type="submit" className="btn-primary">{l.saveFinal}</button><button type="button" onClick={() => onSave('draft')} className="btn-secondary">{l.saveDraft}</button><button type="button" onClick={onCancel} className="btn-secondary">{l.cancel}</button></div>
    </fieldset>
  </form>
}
