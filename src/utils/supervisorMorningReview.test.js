import { describe, expect, it } from 'vitest'
import {
  isSupervisorFinalWindow, supervisorChoiceOutcome,
  supervisorReviewWorkerIds, unselectedSupervisorWorkerIds,
  savedSupervisorResults,
} from './supervisorMorningReview.js'

const groups = [
  { workers: [{ id: 'one' }, { id: 'two' }] },
  { workers: [{ id: 'three' }] },
]

describe('supervisor morning review', () => {
  it('restores matching outside-work O without requiring a manual override', () => {
    const row = { worker_id:'outside', attendance_date:'2026-10-29', status:'present',
      attendance_source:'outside_work', manual_override:false,
      biometric_sync_metadata:{ outside_work:{movement_ids:['final']}, supervisor_morning_review:{source:'supervisor_sheet',choice:'O'} } }
    const before=JSON.stringify(row)
    expect(savedSupervisorResults([row],'2026-10-29')).toEqual({outside:'O'})
    expect(savedSupervisorResults([{...row,attendance_source:'biometric'}],'2026-10-29')).toEqual({})
    expect(savedSupervisorResults([{...row,status:'absent'}],'2026-10-29')).toEqual({})
    expect(savedSupervisorResults([row],'2026-10-28')).toEqual({})
    expect(JSON.stringify(row)).toBe(before)
  })
  it('uses Kinshasa time: live before 11:00 and final at 11:00 inclusive', () => {
    expect(isSupervisorFinalWindow('2026-10-12', new Date('2026-10-12T09:59:59Z'))).toBe(false)
    expect(isSupervisorFinalWindow('2026-10-12', new Date('2026-10-12T10:00:00Z'))).toBe(true)
    expect(isSupervisorFinalWindow('2026-10-12', new Date('2026-10-12T10:30:00Z'))).toBe(true)
  })

  it('never resumes a prior day review after midnight', () => {
    expect(isSupervisorFinalWindow('2026-10-12', new Date('2026-10-13T00:00:00Z'))).toBe(true)
  })

  it('requires exactly one A/P/O/M choice for every frozen-list worker', () => {
    expect(supervisorReviewWorkerIds(groups)).toEqual(['one', 'two', 'three'])
    expect(unselectedSupervisorWorkerIds(groups, { one: 'P', two: 'M' })).toEqual(['three'])
    expect(unselectedSupervisorWorkerIds(groups, { one: 'P', two: 'M', three: 'O' })).toEqual([])
    expect(unselectedSupervisorWorkerIds(groups, { one: 'P', two: 'invalid', three: 'O' })).toEqual(['two'])
  })

  it.each([
    ['P', 'present', null], ['O', 'present', 'working_outside'],
    ['A', 'absent', null], ['M', 'absent', 'medical'],
  ])('%s maps to official %s with reason %s', (choice, status, reason) => {
    expect(supervisorChoiceOutcome(choice)).toEqual({ status, reason })
    expect(supervisorChoiceOutcome(choice).status).not.toBe('half_day')
  })
})
