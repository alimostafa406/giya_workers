import { describe, it, expect } from 'vitest'
import { eligibleTeamForemen, resolveTeamForeman, selectOutsideWorkTeam } from './teamForeman.js'
import { teamWorkersForPrint } from './teamWorkersPrint.js'
import { mergeAttendanceRoster } from './attendanceRoster.js'
import { isCompensationReviewWorker } from './compensationReview.js'

const team = { id: 'paint', name: 'Paint', foreman_worker_id: 'foreman' }
const workers = [
  { id: 'normal', full_name: 'Worker', team_id: 'paint', team_name: 'Paint', is_active: true, staff_classification: 'normal' },
  { id: 'foreman', full_name: 'Foreman', team_id: null, is_active: true, staff_classification: 'special_staff' },
  { id: 'inactive', is_active: false, staff_classification: 'special_staff' },
]
describe('team responsibility isolated from membership', () => {
  it('allows only active canonical special staff, never monthly-paid normal workers', () => {
    expect(eligibleTeamForemen(workers).map((worker) => worker.id)).toEqual(['foreman'])
    expect(resolveTeamForeman(team, workers)?.id).toBe('foreman')
    expect(resolveTeamForeman({ ...team, foreman_worker_id: 'normal' }, workers)).toBeNull()
    expect(resolveTeamForeman({ ...team, foreman_worker_id: 'inactive' }, workers)).toBeNull()
  })
  it('defaults the movement foreman without changing workers, selected workers, or time ranges', () => {
    const before = structuredClone(workers)
    const form = { workers: [{ worker_id: 'normal' }], start_time: '08:00', end_time: '20:00', common_worker_end: '18:00' }
    expect(selectOutsideWorkTeam(form, 'paint', [team], workers)).toMatchObject({ ...form, foreman_worker_id: 'foreman', foreman_name: 'Foreman' })
    expect(workers).toEqual(before)
    expect(selectOutsideWorkTeam(form, 'other', [team], workers).foreman_worker_id).toBe('')
  })
  it('never adds a linked foreman to team counts, print, attendance, or normal compensation', () => {
    expect(workers.filter((worker) => worker.is_active && worker.team_id === team.id).map((worker) => worker.id)).toEqual(['normal'])
    expect(teamWorkersForPrint({ team, workers }).map((row) => row.id)).toEqual(['normal'])
    expect(mergeAttendanceRoster({ workers, date: '2026-10-14', businessDate: '2026-10-14', teamId: team.id }).map((row) => row.worker_id)).toEqual(['normal'])
    expect(workers.filter(isCompensationReviewWorker).map((worker) => worker.id)).toEqual(['normal'])
  })
})
