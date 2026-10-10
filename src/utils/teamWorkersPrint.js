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

export const buildTeamWorkersPrintHtml = ({ team, workers, mappings, labels, language = 'ar', direction = 'rtl' }) => {
  const rows = teamWorkersForPrint({ team, workers, mappings })
  const body = rows.length ? rows.map((worker, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(worker.name)}</td><td>${escapeHtml(worker.employeeCode)}</td><td dir="ltr">${escapeHtml(worker.biometricIds.join(' · ') || '—')}</td><td>${escapeHtml(worker.isActive ? labels.active : labels.inactive)}</td></tr>`).join('')
    : `<tr><td colspan="5">${escapeHtml(labels.noMembers)}</td></tr>`
  return `<!doctype html><html lang="${escapeHtml(language)}" dir="${direction === 'ltr' ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><title>${escapeHtml(labels.printWorkers)} — ${escapeHtml(team.name)}</title><style>
    @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#17212b;font-family:Arial,Tahoma,sans-serif;font-size:11pt}h1,h2,p{margin:0}
    header{border-bottom:2px solid #334155;padding-bottom:6mm;margin-bottom:7mm}header p:first-child{font-size:10pt;color:#475569}h1{font-size:19pt;margin-top:2mm}header p:last-child{margin-top:3mm;font-weight:700}
    table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:3mm 2mm;text-align:start;vertical-align:middle}th{background:#f1f5f9;font-weight:700}th:first-child,td:first-child{width:8%;text-align:center}td:nth-child(2){font-weight:700}
  </style></head><body><main><header><p>${escapeHtml(labels.companyTitle)}</p><h1>${escapeHtml(team.name)}</h1><p>${escapeHtml(labels.workerCount)}: ${rows.length}</p></header><table><thead><tr>${[labels.number, labels.worker, labels.employeeCode, labels.biometricId, labels.status].map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></main></body></html>`
}

export const printTeamWorkers = (options) => {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  printWindow.document.write(buildTeamWorkersPrintHtml(options))
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
  return true
}
