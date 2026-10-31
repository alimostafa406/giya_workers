// Informational projection only. Never feed these visitors into attendance or
// payroll populations: permanent workers.team_id remains the financial owner.
export function outsideWorkTeamMarkers(workers = [], movements = [], dates = [], teams = []) {
  const workerById = new Map(workers.map((worker) => [String(worker.id), worker]))
  const teamById = new Map(teams.map((team) => [String(team.id), team]))
  const groups = new Map()
  for (const movement of movements) {
    if (movement.status !== 'final' || !movement.team_id || !dates.includes(movement.work_date)) continue
    const teamId = String(movement.team_id)
    for (const participant of movement.outside_work_movement_workers || []) {
      const worker = workerById.get(String(participant.worker_id))
      if (!worker || String(worker.team_id) === teamId) continue
      if (!groups.has(teamId)) groups.set(teamId, { id: teamId,
        name: movement.team?.name || teamById.get(teamId)?.name || teamId, workers: new Map() })
      const group = groups.get(teamId)
      if (!group.workers.has(String(worker.id))) group.workers.set(String(worker.id), { worker, dates: new Set() })
      group.workers.get(String(worker.id)).dates.add(movement.work_date)
    }
  }
  return [...groups.values()].map((group) => ({ ...group,
    workers: [...group.workers.values()].map((entry) => ({ ...entry, dates: [...entry.dates].sort() })) }))
}

export const outsideWorkMarkerLabels = {
  ar: { title: 'عمال عمل خارجي مؤقت — للبيان فقط، لا يدخلون في الإجماليات', worker: 'العامل', code: 'الكود', team: 'الفريق الدائم' },
  en: { title: 'Temporary outside-work visitors — information only, excluded from totals', worker: 'Worker', code: 'Code', team: 'Permanent team' },
  fr: { title: 'Travailleurs extérieurs temporaires — information uniquement, exclus des totaux', worker: 'Travailleur', code: 'Code', team: 'Équipe permanente' },
}
