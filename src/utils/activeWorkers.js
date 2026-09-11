export const isActiveWorker = (worker) => worker?.is_active === true

export const activeWorkersOnly = (workers = []) => (
  (Array.isArray(workers) ? workers : []).filter(isActiveWorker)
)
