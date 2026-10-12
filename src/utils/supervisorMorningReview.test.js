import { describe, expect, it } from 'vitest'
import {
  isSupervisorFinalWindow, supervisorChoiceOutcome,
  supervisorReviewWorkerIds, unselectedSupervisorWorkerIds,
} from './supervisorMorningReview.js'

const groups = [
  { workers: [{ id: 'one' }, { id: 'two' }] },
  { workers: [{ id: 'three' }] },
]

describe('supervisor morning review', () => {
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
