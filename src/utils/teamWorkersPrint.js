const escapeHtml = (value) => String(value ?? '—').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]))

export const teamWorkersForPrint = ({ team, workers = [], mappings = [] } = {}) => {
  const teamId = String(team?.id || '')
  if (!teamId) return []
  const idsByWorker = new Map()
  mappings.filter((mapping) => mapping.is_active === true && mapping.mapping_review_state === 'confirmed').forEach((mapping) => {
    const workerId = String(mapping.worker_id || '')
    const biometricId = String(mapping.device_employee_no || '').trim()
    if (!workerId || !biometricId) return
    if (!idsByWorker.has(workerId)) idsByWorker.set(workerId, new Set())
    idsByWorker.get(workerId).add(biometricId)
  })
  return workers.filter((worker) => String(worker.team_id || '') === teamId)
    .map((worker) => ({
      id: worker.id,
      name: worker.full_name || '—',
      employeeCode: worker.employee_code || '—',
      biometricIds: [...(idsByWorker.get(String(worker.id)) || [])],
      isActive: worker.is_active === true,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export const buildAllTeamWorkersPrintHtml = ({ teams = [], workers = [], mappings = [], labels, language = 'ar', direction = 'rtl' }) => {
  const groups = teams.map((team) => ({ team, rows: teamWorkersForPrint({ team, workers, mappings }) }))
  const totalWorkers = groups.reduce((count, group) => count + group.rows.length, 0)
  const headings = [labels.number, labels.worker, labels.employeeCode, labels.biometricId, labels.status]
    .map((label) => `<th>${escapeHtml(label)}</th>`).join('')
  const sections = groups.map(({ team, rows }) => {
    const body = rows.length ? rows.map((worker, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(worker.name)}</td><td>${escapeHtml(worker.employeeCode)}</td><td dir="ltr">${escapeHtml(worker.biometricIds.join(' · ') || '—')}</td><td>${escapeHtml(worker.isActive ? labels.active : labels.inactive)}</td></tr>`).join('')
      : `<tr><td colspan="5">${escapeHtml(labels.noMembers)}</td></tr>`
    return `<section class="team-section"><header class="team-header"><h2>${escapeHtml(team.name)}</h2><p>${escapeHtml(labels.workerCount)}: ${rows.length}</p></header><table><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table></section>`
  }).join('')
  return `<!doctype html><html lang="${escapeHtml(language)}" dir="${direction === 'ltr' ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><title>${escapeHtml(labels.printAllTitle)}</title><style>
    @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#17212b;font-family:Arial,Tahoma,sans-serif;font-size:11pt}h1,h2,p{margin:0}
    .report-summary{border-bottom:2px solid #334155;padding-bottom:5mm;margin-bottom:7mm}h1{font-size:19pt}.report-summary p{margin-top:2mm;font-weight:700}
    .team-section{margin-top:7mm}.team-section + .team-section{break-before:page;page-break-before:always}.team-header{break-after:avoid;page-break-after:avoid;margin-bottom:4mm}h2{font-size:16pt}.team-header p{margin-top:2mm;font-weight:700}
    table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:3mm 2mm;text-align:start;vertical-align:middle}th{background:#f1f5f9;font-weight:700}th:first-child,td:first-child{width:8%;text-align:center}td:nth-child(2){font-weight:700}
  </style></head><body><main><header class="report-summary"><h1>${escapeHtml(labels.printAllTitle)}</h1><p>${escapeHtml(labels.totalTeams)}: ${groups.length} · ${escapeHtml(labels.totalWorkers)}: ${totalWorkers}</p></header>${sections}</main></body></html>`
}

export const printAllTeamWorkers = (options) => {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  printWindow.document.write(buildAllTeamWorkersPrintHtml(options))
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
  return true
}
