import { kinshasaClock } from './attendanceOperationalGate.js'

export const SUPERVISOR_FINAL_CHECK_MINUTES = 11 * 60
export const SUPERVISOR_CHOICES = ['A', 'P', 'O', 'M']

export const isSupervisorFinalWindow = (date, now = new Date()) => {
  const clock = kinshasaClock(now)
  return date < clock.date || (date === clock.date
    && clock.hour * 60 + clock.minute >= SUPERVISOR_FINAL_CHECK_MINUTES)
}

export const supervisorReviewWorkerIds = (groups = []) => groups
  .flatMap((group) => group.workers.map((worker) => String(worker.id)))

export const unselectedSupervisorWorkerIds = (groups = [], results = {}) =>
  supervisorReviewWorkerIds(groups).filter((id) => !SUPERVISOR_CHOICES.includes(results[id]))

export const supervisorChoiceOutcome = (choice) => ({
  P: { status: 'present', reason: null },
  O: { status: 'present', reason: 'working_outside' },
  A: { status: 'absent', reason: null },
  M: { status: 'absent', reason: 'medical' },
})[choice] || null
