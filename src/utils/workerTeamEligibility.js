// A team is an operational assignment.  Special/foreign and monthly staff can
// legitimately be unassigned, while normal weekly workers cannot.
export const isSpecialOrMonthlyWorker = (worker = {}) => (
  worker?.staff_classification === 'special_staff'
  || worker?.payment_type === 'monthly'
)

export const workerRequiresOperationalTeam = (worker = {}) => !isSpecialOrMonthlyWorker(worker)

export const hasAssignedTeam = (worker = {}) => Boolean(String(worker?.team_id || '').trim())

export const validateWorkerTeamAssignment = (worker = {}) => {
  if (workerRequiresOperationalTeam(worker) && !hasAssignedTeam(worker)) {
    throw new Error('A team is required for a normal operational worker.')
  }
}
