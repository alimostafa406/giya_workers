export const workerControlSearchResults = (workers = [], mappings = [], query = '') => {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return []
  const ids = new Map()
  mappings.filter((mapping) => mapping.is_active === true && mapping.mapping_review_state === 'confirmed').forEach((mapping) => {
    const workerId = String(mapping.worker_id)
    const values = ids.get(workerId) || new Set()
    if (mapping.device_employee_no) values.add(String(mapping.device_employee_no))
    ids.set(workerId, values)
  })
  return workers.map((worker) => ({ worker, biometricIds: [...(ids.get(String(worker.id)) || [])] }))
    .filter(({ worker, biometricIds }) => (
      String(worker.full_name || '').toLocaleLowerCase().includes(term)
      || String(worker.employee_code || '').toLocaleLowerCase().includes(term)
      || biometricIds.some((id) => id.toLocaleLowerCase().includes(term))
    ))
    .sort((left, right) => String(left.worker.full_name || '').localeCompare(String(right.worker.full_name || '')))
}
