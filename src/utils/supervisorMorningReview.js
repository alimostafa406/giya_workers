import { kinshasaClock } from './attendanceOperationalGate.js'

export const SUPERVISOR_FINAL_CHECK_MINUTES = 11 * 60
export const SUPERVISOR_CHOICES = ['A', 'P', 'O', 'M']

export const savedSupervisorResults = (attendance = [], date) => Object.fromEntries(attendance
  .filter((row) => row.attendance_date === date && (row.manual_override === true
      || (row.attendance_source === 'outside_work' && row.status === 'present'
        && row.manual_override === false && !row.emergency_overtime_mode
        && row.biometric_sync_metadata?.supervisor_morning_review?.choice === 'O'))
    && row.biometric_sync_metadata?.supervisor_morning_review?.source === 'supervisor_sheet'
    && SUPERVISOR_CHOICES.includes(row.biometric_sync_metadata.supervisor_morning_review.choice))
  .map((row) => [String(row.worker_id), row.biometric_sync_metadata.supervisor_morning_review.choice]))

export const isSupervisorFinalWindow = (date, now = new Date()) => {
  const clock = kinshasaClock(now)
  return date < clock.date || (date === clock.date
    && clock.hour * 60 + clock.minute >= SUPERVISOR_FINAL_CHECK_MINUTES)
}

export const supervisorReviewWorkerIds = (groups = []) => groups
  .flatMap((group) => group.workers.map((worker) => String(worker.id)))

// Loading precedence only. User edits after loading remain intentional edits.
export const initialSupervisorChoices = (workerIds, official = {}, draft = {}) => Object.fromEntries(workerIds.map((id) => [String(id),
  SUPERVISOR_CHOICES.includes(official[id]) ? official[id] : SUPERVISOR_CHOICES.includes(draft[id]) ? draft[id] : 'A']))

export const unselectedSupervisorWorkerIds = (groups = [], results = {}) =>
  supervisorReviewWorkerIds(groups).filter((id) => !SUPERVISOR_CHOICES.includes(results[id]))

export const supervisorChoiceOutcome = (choice) => ({
  P: { status: 'present', reason: null },
  O: { status: 'present', reason: 'working_outside' },
  A: { status: 'absent', reason: null },
  M: { status: 'absent', reason: 'medical' },
})[choice] || null
