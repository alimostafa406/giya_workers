const asArray = (value) => (Array.isArray(value) ? value : [])

export const buildInactiveWorkerRows = ({ workers = [], mappings = [], unresolvedEvents = [] } = {}) => {
  const mappingsByWorker = new Map()
  asArray(mappings).forEach((mapping) => {
    if (!mapping?.worker_id) return
    const workerId = String(mapping.worker_id)
    mappingsByWorker.set(workerId, [...(mappingsByWorker.get(workerId) || []), mapping])
  })

  const eventsByWorker = new Map()
  asArray(unresolvedEvents).forEach((event) => {
    if ((event?.resolution_reason && event.resolution_reason !== 'inactive_worker') || !event?.worker_id) return
    const workerId = String(event.worker_id)
    eventsByWorker.set(workerId, [...(eventsByWorker.get(workerId) || []), event])
  })

  return asArray(workers)
    .filter((worker) => worker?.is_active === false)
    .map((worker) => {
      const workerEvents = eventsByWorker.get(String(worker.id)) || []
      const latestEvent = [...workerEvents].sort((left, right) => (
        new Date(right.event_timestamp || 0).getTime() - new Date(left.event_timestamp || 0).getTime()
      ))[0] || null
      return {
        ...worker,
        biometricMappings: mappingsByWorker.get(String(worker.id)) || [],
        biometricEventsToday: workerEvents,
        latestBiometricEvent: latestEvent,
      }
    })
    .sort((left, right) => String(left.full_name || '').localeCompare(String(right.full_name || '')))
}
