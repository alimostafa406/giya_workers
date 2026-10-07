import { describe, expect, it } from 'vitest'
import { buildWorkerHistory, validWorkerHistoryRange, workerHistoryRange } from './workerControlHistory'
import { buildWorkerControlDetail } from './workerControlDetail'
import { workerControlSearchResults } from './workerControlSearch'

const worker = { id: 'w1', full_name: 'Example Worker', employee_code: '75', team: { name: 'Zarour' }, is_active: true, staff_classification: 'normal', operational_start_date: '2026-09-21' }
const rows = [
  { worker_id: 'w1', attendance_date: '2026-09-21', status: 'absent' },
  { worker_id: 'w1', attendance_date: '2026-09-22', status: 'present', check_in: '08:00:00' },
  { worker_id: 'w1', attendance_date: '2026-09-24', status: 'absent' },
  { worker_id: 'w1', attendance_date: '2026-09-25', status: 'half_day' },
  { worker_id: 'other', attendance_date: '2026-09-23', status: 'present' },
]

describe('worker attendance history', () => {
  it('resolves this month, rolling two months, and bounded custom dates', () => {
    expect(workerHistoryRange('this-month', '2026-10-06')).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-06' })
    expect(workerHistoryRange('last-two-months', '2026-10-06')).toEqual({ dateFrom: '2026-08-06', dateTo: '2026-10-06' })
    const custom = workerHistoryRange('custom', '2026-10-06', '2026-09-21', '2026-09-25')
    expect(custom).toEqual({ dateFrom: '2026-09-21', dateTo: '2026-09-25' })
    expect(validWorkerHistoryRange(custom, '2026-10-06')).toBe(true)
    expect(validWorkerHistoryRange({ dateFrom: '2026-10-01', dateTo: '2026-10-07' }, '2026-10-06')).toBe(false)
  })

  it('derives absence on eligible dates without a canonical row and summarizes eligible days', () => {
    const result = buildWorkerHistory({ worker, attendance: rows, dateFrom: '2026-09-20', dateTo: '2026-09-27' })
    expect(result.days.map((day) => [day.date, day.status])).toEqual([
      ['2026-09-21', 'absent'], ['2026-09-22', 'present'], ['2026-09-23', 'absent'],
      ['2026-09-24', 'absent'], ['2026-09-25', 'half_day'], ['2026-09-26', 'absent'],
    ])
    expect(result.days.filter((day) => day.status === 'absent').map((day) => day.date)).toEqual(['2026-09-21', '2026-09-23', '2026-09-24', '2026-09-26'])
    expect(result.days.filter((day) => day.status === 'half_day')).toHaveLength(1)
    expect(result.days.filter((day) => day.status === 'present')).toHaveLength(1)
    expect(result.summary).toEqual({ eligible: 6, present: 1, halfDay: 1, absent: 4, percentage: 25 })
  })

  it('shows the October missing workday as absent without changing canonical rows', () => {
    const octoberRows = [
      { worker_id: 'w1', attendance_date: '2026-10-01', status: 'half_day' },
      { worker_id: 'w1', attendance_date: '2026-10-02', status: 'present' },
      { worker_id: 'w1', attendance_date: '2026-10-03', status: 'present' },
      { worker_id: 'w1', attendance_date: '2026-10-05', status: 'present' },
      { worker_id: 'w1', attendance_date: '2026-10-07', status: 'half_day' },
    ]
    const original = structuredClone(octoberRows)
    const result = buildWorkerHistory({ worker, attendance: octoberRows, dateFrom: '2026-10-01', dateTo: '2026-10-07' })
    expect(result.days.map((day) => [day.date, day.status])).toEqual([
      ['2026-10-01', 'half_day'], ['2026-10-02', 'present'], ['2026-10-03', 'present'],
      ['2026-10-05', 'present'], ['2026-10-06', 'absent'], ['2026-10-07', 'half_day'],
    ])
    expect(result.summary).toEqual({ eligible: 6, present: 3, halfDay: 2, absent: 1, percentage: 66.66666666666666 })
    expect(octoberRows).toEqual(original)
  })

  it('excludes Sunday, dates before operational start, and non-operational workers', () => {
    const starting = { ...worker, operational_start_date: '2026-10-05' }
    expect(buildWorkerHistory({ worker: starting, attendance: [], dateFrom: '2026-10-01', dateTo: '2026-10-06' }).days.map((day) => day.date)).toEqual(['2026-10-05', '2026-10-06'])
    for (const ineligible of [
      { ...worker, is_active: false },
      { ...worker, staff_classification: 'special_staff' },
      { ...worker, team: { name: 'Adminstration' } },
      { ...worker, team: null },
    ]) {
      expect(buildWorkerHistory({ worker: ineligible, attendance: [], dateFrom: '2026-10-01', dateTo: '2026-10-07' }).days).toEqual([])
    }
  })

  it('includes derived absences in current and longest streaks across Sunday', () => {
    const result = buildWorkerControlDetail({ worker, attendance: [], today: '2026-10-05', weekStart: '2026-10-05', monthStart: '2026-10-01', deriveMissingAbsence: true })
    expect(result.monthCounts.absent).toBe(4)
    expect(result.absenceStreaks).toEqual([{ from: '2026-10-01', to: '2026-10-05', count: 4 }])
    expect(result.currentAbsence).toBe(4)
    expect(result.longestAbsence).toBe(4)
    expect(result.month.some((day) => day.date === '2026-10-04')).toBe(false)
  })

  it('finds names, employee codes, and confirmed active biometric IDs only', () => {
    const mappings = [
      { worker_id: 'w1', device_employee_no: '021', is_active: true, mapping_review_state: 'confirmed' },
      { worker_id: 'w1', device_employee_no: '999', is_active: false, mapping_review_state: 'confirmed' },
    ]
    expect(workerControlSearchResults([worker], mappings, 'example')).toHaveLength(1)
    expect(workerControlSearchResults([worker], mappings, '75')).toHaveLength(1)
    expect(workerControlSearchResults([worker], mappings, '021')[0].biometricIds).toEqual(['021'])
    expect(workerControlSearchResults([worker], mappings, '999')).toHaveLength(0)
  })
})
