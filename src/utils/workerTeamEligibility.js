// A team is an operational assignment. Only explicitly classified special / foreign
// staff may be unassigned. Payment type is payroll data and never controls
// attendance eligibility.
export const isSpecialStaffWorker = (worker = {}) => worker?.staff_classification === 'special_staff'

export const workerRequiresOperationalTeam = (worker = {}) => !isSpecialStaffWorker(worker)

export const hasAssignedTeam = (worker = {}) => Boolean(String(worker?.team_id || '').trim())

export const validateWorkerTeamAssignment = (worker = {}) => {
  if (workerRequiresOperationalTeam(worker) && !hasAssignedTeam(worker)) {
    throw new Error('A team is required for a normal operational worker.')
  }
}
